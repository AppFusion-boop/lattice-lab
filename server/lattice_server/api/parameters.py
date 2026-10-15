"""API router for Parameter operations."""

from __future__ import annotations

from fastapi import APIRouter, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import ParameterCreate, ParameterResponse, ParameterUpdate

router = APIRouter(tags=["parameters"])


@router.get("/studies/{study_id}/parameters", response_model=list[ParameterResponse])
def list_parameters(
    study_id: str,
    conn: DbConn,
) -> list[ParameterResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return parameters_repo.list_parameters(conn, study_id)


@router.post(
    "/studies/{study_id}/parameters",
    response_model=ParameterResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_parameter(
    study_id: str,
    param: ParameterCreate,
    conn: DbConn,
) -> ParameterResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    existing = parameters_repo.get_parameter_by_key(conn, study_id, param.key)
    if existing:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="duplicate_key",
            message=f"Parameter with key '{param.key}' already exists in study",
            field="key",
        )

    return parameters_repo.create_parameter(conn, study_id, param)


@router.patch("/parameters/{param_id}", response_model=ParameterResponse)
def update_parameter(
    param_id: str,
    update: ParameterUpdate,
    conn: DbConn,
) -> ParameterResponse:
    existing = parameters_repo.get_parameter(conn, param_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Parameter '{param_id}' not found",
        )

    updated = parameters_repo.update_parameter(conn, param_id, update)
    if not updated:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Parameter '{param_id}' not found",
        )
    return updated


@router.delete("/parameters/{param_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_parameter(
    param_id: str,
    conn: DbConn,
) -> None:
    existing = parameters_repo.get_parameter(conn, param_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Parameter '{param_id}' not found",
        )

    parameters_repo.delete_parameter(conn, param_id)


@router.post("/studies/{study_id}/parameters/reorder", response_model=list[ParameterResponse])
def reorder_parameters(
    study_id: str,
    ordered_ids: list[str],
    conn: DbConn,
) -> list[ParameterResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    return parameters_repo.reorder_parameters(conn, study_id, ordered_ids)
