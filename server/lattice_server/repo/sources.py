"""Repository for study data sources (provenance records)."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

from lattice_server.audit import write_audit
from lattice_server.ids import new_id
from lattice_server.schemas import SourceCreate, SourceResponse


def _row_to_source(row: sqlite3.Row) -> SourceResponse:
    return SourceResponse(
        id=row["id"],
        study_id=row["study_id"],
        kind=row["kind"],
        citation=row["citation"],
        doi=row["doi"],
        url=row["url"],
        file_name=row["file_name"],
        file_sha256=row["file_sha256"],
        notes=row["notes"],
        created_at=row["created_at"],
    )


def create_source(
    conn: sqlite3.Connection,
    study_id: str,
    req: SourceCreate,
    actor: str = "local-user",
) -> SourceResponse:
    sid = new_id("src")
    now = datetime.now(UTC).isoformat()

    with conn:
        conn.execute(
            """
            INSERT INTO sources (id, study_id, kind, citation, doi, url, file_name, file_sha256, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sid,
                study_id,
                req.kind,
                req.citation,
                req.doi,
                req.url,
                req.file_name,
                req.file_sha256,
                req.notes,
                now,
            ),
        )

        write_audit(
            conn=conn,
            action="create",
            entity="source",
            entity_id=sid,
            study_id=study_id,
            details={"kind": req.kind, "citation": req.citation},
            actor=actor,
        )

    row = conn.execute("SELECT * FROM sources WHERE id = ?", (sid,)).fetchone()
    return _row_to_source(row)


def get_source(conn: sqlite3.Connection, source_id: str) -> SourceResponse | None:
    row = conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
    if not row:
        return None
    return _row_to_source(row)


def list_sources(conn: sqlite3.Connection, study_id: str) -> list[SourceResponse]:
    rows = conn.execute(
        "SELECT * FROM sources WHERE study_id = ? ORDER BY created_at DESC",
        (study_id,),
    ).fetchall()
    return [_row_to_source(r) for r in rows]
