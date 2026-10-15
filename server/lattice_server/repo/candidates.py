"""Repository for Candidate Sets and Candidates operations."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from lattice_server.audit import write_audit
from lattice_server.ids import compute_values_hash, new_id
from lattice_server.repo import parameters as parameters_repo
from lattice_server.schemas import (
    CandidateResponse,
    CandidateSetResponse,
    DecisionSummary,
    PaginatedCandidatesResponse,
)
from lattice_server.stats.doe import compute_parameters_hash


def _row_to_candidate_set(row: sqlite3.Row) -> CandidateSetResponse:
    settings = json.loads(row["settings_json"]) if row["settings_json"] else {}
    return CandidateSetResponse(
        id=row["id"],
        study_id=row["study_id"],
        method=row["method"],
        settings=settings,
        parameters_hash=row["parameters_hash"],
        count=row["count"],
        active=bool(row["active"]),
        created_at=row["created_at"],
    )


def create_candidate_set(
    conn: sqlite3.Connection,
    study_id: str,
    method: str,
    settings: dict[str, Any],
    candidate_rows: list[dict[str, Any]],
    candidate_set_id: str | None = None,
    actor: str = "local-user",
) -> CandidateSetResponse:
    cset_id = candidate_set_id or new_id("cst")
    now = datetime.now(UTC).isoformat()
    count = len(candidate_rows)

    # Deactivate existing candidate sets for this study
    conn.execute("UPDATE candidate_sets SET active = 0 WHERE study_id = ?", (study_id,))

    # Compute parameters_hash from controlled parameters
    params = parameters_repo.list_parameters(conn, study_id)
    controlled_keys = [p.key for p in params if p.role == "controlled"]
    p_hash = compute_parameters_hash(params)
    settings_json = json.dumps(settings, separators=(",", ":"), sort_keys=True)

    # Insert candidate_set
    conn.execute(
        """
        INSERT INTO candidate_sets (
            id, study_id, method, settings_json, parameters_hash, count, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        """,
        (cset_id, study_id, method, settings_json, p_hash, count, now),
    )

    # Prepare batch rows for candidates
    batch: list[tuple[str, str, int, str | None, str, str]] = []
    for idx, row_vals in enumerate(candidate_rows):
        cid = f"{cset_id}_{idx}"
        label = str(row_vals.get("_label") or row_vals.get("label") or "") or None
        clean_vals = {k: v for k, v in row_vals.items() if not k.startswith("_") and k != "label"}
        v_hash = compute_values_hash(clean_vals, controlled_keys=controlled_keys)
        v_json = json.dumps(clean_vals, separators=(",", ":"), sort_keys=True)
        batch.append((cid, cset_id, idx, label, v_json, v_hash))

    conn.executemany(
        """
        INSERT INTO candidates (id, candidate_set_id, idx, label, values_json, values_hash)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        batch,
    )

    write_audit(
        conn,
        action="generate",
        entity="candidate_set",
        entity_id=cset_id,
        study_id=study_id,
        details={"method": method, "count": count},
        actor=actor,
    )

    row = conn.execute("SELECT * FROM candidate_sets WHERE id = ?", (cset_id,)).fetchone()
    return _row_to_candidate_set(row)


def get_candidate_set(conn: sqlite3.Connection, set_id: str) -> CandidateSetResponse | None:
    row = conn.execute("SELECT * FROM candidate_sets WHERE id = ?", (set_id,)).fetchone()
    if not row:
        return None
    return _row_to_candidate_set(row)


def get_active_candidate_set(conn: sqlite3.Connection, study_id: str) -> CandidateSetResponse | None:
    row = conn.execute(
        "SELECT * FROM candidate_sets WHERE study_id = ? AND active = 1",
        (study_id,),
    ).fetchone()
    if not row:
        return None
    return _row_to_candidate_set(row)


def list_candidate_sets(conn: sqlite3.Connection, study_id: str) -> list[CandidateSetResponse]:
    rows = conn.execute(
        "SELECT * FROM candidate_sets WHERE study_id = ? ORDER BY created_at DESC",
        (study_id,),
    ).fetchall()
    return [_row_to_candidate_set(r) for r in rows]


def list_candidates_paginated(
    conn: sqlite3.Connection,
    study_id: str,
    set_id: str | None = None,
    status_filter: str | None = None,
    sort: str | None = None,
    offset: int = 0,
    limit: int = 100,
) -> PaginatedCandidatesResponse:
    cset = get_candidate_set(conn, set_id) if set_id else get_active_candidate_set(conn, study_id)
    if not cset:
        return PaginatedCandidatesResponse(items=[], total=0, offset=offset, limit=limit)

    # Check latest screening run for this set
    latest_run = conn.execute(
        "SELECT id FROM screening_runs WHERE candidate_set_id = ? ORDER BY created_at DESC LIMIT 1",
        (cset.id,),
    ).fetchone()
    latest_run_id = latest_run["id"] if latest_run else None

    # Base query joining decisions if available
    query_base = """
        FROM candidates c
        LEFT JOIN decisions d ON d.screening_run_id = ? AND d.candidate_id = c.id
        WHERE c.candidate_set_id = ?
    """
    params: list[object] = [latest_run_id, cset.id]

    if status_filter:
        query_base += " AND d.status = ?"
        params.append(status_filter)

    total_row = conn.execute(f"SELECT COUNT(*) AS cnt {query_base}", params).fetchone()
    total = total_row["cnt"] if total_row else 0

    order_by = "c.idx ASC"
    if sort == "status":
        order_by = "d.status ASC, c.idx ASC"

    query_rows = f"""
        SELECT c.id, c.candidate_set_id, c.idx, c.label, c.values_json, c.values_hash,
               d.status AS dec_status, d.filter AS dec_filter, d.p_hat AS dec_p_hat,
               d.p_upper AS dec_p_upper, d.reason AS dec_reason
        {query_base}
        ORDER BY {order_by}
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    rows = conn.execute(query_rows, params).fetchall()
    items: list[CandidateResponse] = []
    for r in rows:
        values = json.loads(r["values_json"])
        decision = (
            DecisionSummary(
                status=r["dec_status"],
                filter=r["dec_filter"],
                p_hat=r["dec_p_hat"],
                p_upper=r["dec_p_upper"],
                reason=r["dec_reason"],
            )
            if r["dec_status"]
            else None
        )
        items.append(
            CandidateResponse(
                id=r["id"],
                candidate_set_id=r["candidate_set_id"],
                idx=r["idx"],
                label=r["label"],
                values=values,
                values_hash=r["values_hash"],
                decision=decision,
            )
        )

    return PaginatedCandidatesResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
    )
