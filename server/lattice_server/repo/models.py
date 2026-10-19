"""Repository for model versions."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime

from lattice_server import ids
from lattice_server.audit import write_audit
from lattice_server.schemas import (
    ModelVersionCreate,
    ModelVersionResponse,
    OutcomeBindingModel,
    ParameterBindingModel,
)


def _row_to_model_version(row: sqlite3.Row) -> ModelVersionResponse:
    param_bindings_raw = json.loads(row["parameter_bindings_json"] or "[]")
    outcome_bindings_raw = json.loads(row["outcome_bindings_json"] or "[]")
    project_raw = (
        json.loads(row["project_json"]) if row["project_json"] else None
    )
    val_json = (
        json.loads(row["validation_json"]) if row["validation_json"] else None
    )

    return ModelVersionResponse(
        id=row["id"],
        study_id=row["study_id"],
        version=row["version"],
        kind=row["kind"],
        project=project_raw,
        parameter_bindings=[
            ParameterBindingModel.model_validate(pb)
            for pb in param_bindings_raw
        ],
        outcome_bindings=[
            OutcomeBindingModel.model_validate(ob)
            for ob in outcome_bindings_raw
        ],
        engine_version=row["engine_version"],
        signature=row["signature"],
        validation_status=row["validation_status"],
        validation_json=val_json,
        notes=row["notes"],
        created_at=row["created_at"],
    )


def get_model_versions(
    conn: sqlite3.Connection, study_id: str
) -> list[ModelVersionResponse]:
    rows = conn.execute(
        """
        SELECT * FROM model_versions
        WHERE study_id = ?
        ORDER BY version DESC;
        """,
        (study_id,),
    ).fetchall()
    return [_row_to_model_version(r) for r in rows]


def get_latest_model_version(
    conn: sqlite3.Connection, study_id: str
) -> ModelVersionResponse | None:
    row = conn.execute(
        """
        SELECT * FROM model_versions
        WHERE study_id = ?
        ORDER BY version DESC
        LIMIT 1;
        """,
        (study_id,),
    ).fetchone()
    if not row:
        return None
    return _row_to_model_version(row)


def get_model_version(
    conn: sqlite3.Connection, model_id: str
) -> ModelVersionResponse | None:
    row = conn.execute(
        """
        SELECT * FROM model_versions
        WHERE id = ?;
        """,
        (model_id,),
    ).fetchone()
    if not row:
        return None
    return _row_to_model_version(row)


def create_model_version(
    conn: sqlite3.Connection,
    study_id: str,
    payload: ModelVersionCreate,
    engine_version: str | None,
    signature: str,
) -> ModelVersionResponse:
    row = conn.execute(
        "SELECT COALESCE(MAX(version), 0) + 1 AS next_v FROM model_versions WHERE study_id = ?;",
        (study_id,),
    ).fetchone()
    version = int(row["next_v"]) if row else 1

    model_id = ids.new_id("mod")
    now = datetime.now(UTC).isoformat()
    project_json = json.dumps(payload.project)
    param_bindings_json = json.dumps(
        [pb.model_dump() for pb in payload.parameter_bindings]
    )
    outcome_bindings_json = json.dumps(
        [ob.model_dump() for ob in payload.outcome_bindings]
    )

    conn.execute(
        """
        INSERT INTO model_versions (
            id, study_id, version, kind, project_json,
            parameter_bindings_json, outcome_bindings_json,
            engine_version, signature, validation_status,
            validation_json, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """,
        (
            model_id,
            study_id,
            version,
            "flow",
            project_json,
            param_bindings_json,
            outcome_bindings_json,
            engine_version,
            signature,
            "unvalidated",
            None,
            payload.notes,
            now,
        ),
    )

    write_audit(
        conn,
        action="create",
        entity="model_version",
        entity_id=model_id,
        study_id=study_id,
        actor="local-user",
        details={
            "version": version,
            "engine_version": engine_version,
            "notes": payload.notes,
            "parameter_bindings_count": len(payload.parameter_bindings),
            "outcome_bindings_count": len(payload.outcome_bindings),
        },
    )

    res = get_model_version(conn, model_id)
    assert res is not None
    return res
