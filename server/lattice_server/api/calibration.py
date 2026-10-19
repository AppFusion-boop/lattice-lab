"""API router for model auto-calibration (§4.4, §13, T1-1)."""

from __future__ import annotations

import copy
import hashlib
import json

from fastapi import APIRouter, status

from lattice_server.audit import write_audit
from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import evidence as evidence_repo
from lattice_server.repo import models as models_repo
from lattice_server.repo import parameters as parameters_repo
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
    models = models_repo.get_model_versions(conn, study_id)
    if not models:
        raise ApiHttpError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_model",
            message=f"No simulation model version found for study '{study_id}'. Please save a model version first.",
        )
    latest_model = models[0]

    # Verify parameter is bound in the active model
    bound_param = next(
        (
            b
            for b in latest_model.parameter_bindings
            if b.parameter_key == req.parameter_key and not b.not_in_model and b.node_id and b.param_key
        ),
        None,
    )
    if not bound_param:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="unbound_parameter",
            message=f"Parameter '{req.parameter_key}' is not bound to any flow node in model v{latest_model.version}.",
            field="parameter_key",
        )

    # 2. Extract baseline nominal parameter defaults for complete row evaluation
    all_params = parameters_repo.list_parameters(conn, study_id)
    parameter_defaults: dict[str, float] = {}
    for p in all_params:
        spec = p.spec
        if "value" in spec and spec["value"] is not None and isinstance(spec["value"], (int, float)):
            parameter_defaults[p.key] = float(spec["value"])
        elif "min" in spec and "max" in spec:
            parameter_defaults[p.key] = (float(spec["min"]) + float(spec["max"])) / 2.0
        else:
            parameter_defaults[p.key] = 1.0

    # 3. Fetch real physical evidence rows (Hard Rule 1: NEVER invent synthetic data)
    all_evidence = evidence_repo.list_evidence(conn, study_id, include_retracted=False)
    if req.evidence_ids:
        evidence_points = [
            e.model_dump() for e in all_evidence if e.id in req.evidence_ids and e.status == "valid"
        ]
    else:
        evidence_points = [e.model_dump() for e in all_evidence if e.status == "valid"]

    valid_for_outcome = [
        ep for ep in evidence_points if req.target_outcome in (ep.get("outcomes") or {})
    ]
    if len(valid_for_outcome) < 3:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="insufficient_evidence",
            message=(
                f"Calibration requires at least 3 valid evidence records measuring "
                f"outcome '{req.target_outcome}' (found {len(valid_for_outcome)}). "
                f"Never invent synthetic calibration data (Hard Rule 1)."
            ),
            field="evidence_ids",
        )

    try:
        res = run_parameter_calibration(
            model=latest_model,
            parameter_key=req.parameter_key,
            param_bounds=(req.param_bounds[0], req.param_bounds[1]),
            initial_guess=req.initial_guess,
            evidence_points=valid_for_outcome,
            target_outcome=req.target_outcome,
            parameter_defaults=parameter_defaults,
            seed=study.rng_seed or 42,
        )
    except Exception as e:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="calibration_error",
            message=str(e),
        ) from e

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

    models = models_repo.get_model_versions(conn, study_id)
    if not models:
        raise ApiHttpError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_model",
            message=f"No simulation model version found for study '{study_id}'",
        )
    latest_model = models[0]

    # Deep-clone project and write calibrated_value into bound node parameter
    new_project = copy.deepcopy(latest_model.project) if latest_model.project else {}
    binding_applied = False
    for b in latest_model.parameter_bindings:
        if b.parameter_key == req.parameter_key and not b.not_in_model and b.node_id and b.param_key:
            for node in new_project.get("nodes", []):
                if node.get("id") == b.node_id:
                    node.setdefault("params", {})[b.param_key] = float(req.calibrated_value)
                    binding_applied = True
                    break

    if not binding_applied:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="unbound_parameter",
            message=f"Parameter '{req.parameter_key}' is not bound to any flow node in model v{latest_model.version}.",
            field="parameter_key",
        )

    notes = (
        req.notes
        or f"Calibrated {req.parameter_key}={req.calibrated_value} from bench evidence (unvalidated until coverage check)."
    )

    create_req = ModelVersionCreate(
        project=new_project,
        parameter_bindings=latest_model.parameter_bindings,
        outcome_bindings=latest_model.outcome_bindings,
        notes=notes,
    )

    sig_src = (
        json.dumps(new_project, sort_keys=True)
        + json.dumps([pb.model_dump() for pb in latest_model.parameter_bindings], sort_keys=True)
        + json.dumps([ob.model_dump() for ob in latest_model.outcome_bindings], sort_keys=True)
    )
    sig = hashlib.sha256(sig_src.encode("utf-8")).hexdigest()

    # Hard Rule 6: Newly calibrated models remain 'unvalidated' until coverage checks pass and a human accepts validation.
    created_model = models_repo.create_model_version(
        conn,
        study_id,
        create_req,
        engine_version=latest_model.engine_version,
        signature=sig,
    )

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

