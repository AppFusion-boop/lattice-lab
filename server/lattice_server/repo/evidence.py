"""Repository for scientific Evidence records (immutable evidence store)."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from lattice_server.audit import write_audit
from lattice_server.ids import new_id
from lattice_server.importers.tabular import convert_unit_value
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.schemas import EvidenceCreate, EvidenceResponse


def _row_to_evidence(row: sqlite3.Row) -> EvidenceResponse:
    return EvidenceResponse(
        id=row["id"],
        study_id=row["study_id"],
        kind=row["kind"],
        source_id=row["source_id"],
        values=json.loads(row["values_json"]) if row["values_json"] else {},
        outcomes=json.loads(row["outcomes_json"]) if row["outcomes_json"] else {},
        status=row["status"],
        status_reason=row["status_reason"],
        candidate_id=row["candidate_id"],
        run_sheet_id=row["run_sheet_id"],
        replicate=row["replicate"],
        supersedes_id=row["supersedes_id"],
        recorded_at=row["recorded_at"],
        recorded_by=row["recorded_by"],
        notes=row["notes"],
        retracted_at=row["retracted_at"],
        retraction_reason=row["retraction_reason"],
        created_at=row["created_at"],
    )


def _normalize_evidence_values_and_outcomes(
    conn: sqlite3.Connection,
    study_id: str,
    raw_values: dict[str, Any],
    raw_outcomes: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    params = parameters_repo.list_parameters(conn, study_id)
    param_map = {p.key: p for p in params}

    # Verify all controlled parameters are present
    controlled_params = [p for p in params if p.role == "controlled"]
    for cp in controlled_params:
        if cp.key not in raw_values:
            raise ValueError(f"Missing required controlled parameter: '{cp.key}'")

    normalized_values: dict[str, Any] = {}
    for k, v in raw_values.items():
        p = param_map.get(k)
        if isinstance(v, dict) and "value" in v:
            val = float(v["value"])
            from_u = str(v.get("unit", "")).strip()
            if p and p.unit and from_u and from_u != p.unit:
                val = convert_unit_value(val, from_u, p.unit)
            normalized_values[k] = val
        elif isinstance(v, (int, float)):
            normalized_values[k] = float(v)
        else:
            normalized_values[k] = v

    # Normalize outcomes with physical unit conversions
    study_outcomes = outcomes_repo.list_outcomes(conn, study_id)
    outcome_map = {o.key: o for o in study_outcomes}

    normalized_outcomes: dict[str, Any] = {}
    for k, v in raw_outcomes.items():
        out_def = outcome_map.get(k)
        if isinstance(v, (int, float)):
            normalized_outcomes[k] = {"value": float(v)}
        elif isinstance(v, dict):
            val = float(v.get("value", 0.0))
            from_u = str(v.get("unit", "")).strip()
            item: dict[str, Any] = dict(v)
            if out_def and out_def.unit and from_u and from_u != out_def.unit:
                orig_val = val
                val = convert_unit_value(val, from_u, out_def.unit)
                item["value"] = val
                item["original_value"] = orig_val
                item["original_unit"] = from_u
                if "sd" in item and item["sd"] is not None:
                    item["sd"] = convert_unit_value(float(item["sd"]), from_u, out_def.unit)
                if "ci_low" in item and item["ci_low"] is not None:
                    item["ci_low"] = convert_unit_value(float(item["ci_low"]), from_u, out_def.unit)
                if "ci_high" in item and item["ci_high"] is not None:
                    item["ci_high"] = convert_unit_value(float(item["ci_high"]), from_u, out_def.unit)
            normalized_outcomes[k] = item
        else:
            normalized_outcomes[k] = v

    return normalized_values, normalized_outcomes


def create_evidence(
    conn: sqlite3.Connection,
    study_id: str,
    req: EvidenceCreate,
    supersedes_id: str | None = None,
    actor: str = "local-user",
) -> EvidenceResponse:
    if req.status != "valid" and not req.status_reason:
        raise ValueError("status_reason is required when status is not 'valid'")

    norm_values, norm_outcomes = _normalize_evidence_values_and_outcomes(
        conn=conn,
        study_id=study_id,
        raw_values=req.values,
        raw_outcomes=req.outcomes,
    )

    evi_id = new_id("evi")
    now = datetime.now(UTC).isoformat()
    values_json = json.dumps(norm_values, separators=(",", ":"), sort_keys=True)
    outcomes_json = json.dumps(norm_outcomes, separators=(",", ":"), sort_keys=True)

    with conn:
        conn.execute(
            """
            INSERT INTO evidence (
                id, study_id, kind, source_id, values_json, outcomes_json,
                status, status_reason, candidate_id, run_sheet_id, replicate,
                supersedes_id, recorded_at, recorded_by, notes,
                retracted_at, retraction_reason, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
            """,
            (
                evi_id,
                study_id,
                req.kind,
                req.source_id,
                values_json,
                outcomes_json,
                req.status,
                req.status_reason,
                req.candidate_id,
                req.run_sheet_id,
                req.replicate,
                supersedes_id,
                req.recorded_at or now,
                actor,
                req.notes,
                now,
            ),
        )

        write_audit(
            conn=conn,
            action="create",
            entity="evidence",
            entity_id=evi_id,
            study_id=study_id,
            details={"kind": req.kind, "supersedes_id": supersedes_id},
            actor=actor,
        )

    row = conn.execute("SELECT * FROM evidence WHERE id = ?", (evi_id,)).fetchone()
    return _row_to_evidence(row)


def get_evidence(conn: sqlite3.Connection, evidence_id: str) -> EvidenceResponse | None:
    row = conn.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone()
    if not row:
        return None
    return _row_to_evidence(row)


def list_evidence(
    conn: sqlite3.Connection,
    study_id: str,
    include_retracted: bool = False,
    status_filter: str | None = None,
    kind_filter: str | None = None,
    source_id: str | None = None,
    candidate_id: str | None = None,
    offset: int = 0,
    limit: int = 100,
) -> list[EvidenceResponse]:
    conditions = ["study_id = ?"]
    params: list[object] = [study_id]

    if not include_retracted:
        conditions.append("retracted_at IS NULL")

    if status_filter:
        conditions.append("status = ?")
        params.append(status_filter)

    if kind_filter:
        conditions.append("kind = ?")
        params.append(kind_filter)

    if source_id:
        conditions.append("source_id = ?")
        params.append(source_id)

    if candidate_id:
        conditions.append("candidate_id = ?")
        params.append(candidate_id)

    where_clause = " AND ".join(conditions)
    query = f"""
        SELECT * FROM evidence
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    rows = conn.execute(query, params).fetchall()
    return [_row_to_evidence(r) for r in rows]


def retract_evidence(
    conn: sqlite3.Connection,
    evidence_id: str,
    reason: str,
    actor: str = "local-user",
) -> EvidenceResponse:
    row = conn.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone()
    if not row:
        raise ValueError(f"Evidence '{evidence_id}' not found")

    if row["retracted_at"] is not None:
        raise ValueError(f"Evidence '{evidence_id}' is already retracted")

    now = datetime.now(UTC).isoformat()
    with conn:
        conn.execute(
            """
            UPDATE evidence
            SET retracted_at = ?, retraction_reason = ?
            WHERE id = ? AND retracted_at IS NULL
            """,
            (now, reason, evidence_id),
        )

        write_audit(
            conn=conn,
            action="retract",
            entity="evidence",
            entity_id=evidence_id,
            study_id=row["study_id"],
            details={"reason": reason},
            actor=actor,
        )

    updated_row = conn.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone()
    return _row_to_evidence(updated_row)


def supersede_evidence(
    conn: sqlite3.Connection,
    evidence_id: str,
    new_req: EvidenceCreate,
    actor: str = "local-user",
) -> EvidenceResponse:
    old_row = conn.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone()
    if not old_row:
        raise ValueError(f"Evidence '{evidence_id}' not found")

    if old_row["retracted_at"] is not None:
        raise ValueError(f"Cannot supersede already retracted evidence '{evidence_id}'")

    study_id = old_row["study_id"]
    new_evi_id = new_id("evi")
    now = datetime.now(UTC).isoformat()

    norm_values, norm_outcomes = _normalize_evidence_values_and_outcomes(
        conn=conn,
        study_id=study_id,
        raw_values=new_req.values,
        raw_outcomes=new_req.outcomes,
    )

    values_json = json.dumps(norm_values, separators=(",", ":"), sort_keys=True)
    outcomes_json = json.dumps(norm_outcomes, separators=(",", ":"), sort_keys=True)

    with conn:
        # 1. Insert new evidence row with supersedes_id = evidence_id
        conn.execute(
            """
            INSERT INTO evidence (
                id, study_id, kind, source_id, values_json, outcomes_json,
                status, status_reason, candidate_id, run_sheet_id, replicate,
                supersedes_id, recorded_at, recorded_by, notes,
                retracted_at, retraction_reason, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
            """,
            (
                new_evi_id,
                study_id,
                new_req.kind,
                new_req.source_id,
                values_json,
                outcomes_json,
                new_req.status,
                new_req.status_reason,
                new_req.candidate_id,
                new_req.run_sheet_id,
                new_req.replicate,
                evidence_id,
                new_req.recorded_at or now,
                actor,
                new_req.notes,
                now,
            ),
        )

        # 2. Retract old evidence row
        conn.execute(
            """
            UPDATE evidence
            SET retracted_at = ?, retraction_reason = ?
            WHERE id = ? AND retracted_at IS NULL
            """,
            (now, f"superseded by {new_evi_id}", evidence_id),
        )

        # 3. Audit log
        write_audit(
            conn=conn,
            action="create",
            entity="evidence",
            entity_id=new_evi_id,
            study_id=study_id,
            details={"kind": new_req.kind, "supersedes_id": evidence_id},
            actor=actor,
        )

        write_audit(
            conn=conn,
            action="retract",
            entity="evidence",
            entity_id=evidence_id,
            study_id=study_id,
            details={"reason": f"superseded by {new_evi_id}"},
            actor=actor,
        )

    row = conn.execute("SELECT * FROM evidence WHERE id = ?", (new_evi_id,)).fetchone()
    return _row_to_evidence(row)
