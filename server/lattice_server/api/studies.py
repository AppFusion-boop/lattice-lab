"""API router for Study operations."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Query, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.expr import compile_expression, expression_variables
from lattice_server.repo import constraints as constraints_repo
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    ConstraintCreate,
    OutcomeCreate,
    ParameterCreate,
    StudyCreate,
    StudyResponse,
    StudyUpdate,
    TemplateCreateRequest,
)

router = APIRouter(prefix="/studies", tags=["studies"])

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"


def _validate_cost_expression(conn: sqlite3.Connection, study_id: str, expr: str) -> None:
    params = parameters_repo.list_parameters(conn, study_id)
    allowed_keys = {p.key for p in params if p.role in ("controlled", "fixed")}
    used_vars = expression_variables(expr)
    for v in used_vars:
        if v not in allowed_keys:
            raise ApiHttpError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="invalid_cost_expression",
                message=f"Cost expression variable '{v}' is not an allowed controlled/fixed parameter",
                field="cost_expression",
            )
    try:
        compile_expression(expr, variables=list(allowed_keys))
    except Exception as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_cost_expression",
            message=f"Invalid cost expression: {exc}",
            field="cost_expression",
        ) from exc


@router.get("", response_model=list[StudyResponse])
def list_studies(
    conn: DbConn,
    include_archived: bool = Query(default=False),
) -> list[StudyResponse]:
    return studies_repo.list_studies(conn, include_archived=include_archived)


@router.post("", response_model=StudyResponse, status_code=status.HTTP_201_CREATED)
def create_study(
    study: StudyCreate,
    conn: DbConn,
) -> StudyResponse:
    if study.cost_expression:
        try:
            compile_expression(study.cost_expression)
        except Exception as exc:
            raise ApiHttpError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="invalid_cost_expression",
                message=f"Invalid cost expression: {exc}",
                field="cost_expression",
            ) from exc

    return studies_repo.create_study(conn, study)


@router.post("/from-template", response_model=StudyResponse, status_code=status.HTTP_201_CREATED)
def create_from_template(
    req: TemplateCreateRequest,
    conn: DbConn,
) -> StudyResponse:
    template_path = TEMPLATES_DIR / f"{req.template}.json"
    if not template_path.exists():
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="template_not_found",
            message=f"Template '{req.template}' not found",
            field="template",
        )

    data = json.loads(template_path.read_text(encoding="utf-8"))
    study_name = req.name or data["name"]

    study_create = StudyCreate(
        name=study_name,
        description=data.get("description", ""),
        domain=data.get("domain", "generic"),
        exclusion_threshold=data.get("exclusion_threshold", 0.05),
        confidence=data.get("confidence", 0.95),
        cost_expression=data.get("cost_expression"),
        budget=data.get("budget"),
        max_engine_evaluations=data.get("max_engine_evaluations", 50000),
        settings=data.get("settings", {}),
    )

    created_study = studies_repo.create_study(conn, study_create)

    # Add parameters
    for p_data in data.get("parameters", []):
        param_create = ParameterCreate.model_validate(p_data)
        parameters_repo.create_parameter(conn, created_study.id, param_create)

    # Add outcomes
    for o_data in data.get("outcomes", []):
        outcome_create = OutcomeCreate.model_validate(o_data)
        outcomes_repo.create_outcome(conn, created_study.id, outcome_create)

    # Add constraints
    for c_data in data.get("constraints", []):
        constraint_create = ConstraintCreate.model_validate(c_data)
        constraints_repo.create_constraint(conn, created_study.id, constraint_create)

    return created_study


@router.get("/{study_id}", response_model=StudyResponse)
def get_study(
    study_id: str,
    conn: DbConn,
) -> StudyResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return study


@router.patch("/{study_id}", response_model=StudyResponse)
def update_study(
    study_id: str,
    update: StudyUpdate,
    conn: DbConn,
) -> StudyResponse:
    existing = studies_repo.get_study(conn, study_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    if update.cost_expression is not None:
        _validate_cost_expression(conn, study_id, update.cost_expression)

    updated = studies_repo.update_study(conn, study_id, update)
    if not updated:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return updated


@router.post("/{study_id}/archive", response_model=StudyResponse)
def archive_study(
    study_id: str,
    conn: DbConn,
) -> StudyResponse:
    existing = studies_repo.get_study(conn, study_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    archived = studies_repo.archive_study(conn, study_id)
    if not archived:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return archived
