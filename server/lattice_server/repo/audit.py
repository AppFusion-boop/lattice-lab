"""Repository for querying the append-only audit log (§5, §6)."""

from __future__ import annotations

import json
import sqlite3

from lattice_server.schemas import AuditEntryResponse, AuditLogResponse


def list_audit_logs(
    conn: sqlite3.Connection,
    study_id: str,
    offset: int = 0,
    limit: int = 50,
    entity: str | None = None,
    action: str | None = None,
) -> AuditLogResponse:
    """Retrieve paginated audit log entries for a study, optionally filtered by entity and action."""
    where_clauses = ["study_id = ?"]
    params: list[object] = [study_id]

    if entity:
        where_clauses.append("entity = ?")
        params.append(entity)

    if action:
        where_clauses.append("action = ?")
        params.append(action)

    where_sql = " AND ".join(where_clauses)

    count_cursor = conn.execute(
        f"SELECT COUNT(*) FROM audit_log WHERE {where_sql}",
        params,
    )
    total = count_cursor.fetchone()[0]

    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    query_params = [*params, limit, offset]
    rows = conn.execute(
        f"""
        SELECT id, study_id, at, actor, action, entity, entity_id, details_json
        FROM audit_log
        WHERE {where_sql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
        """,
        query_params,
    ).fetchall()

    items: list[AuditEntryResponse] = []
    for row in rows:
        details = {}
        if row["details_json"]:
            try:
                details = json.loads(row["details_json"])
            except (ValueError, TypeError):
                details = {}

        items.append(
            AuditEntryResponse(
                id=row["id"],
                study_id=row["study_id"],
                at=row["at"],
                actor=row["actor"],
                action=row["action"],
                entity=row["entity"],
                entity_id=row["entity_id"],
                details=details,
            )
        )

    return AuditLogResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
    )
