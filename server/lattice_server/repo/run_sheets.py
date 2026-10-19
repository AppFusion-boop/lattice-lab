"""Repository for Run Sheet generation, CSV export, and results re-import (§4.5, §6)."""

from __future__ import annotations

import csv
import io
import json
import random
import sqlite3
from datetime import UTC, datetime
from typing import Any

from lattice_server.audit import write_audit
from lattice_server.ids import new_id
from lattice_server.importers.tabular import (
    convert_unit_value,
    parse_header_unit,
    parse_tabular_file,
)
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import screening as screening_repo
from lattice_server.schemas import (
    RunSheetCreate,
    RunSheetImportResponse,
    RunSheetResponse,
)


def _row_to_run_sheet(row: sqlite3.Row) -> RunSheetResponse:
    items = json.loads(row["rows_json"]) if row["rows_json"] else []
    hw_changeovers = sum(1 for it in items if it.get("hardware_changeover"))
    return RunSheetResponse(
        id=row["id"],
        study_id=row["study_id"],
        screening_run_id=row["screening_run_id"],
        seed=row["seed"],
        count=len(items),
        rows=items,
        hardware_changeovers=hw_changeovers,
        saved_changeovers=0,
        created_at=row["created_at"],
    )


def create_run_sheet(
    conn: sqlite3.Connection,
    study_id: str,
    req: RunSheetCreate,
    actor: str = "local-user",
) -> RunSheetResponse:
    # 1. Look up screening run
    if req.screening_run_id:
        s_run = screening_repo.get_screening_run(conn, req.screening_run_id)
        if not s_run or s_run.study_id != study_id:
            raise ValueError(f"Screening run '{req.screening_run_id}' not found for study '{study_id}'")
        run_id = s_run.id
    else:
        latest = screening_repo.get_latest_screening_run(conn, study_id)
        if not latest:
            raise ValueError("No screening run found. Please run screening before generating a run sheet.")
        run_id = latest.id

    # 2. Query candidates from decisions
    candidate_status = req.candidate_status
    decision_rows = conn.execute(
        "SELECT candidate_id, status FROM decisions WHERE screening_run_id = ? AND status = ?",
        (run_id, candidate_status),
    ).fetchall()

    if not decision_rows and candidate_status == "recommended":
        # Fall back to open if no recommended candidates yet
        decision_rows = conn.execute(
            "SELECT candidate_id, status FROM decisions WHERE screening_run_id = ? AND status = 'open'",
            (run_id,),
        ).fetchall()

    if not decision_rows:
        raise ValueError(
            f"No candidate variants found with status '{candidate_status}' (or 'open') in screening run '{run_id}'."
        )

    cand_ids = [r["candidate_id"] for r in decision_rows]

    # Fetch candidate details
    placeholders = ",".join("?" for _ in cand_ids)
    cands = conn.execute(
        f"SELECT id, idx, values_json, label FROM candidates WHERE id IN ({placeholders})",
        cand_ids,
    ).fetchall()

    items: list[dict[str, Any]] = []
    for c in cands:
        val_dict = json.loads(c["values_json"]) if c["values_json"] else {}
        for r in range(1, req.replicates + 1):
            items.append(
                {
                    "candidate_id": c["id"],
                    "replicate": r,
                    "values": val_dict,
                    "label": c["label"],
                }
            )

    # 3. Deterministic randomization (standard or split-plot hardware-changeover-aware)
    study_row = conn.execute("SELECT rng_seed FROM studies WHERE id = ?", (study_id,)).fetchone()
    base_seed = study_row["rng_seed"] if study_row else 42
    seed = req.seed if req.seed is not None else (base_seed + 1000)

    rng = random.Random(seed)
    hardware_changeovers = 0
    saved_changeovers = 0

    if req.hard_to_change_keys:
        # Compute how many changeovers naive shuffle would incur
        naive_items = list(items)
        naive_rng = random.Random(seed)
        naive_rng.shuffle(naive_items)
        naive_changeovers = 0
        prev_key: tuple[Any, ...] | None = None
        for it in naive_items:
            cur_key = tuple(it["values"].get(k) for k in req.hard_to_change_keys)
            if cur_key != prev_key:
                naive_changeovers += 1
                prev_key = cur_key

        # Split-plot grouping: group by hard_to_change_keys, shuffle blocks, then shuffle within each block
        blocks: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
        for it in items:
            bkey = tuple(it["values"].get(k) for k in req.hard_to_change_keys)
            blocks.setdefault(bkey, []).append(it)

        block_keys = list(blocks.keys())
        rng.shuffle(block_keys)

        ordered_items: list[dict[str, Any]] = []
        for b_idx, bkey in enumerate(block_keys, start=1):
            b_items = blocks[bkey]
            rng.shuffle(b_items)
            for idx_in_block, it in enumerate(b_items):
                it["block_id"] = b_idx
                it["hardware_changeover"] = idx_in_block == 0
                ordered_items.append(it)

        items = ordered_items
        hardware_changeovers = len(block_keys)
        saved_changeovers = max(0, naive_changeovers - hardware_changeovers)
    else:
        rng.shuffle(items)

    for order, item in enumerate(items, start=1):
        item["run_order"] = order
        item["run_id"] = f"R{order:04d}"

    # 4. Save to DB
    rs_id = new_id("rs")
    now = datetime.now(UTC).isoformat()
    rows_json = json.dumps(items, separators=(",", ":"), sort_keys=True)

    with conn:
        conn.execute(
            """
            INSERT INTO run_sheets (id, study_id, screening_run_id, seed, rows_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (rs_id, study_id, run_id, seed, rows_json, now),
        )

        write_audit(
            conn=conn,
            action="create",
            entity="run_sheet",
            entity_id=rs_id,
            study_id=study_id,
            details={
                "count": len(items),
                "replicates": req.replicates,
                "seed": seed,
                "screening_run_id": run_id,
                "hard_to_change_keys": req.hard_to_change_keys,
                "hardware_changeovers": hardware_changeovers,
            },
            actor=actor,
        )

    return RunSheetResponse(
        id=rs_id,
        study_id=study_id,
        screening_run_id=run_id,
        seed=seed,
        count=len(items),
        rows=items,
        hardware_changeovers=hardware_changeovers,
        saved_changeovers=saved_changeovers,
        created_at=now,
    )


def get_run_sheet(conn: sqlite3.Connection, run_sheet_id: str) -> RunSheetResponse | None:
    row = conn.execute("SELECT * FROM run_sheets WHERE id = ?", (run_sheet_id,)).fetchone()
    if not row:
        return None
    return _row_to_run_sheet(row)


def list_run_sheets(conn: sqlite3.Connection, study_id: str) -> list[RunSheetResponse]:
    rows = conn.execute(
        "SELECT * FROM run_sheets WHERE study_id = ? ORDER BY created_at DESC",
        (study_id,),
    ).fetchall()
    return [_row_to_run_sheet(r) for r in rows]


def generate_run_sheet_csv(conn: sqlite3.Connection, run_sheet_id: str) -> str:
    rs_row = conn.execute("SELECT * FROM run_sheets WHERE id = ?", (run_sheet_id,)).fetchone()
    if not rs_row:
        raise ValueError(f"Run sheet '{run_sheet_id}' not found")

    study_id = rs_row["study_id"]
    params = parameters_repo.list_parameters(conn, study_id)
    controlled = [p for p in params if p.role == "controlled"]
    outcomes = outcomes_repo.list_outcomes(conn, study_id)

    items = json.loads(rs_row["rows_json"]) if rs_row["rows_json"] else []

    # Build CSV header
    headers = ["run_order", "run_id", "candidate_id", "replicate"]
    for p in controlled:
        h = f"{p.key} [{p.unit}]" if p.unit else p.key
        headers.append(h)

    for o in outcomes:
        h = f"{o.key} [{o.unit}]" if o.unit else o.key
        headers.append(h)

    headers.extend(["status", "notes"])

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)

    for it in items:
        row = [it["run_order"], it["run_id"], it["candidate_id"], it["replicate"]]
        v_dict = it.get("values", {})
        for p in controlled:
            row.append(v_dict.get(p.key, ""))
        for _ in outcomes:
            row.append("")  # blank for measured outcome
        row.extend(["", ""])  # blank status and notes
        writer.writerow(row)

    return output.getvalue()


def import_run_sheet_results(
    conn: sqlite3.Connection,
    run_sheet_id: str,
    content: bytes,
    filename: str,
    actor: str = "local-user",
) -> RunSheetImportResponse:
    rs_row = conn.execute("SELECT * FROM run_sheets WHERE id = ?", (run_sheet_id,)).fetchone()
    if not rs_row:
        raise ValueError(f"Run sheet '{run_sheet_id}' not found")

    study_id = rs_row["study_id"]
    items = json.loads(rs_row["rows_json"]) if rs_row["rows_json"] else []
    item_by_run_id = {it["run_id"]: it for it in items if "run_id" in it}
    item_by_cand_rep = {(it["candidate_id"], it["replicate"]): it for it in items}

    outcomes = outcomes_repo.list_outcomes(conn, study_id)
    outcome_map = {o.key: o for o in outcomes}

    headers, data_rows = parse_tabular_file(content, filename)
    col_to_idx = {h: i for i, h in enumerate(headers)}
    clean_cols = {h: parse_header_unit(h) for h in headers}

    # Match columns
    run_id_idx: int | None = None
    cand_id_idx: int | None = None
    rep_idx: int | None = None
    status_idx: int | None = None
    notes_idx: int | None = None
    outcome_col_info: dict[str, tuple[int, str]] = {}  # outcome_key -> (col_idx, header_unit)

    for h, (clean_name, unit) in clean_cols.items():
        idx = col_to_idx[h]
        c_low = clean_name.lower()
        if c_low in ("run_id", "run"):
            run_id_idx = idx
        elif c_low in ("candidate_id", "candidate"):
            cand_id_idx = idx
        elif c_low in ("replicate", "rep"):
            rep_idx = idx
        elif c_low == "status":
            status_idx = idx
        elif c_low in ("notes", "note", "comment"):
            notes_idx = idx
        else:
            for o in outcomes:
                if c_low == o.key.lower() or c_low == o.label.lower():
                    outcome_col_info[o.key] = (idx, unit)
                    break

    valid_evidence_rows: list[tuple] = []
    skipped_count = 0
    errors: list[dict[str, Any]] = []
    now = datetime.now(UTC).isoformat()

    for row_num, row in enumerate(data_rows, start=1):
        # 1. Identify matching item from run sheet
        item: dict[str, Any] | None = None
        if run_id_idx is not None and run_id_idx < len(row):
            rid = str(row[run_id_idx]).strip()
            item = item_by_run_id.get(rid)

        if not item and cand_id_idx is not None and rep_idx is not None and cand_id_idx < len(row) and rep_idx < len(row):
            cid = str(row[cand_id_idx]).strip()
            try:
                r_val = round(float(row[rep_idx]))
                item = item_by_cand_rep.get((cid, r_val))
            except (ValueError, TypeError):
                pass

        if not item:
            errors.append({"row": row_num, "error": "Cannot identify run row (missing/invalid run_id or candidate_id + replicate)"})
            continue

        # 2. Extract outcomes
        row_outcomes: dict[str, Any] = {}
        has_any_measurement = False

        for o_key, (idx, h_unit) in outcome_col_info.items():
            if idx < len(row):
                cell = row[idx]
                if cell is not None and str(cell).strip() != "":
                    try:
                        val = float(cell)
                        o_def = outcome_map[o_key]
                        if o_def.unit and h_unit and h_unit != o_def.unit:
                            conv = convert_unit_value(val, h_unit, o_def.unit)
                            row_outcomes[o_key] = {
                                "value": conv,
                                "original_value": val,
                                "original_unit": h_unit,
                            }
                        else:
                            row_outcomes[o_key] = {"value": val}
                        has_any_measurement = True
                    except Exception as exc:  # noqa: BLE001
                        errors.append({"row": row_num, "error": f"Invalid outcome value for '{o_key}': {exc}"})

        # Skip rows with no measurements filled in
        if not has_any_measurement:
            skipped_count += 1
            continue

        # 3. Status and notes
        status = "valid"
        if status_idx is not None and status_idx < len(row):
            st_val = str(row[status_idx]).strip().lower()
            if st_val in ("valid", "failed_run", "outlier"):
                status = st_val

        notes = ""
        if notes_idx is not None and notes_idx < len(row):
            notes = str(row[notes_idx]).strip()

        status_reason: str | None = None
        if status != "valid":
            if not notes:
                errors.append({"row": row_num, "error": f"Non-valid status '{status}' requires notes explaining reason"})
                continue
            status_reason = notes

        evi_id = new_id("evi")
        val_json = json.dumps(item["values"], separators=(",", ":"), sort_keys=True)
        out_json = json.dumps(row_outcomes, separators=(",", ":"), sort_keys=True)

        valid_evidence_rows.append(
            (
                evi_id,
                study_id,
                "field",
                None,  # source_id
                val_json,
                out_json,
                status,
                status_reason,
                item["candidate_id"],
                run_sheet_id,
                item["replicate"],
                None,  # supersedes_id
                now,
                actor,
                notes,
                now,
            )
        )

    # 4. Save to evidence table in a single transaction
    if valid_evidence_rows:
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
                valid_evidence_rows,
            )

            write_audit(
                conn=conn,
                action="import_results",
                entity="run_sheet",
                entity_id=run_sheet_id,
                study_id=study_id,
                details={
                    "imported_count": len(valid_evidence_rows),
                    "skipped_count": skipped_count,
                    "errors_count": len(errors),
                },
                actor=actor,
            )

    return RunSheetImportResponse(
        imported_count=len(valid_evidence_rows),
        skipped_count=skipped_count,
        errors=errors,
    )
