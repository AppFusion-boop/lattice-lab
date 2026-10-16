"""API router for global sensitivity analysis (§4.4, §13)."""

from __future__ import annotations

from fastapi import APIRouter, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import models as models_repo
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    FreezingRecommendationModel,
    ParameterSensitivityModel,
    SensitivityRequest,
    SensitivityResponse,
)
from lattice_server.stats.sensitivity import compute_sobol_sensitivity

router = APIRouter(tags=["sensitivity"])


@router.post(
    "/studies/{study_id}/sensitivity",
    response_model=SensitivityResponse,
    status_code=status.HTTP_200_OK,
)
def run_sensitivity_analysis(
    study_id: str,
    req: SensitivityRequest,
    conn: DbConn,
) -> SensitivityResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    # Fetch active model
    model = models_repo.get_latest_model_version(conn, study_id)
    if not model or not model.project:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="no_active_model",
            message="Sensitivity analysis requires an active verified model version with parameter/outcome bindings.",
        )

    # Fetch parameters and outcomes
    params = parameters_repo.list_parameters(conn, study_id)
    outcomes = outcomes_repo.list_outcomes(conn, study_id)

    if not outcomes:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="no_outcomes",
            message="Study has no outcomes defined.",
        )

    # Select target outcome
    target_outcome = None
    if req.outcome_id:
        target_outcome = next((o for o in outcomes if o.id == req.outcome_id), None)
    elif req.outcome_key:
        target_outcome = next((o for o in outcomes if o.key == req.outcome_key), None)
    else:
        target_outcome = outcomes[0]

    if not target_outcome:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="outcome_not_found",
            message="Specified target outcome not found in study.",
        )

    seed = req.seed if req.seed is not None else study.rng_seed

    try:
        res = compute_sobol_sensitivity(
            model=model,
            parameters=params,
            outcome=target_outcome,
            n_samples=req.n_samples,
            seed=seed,
            freezing_threshold=req.freezing_threshold,
        )
    except ValueError as e:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="sensitivity_error",
            message=str(e),
        )

    return SensitivityResponse(
        outcome_id=res.outcome_id,
        outcome_key=res.outcome_key,
        n_samples=res.n_samples,
        n_evaluations=res.n_evaluations,
        parameters=[
            ParameterSensitivityModel(
                param_id=p.param_id,
                name=p.name,
                key=p.key,
                first_order=p.first_order,
                total_order=p.total_order,
                ci_95=p.ci_95,
            )
            for p in res.parameters
        ],
        freezing_recommendations=[
            FreezingRecommendationModel(
                param_id=fr.param_id,
                key=fr.key,
                name=fr.name,
                reason=fr.reason,
                suggested_value=fr.suggested_value,
                unit=fr.unit,
            )
            for fr in res.freezing_recommendations
        ],
    )

