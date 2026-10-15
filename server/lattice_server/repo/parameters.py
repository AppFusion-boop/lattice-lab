"""Repository for Parameter operations."""

from __future__ import annotations

import json
import sqlite3

from lattice_server.audit import write_audit
from lattice_server.ids import new_id
from lattice_server.schemas import ParameterCreate, ParameterResponse, ParameterUpdate


class ConflictError(Exception):
    """Raised when an operation conflicts with existing immutable data (e.g. evidence)."""


def _row_to_parameter(row: sqlite3.Row) -> ParameterResponse:
    spec = json.loads(row["spec_json"]) if row["spec_json"] else {}
    return ParameterResponse(
        id=row["id"],
        study_id=row["study_id"],
        key=row["key"],
        label=row["label"],
        unit=row["unit"],
        kind=row["kind"],
        role=row["role"],
        spec=spec,
        position=row["position"],
    )


def list_parameters(conn: sqlite3.Connection, study_id: str) -> list[ParameterResponse]:
    rows = conn.execute(
        "SELECT * FROM parameters WHERE study_id = ? ORDER BY position ASC",
        (study_id,),
    ).fetchall()
    return [_row_to_parameter(r) for r in rows]


def get_parameter(conn: sqlite3.Connection, param_id: str) -> ParameterResponse | None:
    row = conn.execute("SELECT * FROM parameters WHERE id = ?", (param_id,)).fetchone()
    if not row:
        return None
    return _row_to_parameter(row)


def get_parameter_by_key(conn: sqlite3.Connection, study_id: str, key: str) -> ParameterResponse | None:
    row = conn.execute(
        "SELECT * FROM parameters WHERE study_id = ? AND key = ?",
        (study_id, key),
    ).fetchone()
    if not row:
        return None
    return _row_to_parameter(row)


def create_parameter(
    conn: sqlite3.Connection,
    study_id: str,
    param: ParameterCreate,
    param_id: str | None = None,
    actor: str = "local-user",
) -> ParameterResponse:
    pid = param_id or new_id("par")
    pos_row = conn.execute(
        "SELECT IFNULL(MAX(position), 0) + 1 AS next_pos FROM parameters WHERE study_id = ?",
        (study_id,),
    ).fetchone()
    next_pos = pos_row["next_pos"]

    spec_json = json.dumps(param.spec, separators=(",", ":"), sort_keys=True)

    conn.execute(
        """
        INSERT INTO parameters (id, study_id, key, label, unit, kind, role, spec_json, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            pid,
            study_id,
            param.key,
            param.label,
            param.unit,
            param.kind,
            param.role,
            spec_json,
            next_pos,
        ),
    )

    write_audit(
        conn,
        action="create",
        entity="parameter",
        entity_id=pid,
        study_id=study_id,
        details={"key": param.key, "kind": param.kind, "role": param.role},
        actor=actor,
    )

    row = conn.execute("SELECT * FROM parameters WHERE id = ?", (pid,)).fetchone()
    return _row_to_parameter(row)


def update_parameter(
    conn: sqlite3.Connection,
    param_id: str,
    update: ParameterUpdate,
    actor: str = "local-user",
) -> ParameterResponse | None:
    existing = get_parameter(conn, param_id)
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
    if update.role is not None:
        updates.append("role = ?")
        params.append(update.role)
        changed["role"] = update.role
    if update.spec is not None:
        updates.append("spec_json = ?")
        params.append(json.dumps(update.spec, separators=(",", ":"), sort_keys=True))
        changed["spec"] = update.spec

    if updates:
        params.append(param_id)
        conn.execute(f"UPDATE parameters SET {', '.join(updates)} WHERE id = ?", params)

        write_audit(
            conn,
            action="update",
            entity="parameter",
            entity_id=param_id,
            study_id=existing.study_id,
            details=changed,
            actor=actor,
        )

    return get_parameter(conn, param_id)


def delete_parameter(
    conn: sqlite3.Connection,
    param_id: str,
    actor: str = "local-user",
) -> None:
    existing = get_parameter(conn, param_id)
    if not existing:
        return

    # Check if evidence references this parameter key
    evidence_check = conn.execute(
        """
        SELECT COUNT(*) as count FROM evidence
        WHERE study_id = ? AND json_extract(values_json, '$.' || ?) IS NOT NULL
        """,
        (existing.study_id, existing.key),
    ).fetchone()

    if evidence_check and evidence_check["count"] > 0:
        raise ConflictError(
            f"Cannot delete parameter '{existing.key}': referenced by existing evidence records."
        )

    conn.execute("DELETE FROM parameters WHERE id = ?", (param_id,))

    write_audit(
        conn,
        action="delete",
        entity="parameter",
        entity_id=param_id,
        study_id=existing.study_id,
        details={"key": existing.key},
        actor=actor,
    )


def reorder_parameters(
    conn: sqlite3.Connection,
    study_id: str,
    ordered_ids: list[str],
    actor: str = "local-user",
) -> list[ParameterResponse]:
    for idx, pid in enumerate(ordered_ids, start=1):
        conn.execute(
            "UPDATE parameters SET position = ? WHERE id = ? AND study_id = ?",
            (idx, pid, study_id),
        )

    write_audit(
        conn,
        action="reorder",
        entity="parameter",
        study_id=study_id,
        details={"ordered_ids": ordered_ids},
        actor=actor,
    )

    return list_parameters(conn, study_id)
