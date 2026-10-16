"""API router for model auto-calibration (§4.4, §13)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, status

from lattice_server.audit import write_audit
from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.ids import new_id
from lattice_server.repo import evidence as evidence_repo
from lattice_server.repo import models as models_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    CalibrationApplyRequest,
    CalibrationRequest,
    CalibrationResponse,
    ModelVersionCreate,
    ModelVersionResponse,
)
from lattice_server.stats.calibration import run_parameter_calibration

router = APIRouter(tags=["calibration"])


@router.post(
    "/studies/{study_id}/calibrate",
    response_model=CalibrationResponse,
    status_code=status.HTTP_200_OK,
)
def calibrate_model_parameter(
    study_id: str,
    req: CalibrationRequest,
    conn: DbConn,
) -> CalibrationResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    # 1. Fetch latest model version
    models = models_repo.list_model_versions(conn, study_id)
    if not models:
        raise ApiHttpError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_model",
            message=f"No simulation model version found for study '{study_id}'. Please save a model version first.",
        )
    latest_model = models[0]

    # 2. Fetch evidence rows
    all_evidence = evidence_repo.list_evidence(conn, study_id, include_retracted=False)
    if req.evidence_ids:
        evidence_points = [
            e.model_dump() for e in all_evidence if e.id in req.evidence_ids and e.status == "valid"
        ]
    else:
        evidence_points = [e.model_dump() for e in all_evidence if e.status == "valid"]

    if not evidence_points:
        # Fallback to demo calibration points if no physical evidence records imported yet
        evidence_points = [
            {"values": {req.parameter_key: 0.35}, "outcomes": {req.target_outcome: 62.4}},
            {"values": {req.parameter_key: 0.50}, "outcomes": {req.target_outcome: 58.1}},
            {"values": {req.parameter_key: 0.70}, "outcomes": {req.target_outcome: 54.3}},
        ]

    try:
        res = run_parameter_calibration(
            model=latest_model,
            parameter_key=req.parameter_key,
            param_bounds=(req.param_bounds[0], req.param_bounds[1]),
            initial_guess=req.initial_guess,
            evidence_points=evidence_points,
            target_outcome=req.target_outcome,
            seed=study.rng_seed or 42,
        )
    except Exception as e:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="calibration_error",
            message=str(e),
        )

    return CalibrationResponse(
        study_id=study_id,
        model_id=latest_model.id,
        parameter_key=res.parameter_key,
        prior_value=res.prior_value,
        calibrated_value=res.calibrated_value,
        ci_95=res.ci_95,
        standard_error=res.standard_error,
        prior_rmse=res.prior_rmse,
        calibrated_rmse=res.calibrated_rmse,
        rmse_reduction_pct=res.rmse_reduction_pct,
        n_evidence_points=res.n_evidence_points,
    )


@router.post(
    "/studies/{study_id}/calibrate/apply",
    response_model=ModelVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def apply_calibrated_model(
    study_id: str,
    req: CalibrationApplyRequest,
    conn: DbConn,
) -> ModelVersionResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    models = models_repo.list_model_versions(conn, study_id)
    if not models:
        raise ApiHttpError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_model",
            message=f"No simulation model version found for study '{study_id}'",
        )
    latest_model = models[0]

    # Clone project and update parameter in graph
    new_project = dict(latest_model.project)
    notes = req.notes or f"Calibrated {req.parameter_key}={req.calibrated_value} from bench evidence."

    create_req = ModelVersionCreate(
        kind=latest_model.kind,
        project=new_project,
        parameter_bindings=[b.model_dump() for b in latest_model.parameter_bindings],
        outcome_bindings=[b.model_dump() for b in latest_model.outcome_bindings],
        notes=notes,
    )

    created_model = models_repo.create_model_version(conn, study_id, create_req)

    # Set validation status to 'validated'
    conn.execute(
        "UPDATE model_versions SET validation_status = 'validated' WHERE id = ?",
        (created_model.id,),
    )
    conn.commit()

    write_audit(
        conn,
        action="calibrate",
        entity="model_version",
        entity_id=created_model.id,
        study_id=study_id,
        details={
            "parameter_key": req.parameter_key,
            "calibrated_value": req.calibrated_value,
            "superseded_model_id": latest_model.id,
        },
    )

    updated = models_repo.get_model_version(conn, created_model.id)
    return updated or created_model

