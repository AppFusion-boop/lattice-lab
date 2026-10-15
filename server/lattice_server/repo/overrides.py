"""Repository for Candidate Overrides."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

from lattice_server.audit import write_audit
from lattice_server.ids import new_id
from lattice_server.schemas import OverrideCreate, OverrideResponse


def _row_to_override(row: sqlite3.Row) -> OverrideResponse:
    return OverrideResponse(
        id=row["id"],
        study_id=row["study_id"],
        values_hash=row["values_hash"],
        status=row["status"],
        reason=row["reason"],
        created_by=row["created_by"],
        created_at=row["created_at"],
        revoked_at=row["revoked_at"],
    )


def create_override(
    conn: sqlite3.Connection,
    study_id: str,
    req: OverrideCreate,
    actor: str = "local-user",
) -> OverrideResponse:
    values_hash = req.values_hash
    if not values_hash and req.candidate_id:
        row = conn.execute(
            "SELECT values_hash FROM candidates WHERE id = ?",
            (req.candidate_id,),
        ).fetchone()
        if row:
            values_hash = row["values_hash"]

    if not values_hash:
        raise ValueError("Must provide either 'values_hash' or a valid 'candidate_id'")

    override_id = new_id("ovr")
    now = datetime.now(UTC).isoformat()

    with conn:
        conn.execute(
            """
            INSERT INTO overrides (id, study_id, values_hash, status, reason, created_by, created_at, revoked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (
                override_id,
                study_id,
                values_hash,
                req.status,
                req.reason,
                actor,
                now,
            ),
        )

        write_audit(
            conn=conn,
            action="create",
            entity="override",
            entity_id=override_id,
            study_id=study_id,
            details={
                "values_hash": values_hash,
                "status": req.status,
                "reason": req.reason,
            },
            actor=actor,
        )

    row = conn.execute("SELECT * FROM overrides WHERE id = ?", (override_id,)).fetchone()
    return _row_to_override(row)


def list_overrides(
    conn: sqlite3.Connection,
    study_id: str,
    include_revoked: bool = False,
) -> list[OverrideResponse]:
    if include_revoked:
        rows = conn.execute(
            "SELECT * FROM overrides WHERE study_id = ? ORDER BY created_at DESC",
            (study_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM overrides WHERE study_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
            (study_id,),
        ).fetchall()
    return [_row_to_override(r) for r in rows]


def get_override(conn: sqlite3.Connection, override_id: str) -> OverrideResponse | None:
    row = conn.execute("SELECT * FROM overrides WHERE id = ?", (override_id,)).fetchone()
    if not row:
        return None
    return _row_to_override(row)


def revoke_override(
    conn: sqlite3.Connection,
    override_id: str,
    actor: str = "local-user",
) -> OverrideResponse | None:
    row = conn.execute("SELECT * FROM overrides WHERE id = ?", (override_id,)).fetchone()
    if not row:
        return None

    if row["revoked_at"] is not None:
        return _row_to_override(row)

    now = datetime.now(UTC).isoformat()
    with conn:
        conn.execute(
            "UPDATE overrides SET revoked_at = ? WHERE id = ?",
            (now, override_id),
        )
        write_audit(
            conn=conn,
            action="revoke",
            entity="override",
            entity_id=override_id,
            study_id=row["study_id"],
            details={"values_hash": row["values_hash"]},
            actor=actor,
        )

    updated_row = conn.execute("SELECT * FROM overrides WHERE id = ?", (override_id,)).fetchone()
    return _row_to_override(updated_row)


def get_active_overrides_map(
    conn: sqlite3.Connection,
    study_id: str,
) -> dict[str, OverrideResponse]:
    """Map of values_hash -> active OverrideResponse. Later overrides take precedence."""
    rows = conn.execute(
        "SELECT * FROM overrides WHERE study_id = ? AND revoked_at IS NULL ORDER BY created_at ASC",
        (study_id,),
    ).fetchall()
    mapping: dict[str, OverrideResponse] = {}
    for r in rows:
        ovr = _row_to_override(r)
        mapping[ovr.values_hash] = ovr
    return mapping
