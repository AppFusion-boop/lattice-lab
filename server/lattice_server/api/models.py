"""API router for model versions."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import APIRouter, status

from lattice_server.db import DbConn
from lattice_server.engine import bridge
from lattice_server.errors import ApiHttpError
from lattice_server.repo import models as models_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    ModelVersionCreate,
    ModelVersionResponse,
)

router = APIRouter(tags=["models"])


def _calculate_nominal_values(parameters: list[Any]) -> dict[str, Any]:
    nominal: dict[str, Any] = {}
    for p in parameters:
        k = p.kind
        r = p.role
        s = p.spec
        if k == "continuous":
            if r == "fixed":
                nominal[p.key] = float(s.get("value", 0.0))
            else:
                p_min = float(s.get("min", 0.0))
                p_max = float(s.get("max", 1.0))
                nominal[p.key] = (p_min + p_max) / 2.0
        elif k == "integer":
            if r == "fixed":
                nominal[p.key] = int(s.get("value", 0))
            else:
                p_min = int(s.get("min", 0))
                p_max = int(s.get("max", 10))
                nominal[p.key] = round((p_min + p_max) / 2)
        elif k == "categorical":
            if r == "fixed":
                nominal[p.key] = s.get("value", "")
            else:
                opts = s.get("options", [""])
                nominal[p.key] = opts[0] if opts else ""
    return nominal


@router.get(
    "/studies/{study_id}/models",
    response_model=list[ModelVersionResponse],
)
def list_model_versions(
    study_id: str,
    conn: DbConn,
) -> list[ModelVersionResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return models_repo.get_model_versions(conn, study_id)


@router.get(
    "/studies/{study_id}/models/latest",
    response_model=ModelVersionResponse,
)
def get_latest_model_version(
    study_id: str,
    conn: DbConn,
) -> ModelVersionResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    mv = models_repo.get_latest_model_version(conn, study_id)
    if not mv:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="no_model_version",
            message="No model versions found for this study",
        )
    return mv


@router.get(
    "/models/{model_id}",
    response_model=ModelVersionResponse,
)
def get_model_version(
    model_id: str,
    conn: DbConn,
) -> ModelVersionResponse:
    mv = models_repo.get_model_version(conn, model_id)
    if not mv:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Model version '{model_id}' not found",
        )
    return mv


@router.post(
    "/studies/{study_id}/models",
    response_model=ModelVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_model_version(
    study_id: str,
    payload: ModelVersionCreate,
    conn: DbConn,
) -> ModelVersionResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    # 1. Parameter completeness check
    study_params = parameters_repo.list_parameters(conn, study_id)
    param_by_key = {p.key: p for p in study_params}
    bound_keys = {pb.parameter_key for pb in payload.parameter_bindings}

    for p in study_params:
        if p.role in ("controlled", "uncertain") and p.key not in bound_keys:
            raise ApiHttpError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="missing_parameter_binding",
                message=f"Parameter '{p.key}' ({p.role}) must be bound to a node field or marked 'not in model'.",
            )

    # 2. Build active bindings for verification & check dimensional compatibility
    from lattice_server.units import convert_unit

    active_param_bindings = []
    for pb in payload.parameter_bindings:
        if not pb.not_in_model:
            if not pb.node_id or not pb.param_key:
                raise ApiHttpError(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    code="invalid_binding",
                    message=f"Parameter '{pb.parameter_key}' requires nodeId and paramKey unless marked 'not in model'.",
                )
            p_obj = param_by_key.get(pb.parameter_key)
            if p_obj and p_obj.unit and not pb.param_unit:
                pb.param_unit = p_obj.unit
            if pb.param_unit and pb.field_unit:
                try:
                    convert_unit(1.0, pb.param_unit, pb.field_unit)
                except ValueError as exc:
                    raise ApiHttpError(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        code="incompatible_units",
                        message=f"Incompatible units for parameter '{pb.parameter_key}': {exc}",
                    ) from exc

            active_param_bindings.append(
                {
                    "parameterKey": pb.parameter_key,
                    "nodeId": pb.node_id,
                    "paramKey": pb.param_key,
                    "paramUnit": pb.param_unit,
                    "fieldUnit": pb.field_unit,
                }
            )

    active_outcome_bindings = [
        {
            "outcomeKey": ob.outcome_key,
            "nodeId": ob.node_id,
            "port": ob.port,
            "reducer": ob.reducer,
            "threshold": ob.threshold if ob.threshold is not None else 0.0,
        }
        for ob in payload.outcome_bindings
    ]

    # 3. Nominal values smoke test
    nominal_vals = _calculate_nominal_values(study_params)
    results = bridge.evaluate(
        project=payload.project,
        param_bindings=active_param_bindings,
        outcome_bindings=active_outcome_bindings,
        rows=[{"id": "nominal_check", "values": nominal_vals}],
    )

    if not results or results[0].status == "error":
        err_msg = results[0].message if results else "No result from engine"
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_model",
            message=f"Model verification failed on nominal values: {err_msg}",
        )

    # 4. Engine version & Signature
    h = bridge.health()
    engine_ver = h.get("engine_version")

    sig_src = (
        json.dumps(payload.project, sort_keys=True)
        + json.dumps([pb.model_dump() for pb in payload.parameter_bindings], sort_keys=True)
        + json.dumps([ob.model_dump() for ob in payload.outcome_bindings], sort_keys=True)
    )
    sig = hashlib.sha256(sig_src.encode("utf-8")).hexdigest()

    # 5. Persist
    return models_repo.create_model_version(
        conn=conn,
        study_id=study_id,
        payload=payload,
        engine_version=engine_ver,
        signature=sig,
    )


@router.post(
    "/studies/{study_id}/models/{model_id}/validate",
    response_model=dict[str, Any],
)
def validate_model_endpoint(
    study_id: str,
    model_id: str,
    conn: DbConn,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from lattice_server.stats.validation import validate_flow_model

    n_draws = int((payload or {}).get("n_draws", 60))
    return validate_flow_model(conn=conn, study_id=study_id, model_id=model_id, n_draws=n_draws)


@router.post(
    "/models/{model_id}/accept-validation",
    response_model=ModelVersionResponse,
)
def accept_model_validation_endpoint(
    model_id: str,
    payload: dict[str, Any],
    conn: DbConn,
) -> ModelVersionResponse:
    from lattice_server.stats.validation import accept_model_validation

    reason = str(payload.get("reason", ""))
    return accept_model_validation(conn=conn, model_id=model_id, reason=reason)

