"""API router for Constraint operations."""

from __future__ import annotations

from fastapi import APIRouter, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import constraints as constraints_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import ConstraintCreate, ConstraintResponse, ConstraintUpdate

router = APIRouter(tags=["constraints"])


@router.get("/studies/{study_id}/constraints", response_model=list[ConstraintResponse])
def list_constraints(
    study_id: str,
    conn: DbConn,
) -> list[ConstraintResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return constraints_repo.list_constraints(conn, study_id)


@router.post(
    "/studies/{study_id}/constraints",
    response_model=ConstraintResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_constraint(
    study_id: str,
    constraint: ConstraintCreate,
    conn: DbConn,
) -> ConstraintResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    try:
        return constraints_repo.create_constraint(conn, study_id, constraint)
    except ValueError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_constraint_expression",
            message=str(exc),
            field="expression",
        ) from exc


@router.patch("/constraints/{constraint_id}", response_model=ConstraintResponse)
def update_constraint(
    constraint_id: str,
    update: ConstraintUpdate,
    conn: DbConn,
) -> ConstraintResponse:
    existing = constraints_repo.get_constraint(conn, constraint_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Constraint '{constraint_id}' not found",
        )

    try:
        updated = constraints_repo.update_constraint(conn, constraint_id, update)
    except ValueError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_constraint_expression",
            message=str(exc),
            field="expression",
        ) from exc

    if not updated:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Constraint '{constraint_id}' not found",
        )
    return updated


@router.delete("/constraints/{constraint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_constraint(
    constraint_id: str,
    conn: DbConn,
) -> None:
    existing = constraints_repo.get_constraint(conn, constraint_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Constraint '{constraint_id}' not found",
        )

    constraints_repo.delete_constraint(conn, constraint_id)
