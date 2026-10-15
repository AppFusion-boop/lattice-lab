"""Repository for Study operations."""

from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import UTC, datetime

from lattice_server.audit import write_audit
from lattice_server.ids import new_id
from lattice_server.schemas import StudyCreate, StudyResponse, StudyUpdate


def _row_to_study(row: sqlite3.Row) -> StudyResponse:
    settings = json.loads(row["settings_json"]) if row["settings_json"] else {}
    return StudyResponse(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        domain=row["domain"],
        exclusion_threshold=row["exclusion_threshold"],
        confidence=row["confidence"],
        cost_expression=row["cost_expression"],
        budget=row["budget"],
        max_engine_evaluations=row["max_engine_evaluations"],
        settings=settings,
        rng_seed=row["rng_seed"],
        archived=bool(row["archived"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def create_study(
    conn: sqlite3.Connection,
    study: StudyCreate,
    study_id: str | None = None,
    actor: str = "local-user",
) -> StudyResponse:
    sid = study_id or new_id("std")
    now = datetime.now(UTC).isoformat()
    rng_seed = study.rng_seed if study.rng_seed is not None else secrets.randbelow(2_000_000_000) + 1
    settings_json = json.dumps(study.settings, separators=(",", ":"), sort_keys=True)

    conn.execute(
        """
        INSERT INTO studies (
            id, name, description, domain, exclusion_threshold, confidence,
            cost_expression, budget, max_engine_evaluations, settings_json,
            rng_seed, archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        """,
        (
            sid,
            study.name,
            study.description,
            study.domain,
            study.exclusion_threshold,
            study.confidence,
            study.cost_expression,
            study.budget,
            study.max_engine_evaluations,
            settings_json,
            rng_seed,
            now,
            now,
        ),
    )

    write_audit(
        conn,
        action="create",
        entity="study",
        entity_id=sid,
        study_id=sid,
        details={"name": study.name, "domain": study.domain},
        actor=actor,
    )

    row = conn.execute("SELECT * FROM studies WHERE id = ?", (sid,)).fetchone()
    return _row_to_study(row)


def get_study(conn: sqlite3.Connection, study_id: str) -> StudyResponse | None:
    row = conn.execute("SELECT * FROM studies WHERE id = ?", (study_id,)).fetchone()
    if not row:
        return None
    return _row_to_study(row)


def list_studies(conn: sqlite3.Connection, include_archived: bool = False) -> list[StudyResponse]:
    if include_archived:
        rows = conn.execute("SELECT * FROM studies ORDER BY created_at DESC").fetchall()
    else:
        rows = conn.execute("SELECT * FROM studies WHERE archived = 0 ORDER BY created_at DESC").fetchall()
    return [_row_to_study(r) for r in rows]


def update_study(
    conn: sqlite3.Connection,
    study_id: str,
    update: StudyUpdate,
    actor: str = "local-user",
) -> StudyResponse | None:
    existing = get_study(conn, study_id)
    if not existing:
        return None

    now = datetime.now(UTC).isoformat()
    updates: list[str] = ["updated_at = ?"]
    params: list[object] = [now]
    changed: dict[str, object] = {}

    if update.name is not None:
        updates.append("name = ?")
        params.append(update.name)
        changed["name"] = update.name
    if update.description is not None:
        updates.append("description = ?")
        params.append(update.description)
        changed["description"] = update.description
    if update.domain is not None:
        updates.append("domain = ?")
        params.append(update.domain)
        changed["domain"] = update.domain
    if update.exclusion_threshold is not None:
        updates.append("exclusion_threshold = ?")
        params.append(update.exclusion_threshold)
        changed["exclusion_threshold"] = update.exclusion_threshold
    if update.confidence is not None:
        updates.append("confidence = ?")
        params.append(update.confidence)
        changed["confidence"] = update.confidence
    if update.cost_expression is not None:
        updates.append("cost_expression = ?")
        params.append(update.cost_expression)
        changed["cost_expression"] = update.cost_expression
    if update.budget is not None:
        updates.append("budget = ?")
        params.append(update.budget)
        changed["budget"] = update.budget
    if update.max_engine_evaluations is not None:
        updates.append("max_engine_evaluations = ?")
        params.append(update.max_engine_evaluations)
        changed["max_engine_evaluations"] = update.max_engine_evaluations
    if update.settings is not None:
        updates.append("settings_json = ?")
        params.append(json.dumps(update.settings, separators=(",", ":"), sort_keys=True))
        changed["settings"] = update.settings

    params.append(study_id)
    conn.execute(f"UPDATE studies SET {', '.join(updates)} WHERE id = ?", params)

    write_audit(
        conn,
        action="update",
        entity="study",
        entity_id=study_id,
        study_id=study_id,
        details=changed,
        actor=actor,
    )

    return get_study(conn, study_id)


def archive_study(
    conn: sqlite3.Connection,
    study_id: str,
    actor: str = "local-user",
) -> StudyResponse | None:
    existing = get_study(conn, study_id)
    if not existing:
        return None

    now = datetime.now(UTC).isoformat()
    conn.execute("UPDATE studies SET archived = 1, updated_at = ? WHERE id = ?", (now, study_id))

    write_audit(
        conn,
        action="archive",
        entity="study",
        entity_id=study_id,
        study_id=study_id,
        actor=actor,
    )

    return get_study(conn, study_id)
