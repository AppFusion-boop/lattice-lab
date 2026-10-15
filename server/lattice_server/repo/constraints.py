"""Repository for Constraint operations."""

from __future__ import annotations

import sqlite3

from lattice_server.audit import write_audit
from lattice_server.expr import compile_expression, expression_variables
from lattice_server.ids import new_id
from lattice_server.repo.parameters import list_parameters
from lattice_server.schemas import ConstraintCreate, ConstraintResponse, ConstraintUpdate


def _row_to_constraint(row: sqlite3.Row) -> ConstraintResponse:
    return ConstraintResponse(
        id=row["id"],
        study_id=row["study_id"],
        label=row["label"],
        expression=row["expression"],
        kind=row["kind"],
        penalty=row["penalty"],
        rationale=row["rationale"],
        source_id=row["source_id"],
        enabled=bool(row["enabled"]),
        position=row["position"],
    )


def validate_constraint_expression(conn: sqlite3.Connection, study_id: str, expr: str) -> None:
    """Ensure constraint expression references only controlled or fixed parameters."""
    params = list_parameters(conn, study_id)
    allowed_keys: set[str] = {p.key for p in params if p.role in ("controlled", "fixed")}
    uncertain_keys: set[str] = {p.key for p in params if p.role == "uncertain"}

    used_vars = expression_variables(expr)
    for v in used_vars:
        if v in uncertain_keys:
            raise ValueError(
                f"Uncertain parameter '{v}' cannot be used in a hard constraint. "
                "Hard constraints filter candidate designs before uncertain operating conditions vary."
            )
        if v not in allowed_keys:
            raise ValueError(
                f"Unknown variable '{v}' in constraint expression. "
                f"Allowed candidate parameters: {sorted(allowed_keys)}"
            )

    try:
        compile_expression(expr, variables=list(allowed_keys))
    except Exception as exc:
        raise ValueError(f"Invalid constraint expression: {exc}") from exc


def list_constraints(conn: sqlite3.Connection, study_id: str) -> list[ConstraintResponse]:
    rows = conn.execute(
        "SELECT * FROM constraints WHERE study_id = ? ORDER BY position ASC",
        (study_id,),
    ).fetchall()
    return [_row_to_constraint(r) for r in rows]


def get_constraint(conn: sqlite3.Connection, constraint_id: str) -> ConstraintResponse | None:
    row = conn.execute("SELECT * FROM constraints WHERE id = ?", (constraint_id,)).fetchone()
    if not row:
        return None
    return _row_to_constraint(row)


def create_constraint(
    conn: sqlite3.Connection,
    study_id: str,
    constraint: ConstraintCreate,
    constraint_id: str | None = None,
    actor: str = "local-user",
) -> ConstraintResponse:
    cid = constraint_id or new_id("cst")
    validate_constraint_expression(conn, study_id, constraint.expression)

    pos_row = conn.execute(
        "SELECT IFNULL(MAX(position), 0) + 1 AS next_pos FROM constraints WHERE study_id = ?",
        (study_id,),
    ).fetchone()
    next_pos = pos_row["next_pos"]

    conn.execute(
        """
        INSERT INTO constraints (
            id, study_id, label, expression, kind, penalty, rationale, source_id, enabled, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            cid,
            study_id,
            constraint.label,
            constraint.expression,
            constraint.kind,
            constraint.penalty,
            constraint.rationale,
            constraint.source_id,
            1 if constraint.enabled else 0,
            next_pos,
        ),
    )

    write_audit(
        conn,
        action="create",
        entity="constraint",
        entity_id=cid,
        study_id=study_id,
        details={"label": constraint.label, "kind": constraint.kind, "expression": constraint.expression},
        actor=actor,
    )

    row = conn.execute("SELECT * FROM constraints WHERE id = ?", (cid,)).fetchone()
    return _row_to_constraint(row)


def update_constraint(
    conn: sqlite3.Connection,
    constraint_id: str,
    update: ConstraintUpdate,
    actor: str = "local-user",
) -> ConstraintResponse | None:
    existing = get_constraint(conn, constraint_id)
    if not existing:
        return None

    if update.expression is not None:
        validate_constraint_expression(conn, existing.study_id, update.expression)

    updates: list[str] = []
    params: list[object] = []
    changed: dict[str, object] = {}

    if update.label is not None:
        updates.append("label = ?")
        params.append(update.label)
        changed["label"] = update.label
    if update.expression is not None:
        updates.append("expression = ?")
        params.append(update.expression)
        changed["expression"] = update.expression
    if update.kind is not None:
        updates.append("kind = ?")
        params.append(update.kind)
        changed["kind"] = update.kind
    if update.penalty is not None:
        updates.append("penalty = ?")
        params.append(update.penalty)
        changed["penalty"] = update.penalty
    if update.rationale is not None:
        updates.append("rationale = ?")
        params.append(update.rationale)
        changed["rationale"] = update.rationale
    if update.source_id is not None:
        updates.append("source_id = ?")
        params.append(update.source_id)
        changed["source_id"] = update.source_id
    if update.enabled is not None:
        updates.append("enabled = ?")
        params.append(1 if update.enabled else 0)
        changed["enabled"] = update.enabled

    if updates:
        params.append(constraint_id)
        conn.execute(f"UPDATE constraints SET {', '.join(updates)} WHERE id = ?", params)

        write_audit(
            conn,
            action="update",
            entity="constraint",
            entity_id=constraint_id,
            study_id=existing.study_id,
            details=changed,
            actor=actor,
        )

    return get_constraint(conn, constraint_id)


def delete_constraint(
    conn: sqlite3.Connection,
    constraint_id: str,
    actor: str = "local-user",
) -> None:
    existing = get_constraint(conn, constraint_id)
    if not existing:
        return

    conn.execute("DELETE FROM constraints WHERE id = ?", (constraint_id,))

    write_audit(
        conn,
        action="delete",
        entity="constraint",
        entity_id=constraint_id,
        study_id=existing.study_id,
        details={"label": existing.label},
        actor=actor,
    )
