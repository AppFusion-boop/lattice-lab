"""Tabular file importer (CSV and XLSX) with delimiter sniffing and unit conversion."""

from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
from datetime import UTC, datetime
from typing import Any

import openpyxl

from lattice_server import config
from lattice_server.audit import write_audit
from lattice_server.config import ensure_directories
from lattice_server.ids import new_id
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.schemas import (
    ImportCommitRequest,
    ImportCommitResponse,
    ImportPreviewResponse,
    OutcomeResponse,
    ParameterResponse,
)
from lattice_server.units import normalize_unit, ureg

MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_ROW_COUNT = 100_000

HEADER_UNIT_RE = re.compile(r"^(.*?)\s*(?:\[(.*?)\]|\((.*?)\))$")


def parse_header_unit(header: str) -> tuple[str, str]:
    """Parse header name and optional unit notation:

    'flow [L/min]' -> ('flow', 'L/min')
    'pressure (Pa)' -> ('pressure', 'Pa')
    'droplet' -> ('droplet', '')
    """
    clean = header.strip()
    match = HEADER_UNIT_RE.match(clean)
    if match:
        name = match.group(1).strip()
        unit = (match.group(2) or match.group(3) or "").strip()
        return name, unit
    return clean, ""


def convert_unit_value(val: float, from_unit: str, to_unit: str) -> float:
    """Convert numerical value between physical units using pint."""
    norm_from = normalize_unit(from_unit)
    norm_to = normalize_unit(to_unit)
    if not norm_from or not norm_to or norm_from == norm_to:
        return float(val)

    try:
        q = ureg.Quantity(val, norm_from)
        converted = q.to(norm_to)
        return float(converted.magnitude)
    except Exception as exc:
        raise ValueError(
            f"Cannot convert value {val} from unit '{from_unit}' to '{to_unit}': {exc}"
        ) from exc


def parse_tabular_file(content: bytes, filename: str) -> tuple[list[str], list[list[Any]]]:
    """Parse a CSV or XLSX file into headers and data rows.

    Handles UTF-8 with BOM, comma or semicolon delimiter sniffing, and blank rows.
    """
    if len(content) > MAX_FILE_BYTES:
        raise ValueError("File exceeds maximum allowed size of 20 MB")

    lower_name = filename.lower()
    if lower_name.endswith(".csv"):
        # Decode UTF-8 with BOM handling
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError(f"CSV file must be UTF-8 encoded: {exc}") from exc

        # Sniff delimiter on sample
        sample = text[:4096]
        delimiter = ","
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
            delimiter = dialect.delimiter
        except (csv.Error, TypeError):
            if ";" in sample and sample.count(";") > sample.count(","):
                delimiter = ";"

        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        raw_rows = [row for row in reader if any(cell.strip() for cell in row)]
        if not raw_rows:
            raise ValueError("CSV file is empty")

        headers = [h.strip() for h in raw_rows[0]]
        data_rows = raw_rows[1:]

    elif lower_name.endswith((".xlsx", ".xls")):
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        sheet = wb.active
        if not sheet:
            raise ValueError("Excel file contains no active sheet")

        raw_rows = []
        for row in sheet.iter_rows(values_only=True):
            if any(cell is not None and str(cell).strip() != "" for cell in row):
                raw_rows.append(list(row))

        if not raw_rows:
            raise ValueError("Excel file is empty")

        headers = [str(h).strip() if h is not None else f"Column_{i+1}" for i, h in enumerate(raw_rows[0])]
        data_rows = raw_rows[1:]

    else:
        raise ValueError(f"Unsupported file format '{filename}'. Must be .csv or .xlsx")

    if len(data_rows) > MAX_ROW_COUNT:
        raise ValueError(f"File row count ({len(data_rows):,}) exceeds maximum limit of {MAX_ROW_COUNT:,}")

    return headers, data_rows


