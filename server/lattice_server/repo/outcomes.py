"""Repository for Outcome operations."""

from __future__ import annotations

import json
import sqlite3

from lattice_server.audit import write_audit
from lattice_server.ids import new_id
from lattice_server.repo.parameters import ConflictError
from lattice_server.schemas import OutcomeCreate, OutcomeCriterion, OutcomeResponse, OutcomeUpdate


def _row_to_outcome(row: sqlite3.Row) -> OutcomeResponse:
    crit_raw = row["criterion_json"]
    crit = OutcomeCriterion.model_validate(json.loads(crit_raw)) if crit_raw else None
    return OutcomeResponse(
        id=row["id"],
        study_id=row["study_id"],
        key=row["key"],
        label=row["label"],
        unit=row["unit"],
        kind=row["kind"],
        direction=row["direction"],
        criterion=crit,
        position=row["position"],
    )


def list_outcomes(conn: sqlite3.Connection, study_id: str) -> list[OutcomeResponse]:
    rows = conn.execute(
        "SELECT * FROM outcomes WHERE study_id = ? ORDER BY position ASC",
        (study_id,),
    ).fetchall()
    return [_row_to_outcome(r) for r in rows]


def get_outcome(conn: sqlite3.Connection, outcome_id: str) -> OutcomeResponse | None:
    row = conn.execute("SELECT * FROM outcomes WHERE id = ?", (outcome_id,)).fetchone()
    if not row:
        return None
    return _row_to_outcome(row)


def get_outcome_by_key(conn: sqlite3.Connection, study_id: str, key: str) -> OutcomeResponse | None:
    row = conn.execute(
        "SELECT * FROM outcomes WHERE study_id = ? AND key = ?",
        (study_id, key),
    ).fetchone()
    if not row:
        return None
    return _row_to_outcome(row)


def create_outcome(
    conn: sqlite3.Connection,
    study_id: str,
    outcome: OutcomeCreate,
    outcome_id: str | None = None,
    actor: str = "local-user",
) -> OutcomeResponse:
    oid = outcome_id or new_id("out")
    pos_row = conn.execute(
        "SELECT IFNULL(MAX(position), 0) + 1 AS next_pos FROM outcomes WHERE study_id = ?",
        (study_id,),
    ).fetchone()
    next_pos = pos_row["next_pos"]

    crit_json = (
        json.dumps(outcome.criterion.model_dump(), separators=(",", ":"), sort_keys=True)
        if outcome.criterion
        else None
    )

    conn.execute(
        """
        INSERT INTO outcomes (id, study_id, key, label, unit, kind, direction, criterion_json, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            oid,
            study_id,
            outcome.key,
            outcome.label,
            outcome.unit,
            outcome.kind,
            outcome.direction,
            crit_json,
            next_pos,
        ),
    )

    write_audit(
        conn,
        action="create",
        entity="outcome",
        entity_id=oid,
        study_id=study_id,
        details={"key": outcome.key, "kind": outcome.kind, "direction": outcome.direction},
        actor=actor,
    )

    row = conn.execute("SELECT * FROM outcomes WHERE id = ?", (oid,)).fetchone()
    return _row_to_outcome(row)


def update_outcome(
    conn: sqlite3.Connection,
    outcome_id: str,
    update: OutcomeUpdate,
    actor: str = "local-user",
) -> OutcomeResponse | None:
    existing = get_outcome(conn, outcome_id)
    if not existing:
        return None

    updates: list[str] = []
    params: list[object] = []
    changed: dict[str, object] = {}

    if update.label is not None:
        updates.append("label = ?")
        params.append(update.label)
        changed["label"] = update.label
    if update.unit is not None:
        updates.append("unit = ?")
        params.append(update.unit)
        changed["unit"] = update.unit
    if update.direction is not None:
        updates.append("direction = ?")
        params.append(update.direction)
        changed["direction"] = update.direction
    if update.criterion is not None:
        updates.append("criterion_json = ?")
        crit_dump = json.dumps(update.criterion.model_dump(), separators=(",", ":"), sort_keys=True)
        params.append(crit_dump)
        changed["criterion"] = update.criterion.model_dump()

    if updates:
        params.append(outcome_id)
        conn.execute(f"UPDATE outcomes SET {', '.join(updates)} WHERE id = ?", params)

        write_audit(
            conn,
            action="update",
            entity="outcome",
            entity_id=outcome_id,
            study_id=existing.study_id,
            details=changed,
            actor=actor,
        )

    return get_outcome(conn, outcome_id)


def delete_outcome(
    conn: sqlite3.Connection,
    outcome_id: str,
    actor: str = "local-user",
) -> None:
    existing = get_outcome(conn, outcome_id)
    if not existing:
        return

    # Check if evidence references this outcome key
    evidence_check = conn.execute(
        """
        SELECT COUNT(*) as count FROM evidence
        WHERE study_id = ? AND json_extract(outcomes_json, '$.' || ?) IS NOT NULL
        """,
        (existing.study_id, existing.key),
    ).fetchone()

    if evidence_check and evidence_check["count"] > 0:
        raise ConflictError(
            f"Cannot delete outcome '{existing.key}': referenced by existing evidence records."
        )

    conn.execute("DELETE FROM outcomes WHERE id = ?", (outcome_id,))

    write_audit(
        conn,
        action="delete",
        entity="outcome",
        entity_id=outcome_id,
        study_id=existing.study_id,
        details={"key": existing.key},
        actor=actor,
    )
