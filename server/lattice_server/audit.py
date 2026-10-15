"""Audit log helper for append-only transaction tracking."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any


def write_audit(
    conn: sqlite3.Connection,
    action: str,
    entity: str,
    entity_id: str | None = None,
    study_id: str | None = None,
    details: dict[str, Any] | None = None,
    actor: str = "local-user",
) -> int:
    """Write an audit log entry within the caller's transaction."""
    at = datetime.now(UTC).isoformat()
    details_json = json.dumps(details or {}, separators=(",", ":"), sort_keys=True)
    cursor = conn.execute(
        """
        INSERT INTO audit_log (study_id, at, actor, action, entity, entity_id, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (study_id, at, actor, action, entity, entity_id, details_json),
    )
    return cursor.lastrowid or 0