def validate_and_map_candidates(
    headers: list[str],
    data_rows: list[list[Any]],
    mapping: dict[str, str],
    params: list[ParameterResponse],
    skip_invalid: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Validate and map tabular data rows to candidate value dictionaries.

    Args:
        headers: Column headers from tabular file.
        data_rows: Data rows (list of cell values).
        mapping: Mapping from column name -> parameter key (or 'label' / '_label').
        params: Controlled parameter responses for the target study.
        skip_invalid: If True, invalid rows are skipped and recorded in errors.
                      If False, any error causes an immediate ValueError.

    Returns:
        (valid_candidates, error_records)
    """
    controlled_params = {p.key: p for p in params if p.role == "controlled"}
    if not controlled_params:
        raise ValueError("Target study has no controlled parameters to map candidates to.")

    # Invert mapping: parameter_key -> col_idx, and label -> col_idx
    col_to_idx = {h: i for i, h in enumerate(headers)}
    param_col_info: dict[str, tuple[int, str]] = {}  # param_key -> (col_idx, header_unit)
    label_col_idx: int | None = None

    for col_name, target in mapping.items():
        if col_name not in col_to_idx:
            continue
        c_idx = col_to_idx[col_name]
        if target in ("label", "_label"):
            label_col_idx = c_idx
        elif target in controlled_params:
            _, header_unit = parse_header_unit(col_name)
            param_col_info[target] = (c_idx, header_unit)

    # Check all controlled parameters are mapped
    missing_keys = set(controlled_params.keys()) - set(param_col_info.keys())
    if missing_keys:
        raise ValueError(
            f"Mapping is missing required controlled parameters: {sorted(missing_keys)}"
        )

    valid_candidates: list[dict[str, Any]] = []
    error_records: list[dict[str, Any]] = []

    for row_num, row in enumerate(data_rows, start=1):
        row_errors: list[str] = []
        candidate_dict: dict[str, Any] = {}

        if label_col_idx is not None and label_col_idx < len(row):
            label_val = row[label_col_idx]
            if label_val is not None:
                candidate_dict["_label"] = str(label_val).strip()

        for key, p in controlled_params.items():
            col_idx, header_unit = param_col_info[key]
            if col_idx >= len(row):
                row_errors.append(f"Missing column value for parameter '{key}'")
                continue

            cell = row[col_idx]
            if cell is None or (isinstance(cell, str) and not cell.strip()):
                row_errors.append(f"Empty value for parameter '{key}'")
                continue

            spec = p.spec
            kind = p.kind

            try:
                if kind == "continuous":
                    val_num = float(cell)
                    # Convert unit if header specifies unit
                    val_conv = convert_unit_value(val_num, header_unit, p.unit)
                    if val_conv < spec["min"] or val_conv > spec["max"]:
                        row_errors.append(
                            f"Value {val_conv} for '{key}' is outside allowed range [{spec['min']}, {spec['max']}]"
                        )
                    candidate_dict[key] = val_conv

                elif kind == "integer":
                    val_int = round(float(cell))
                    if val_int < spec["min"] or val_int > spec["max"]:
                        row_errors.append(
                            f"Value {val_int} for '{key}' is outside allowed range [{spec['min']}, {spec['max']}]"
                        )
                    candidate_dict[key] = val_int

                elif kind == "categorical":
                    val_str = str(cell).strip()
                    options = spec.get("options", [])
                    if val_str not in options:
                        row_errors.append(
                            f"Value '{val_str}' for '{key}' must be one of {options}"
                        )
                    candidate_dict[key] = val_str

            except Exception as exc:  # noqa: BLE001
                row_errors.append(f"Invalid value for '{key}': {exc}")

        if row_errors:
            for err in row_errors:
                error_records.append({"row": row_num, "error": err})
            if not skip_invalid:
                raise ValueError(f"Row {row_num}: {'; '.join(row_errors)}")
        else:
            valid_candidates.append(candidate_dict)

    return valid_candidates, error_records


def preview_tabular_evidence(
    study_id: str,
    content: bytes,
    filename: str,
    params: list[ParameterResponse],
    outcomes: list[OutcomeResponse],
) -> ImportPreviewResponse:
    headers, data_rows = parse_tabular_file(content, filename)
    column_units: dict[str, str] = {}
    clean_cols: list[str] = []
    for h in headers:
        name, unit = parse_header_unit(h)
        column_units[h] = unit
        clean_cols.append(name)

    guessed_mapping: dict[str, str] = {}
    param_map_lower = {p.key.lower(): p.key for p in params}
    param_label_map_lower = {p.label.lower(): p.key for p in params}
    outcome_map_lower = {o.key.lower(): o.key for o in outcomes}
    outcome_label_map_lower = {o.label.lower(): o.key for o in outcomes}

    for h, clean in zip(headers, clean_cols, strict=False):
        c_low = clean.lower()
        if c_low in param_map_lower:
            guessed_mapping[h] = f"param:{param_map_lower[c_low]}"
        elif c_low in param_label_map_lower:
            guessed_mapping[h] = f"param:{param_label_map_lower[c_low]}"
        elif c_low in outcome_map_lower:
            guessed_mapping[h] = f"outcome:{outcome_map_lower[c_low]}"
        elif c_low in outcome_label_map_lower:
            guessed_mapping[h] = f"outcome:{outcome_label_map_lower[c_low]}"
        elif c_low.endswith("_sd") and c_low[:-3] in outcome_map_lower:
            guessed_mapping[h] = f"outcome_sd:{outcome_map_lower[c_low[:-3]]}"
        elif c_low.startswith("sd_") and c_low[3:] in outcome_map_lower:
            guessed_mapping[h] = f"outcome_sd:{outcome_map_lower[c_low[3:]]}"
        elif any(marker in c_low for marker in ("_sd", "sd_", " sd", "-sd", "sd")):
            c_base = (
                c_low.replace("_sd", "")
                .replace("sd_", "")
                .replace(" sd", "")
                .replace("-sd", "")
                .strip(" _-")
            )
            for o in outcomes:
                ok_low = o.key.lower()
                ol_low = o.label.lower()
                if c_base and (c_base in ok_low or c_base in ol_low or ok_low in c_base or ol_low in c_base):
                    guessed_mapping[h] = f"outcome_sd:{o.key}"
                    break
        elif c_low in ("candidate_id", "candidate", "cand_id"):
            guessed_mapping[h] = "candidate_id"
        elif c_low in ("replicate", "rep", "rep_id"):
            guessed_mapping[h] = "replicate"
        elif c_low in ("status", "state"):
            guessed_mapping[h] = "status"
        elif c_low in ("status_reason", "reason"):
            guessed_mapping[h] = "status_reason"
        elif c_low in ("notes", "note", "comment", "comments"):
            guessed_mapping[h] = "notes"
        elif c_low in ("recorded_at", "date", "timestamp", "time"):
            guessed_mapping[h] = "recorded_at"

    # Save to disk in imports dir
    ensure_directories()
    imports_dir = config.DATA_DIR / "imports"
    import_token = new_id("imp")
    token_path = imports_dir / f"{import_token}.json"

    # Cleanup old tokens > 1 hour
    now_ts = datetime.now(UTC).timestamp()
    for existing_file in imports_dir.glob("*.json"):
        try:
            if now_ts - existing_file.stat().st_mtime > 3600:
                existing_file.unlink(missing_ok=True)
        except OSError:
            pass

    payload = {
        "import_token": import_token,
        "study_id": study_id,
        "filename": filename,
        "headers": headers,
        "data_rows": data_rows,
        "created_at": now_ts,
    }
    with open(token_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)

    return ImportPreviewResponse(
        import_token=import_token,
        filename=filename,
        columns=headers,
        column_units=column_units,
        sample_rows=data_rows[:5],
        total_rows=len(data_rows),
        guessed_mapping=guessed_mapping,
    )


def commit_tabular_evidence(
    conn: sqlite3.Connection,
    study_id: str,
    req: ImportCommitRequest,
    actor: str = "local-user",
) -> ImportCommitResponse:
    imports_dir = config.DATA_DIR / "imports"
    token_path = imports_dir / f"{req.import_token}.json"
    if not token_path.exists():
        raise ValueError(f"Import token '{req.import_token}' not found or expired")

    with open(token_path, encoding="utf-8") as f:
        data = json.load(f)

    if data.get("study_id") != study_id:
        raise ValueError(f"Import token does not match study '{study_id}'")

    headers: list[str] = data["headers"]
    data_rows: list[list[Any]] = data["data_rows"]

    # Target parameters and outcomes
    params = parameters_repo.list_parameters(conn, study_id)
    param_map = {p.key: p for p in params}
    controlled_params = {p.key: p for p in params if p.role == "controlled"}

    outcomes = outcomes_repo.list_outcomes(conn, study_id)
    outcome_map = {o.key: o for o in outcomes}

    # Verify all controlled parameters are mapped
    mapped_controlled = set()
    for target in req.mapping.values():
        if target.startswith("param:"):
            pkey = target[6:]
            if pkey in controlled_params:
                mapped_controlled.add(pkey)

    missing = set(controlled_params.keys()) - mapped_controlled
    if missing:
        raise ValueError(f"Mapping is missing required controlled parameters: {sorted(missing)}")

    # Pre-index column indices and header units
    col_to_idx = {h: i for i, h in enumerate(headers)}
    col_units = {h: parse_header_unit(h)[1] for h in headers}

    valid_rows: list[tuple] = []
    error_records: list[dict[str, Any]] = []
    now = datetime.now(UTC).isoformat()

    for row_idx, row in enumerate(data_rows, start=1):
        row_errors: list[str] = []
        param_values: dict[str, Any] = {}
        outcome_values: dict[str, Any] = {}
        candidate_id: str | None = None
        replicate: int | None = None
        status = req.default_status
        status_reason: str | None = None
        notes: str = ""
        recorded_at: str | None = None

        for col_name, target in req.mapping.items():
            if target in ("ignore", "", None) or col_name not in col_to_idx:
                continue

            c_idx = col_to_idx[col_name]
            if c_idx >= len(row):
                continue
            cell = row[c_idx]
            if cell is None or (isinstance(cell, str) and not cell.strip()):
                continue

            h_unit = col_units.get(col_name, "")

            if target.startswith("param:"):
                p_key = target[6:]
                p_def = param_map.get(p_key)
                if not p_def:
                    continue

                try:
                    if p_def.kind == "continuous":
                        num = float(cell)
                        conv = convert_unit_value(num, h_unit, p_def.unit)
                        spec = p_def.spec
                        if conv < spec["min"] or conv > spec["max"]:
                            row_errors.append(
                                f"Value {conv} for '{p_key}' out of range [{spec['min']}, {spec['max']}]"
                            )
                        param_values[p_key] = conv
                    elif p_def.kind == "integer":
                        num_int = round(float(cell))
                        spec = p_def.spec
                        if num_int < spec["min"] or num_int > spec["max"]:
                            row_errors.append(
                                f"Value {num_int} for '{p_key}' out of range [{spec['min']}, {spec['max']}]"
                            )
                        param_values[p_key] = num_int
                    elif p_def.kind == "categorical":
                        cat_str = str(cell).strip()
                        opts = p_def.spec.get("options", [])
                        if cat_str not in opts:
                            row_errors.append(f"Value '{cat_str}' for '{p_key}' not in {opts}")
                        param_values[p_key] = cat_str
                except Exception as exc:  # noqa: BLE001
                    row_errors.append(f"Invalid value for '{p_key}': {exc}")

            elif target.startswith("outcome:"):
                o_key = target[8:]
                o_def = outcome_map.get(o_key)
                if not o_def:
                    continue
                try:
                    val = float(cell)
                    item = outcome_values.setdefault(o_key, {})
                    if o_def.unit and h_unit and h_unit != o_def.unit:
                        conv = convert_unit_value(val, h_unit, o_def.unit)
                        item["value"] = conv
                        item["original_value"] = val
                        item["original_unit"] = h_unit
                    else:
                        item["value"] = val
                except Exception as exc:  # noqa: BLE001
                    row_errors.append(f"Invalid outcome value for '{o_key}': {exc}")

            elif target.startswith("outcome_sd:"):
                o_key = target[11:]
                o_def = outcome_map.get(o_key)
                if not o_def:
                    continue
                try:
                    sd_val = float(cell)
                    item = outcome_values.setdefault(o_key, {})
                    if o_def.unit and h_unit and h_unit != o_def.unit:
                        item["sd"] = convert_unit_value(sd_val, h_unit, o_def.unit)
                    else:
                        item["sd"] = sd_val
                except Exception as exc:  # noqa: BLE001
                    row_errors.append(f"Invalid sd for '{o_key}': {exc}")

            elif target == "candidate_id":
                candidate_id = str(cell).strip()
            elif target == "replicate":
                try:
                    replicate = round(float(cell))
                except (ValueError, TypeError):
                    pass
            elif target == "status":
                st = str(cell).strip().lower()
                if st in ("valid", "failed_run", "outlier"):
                    status = st
            elif target == "status_reason":
                status_reason = str(cell).strip()
            elif target == "notes":
                notes = str(cell).strip()
            elif target == "recorded_at":
                recorded_at = str(cell).strip()

        # Check all controlled parameters are present
        for cp_key in controlled_params:
            if cp_key not in param_values:
                row_errors.append(f"Missing required controlled parameter '{cp_key}'")

        if status != "valid" and not status_reason:
            if notes:
                status_reason = notes
            else:
                status_reason = f"Imported with status '{status}'"

        if row_errors:
            for err in row_errors:
                error_records.append({"row": row_idx, "error": err})
            if not req.skip_invalid:
                token_path.unlink(missing_ok=True)
                raise ValueError(f"Row {row_idx}: {'; '.join(row_errors)}")
        else:
            evi_id = new_id("evi")
            val_json = json.dumps(param_values, separators=(",", ":"), sort_keys=True)
            out_json = json.dumps(outcome_values, separators=(",", ":"), sort_keys=True)
            valid_rows.append(
                (
                    evi_id,
                    study_id,
                    req.kind,
                    req.source_id,
                    val_json,
                    out_json,
                    status,
                    status_reason,
                    candidate_id,
                    None,  # run_sheet_id
                    replicate,
                    None,  # supersedes_id
                    recorded_at or now,
                    actor,
                    notes,
                    now,
                )
            )

    # Insert into database in a single transaction
    with conn:
        conn.executemany(
            """
            INSERT INTO evidence (
                id, study_id, kind, source_id, values_json, outcomes_json,
                status, status_reason, candidate_id, run_sheet_id, replicate,
                supersedes_id, recorded_at, recorded_by, notes,
                retracted_at, retraction_reason, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
            """,
            valid_rows,
        )

        write_audit(
            conn=conn,
            action="import",
            entity="evidence",
            entity_id=req.import_token,
            study_id=study_id,
            details={
                "imported_count": len(valid_rows),
                "skipped_count": len(error_records),
                "source_id": req.source_id,
                "kind": req.kind,
            },
            actor=actor,
        )

    # Clean up token file
    token_path.unlink(missing_ok=True)

    return ImportCommitResponse(
        imported_count=len(valid_rows),
        skipped_count=len(error_records),
        errors=error_records,
    )

