"""API router for Outcome operations."""

from __future__ import annotations

from fastapi import APIRouter, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import OutcomeCreate, OutcomeResponse, OutcomeUpdate

router = APIRouter(tags=["outcomes"])


@router.get("/studies/{study_id}/outcomes", response_model=list[OutcomeResponse])
def list_outcomes(
    study_id: str,
    conn: DbConn,
) -> list[OutcomeResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return outcomes_repo.list_outcomes(conn, study_id)


@router.post(
    "/studies/{study_id}/outcomes",
    response_model=OutcomeResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_outcome(
    study_id: str,
    outcome: OutcomeCreate,
    conn: DbConn,
) -> OutcomeResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    existing = outcomes_repo.get_outcome_by_key(conn, study_id, outcome.key)
    if existing:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="duplicate_key",
            message=f"Outcome with key '{outcome.key}' already exists in study",
            field="key",
        )

    return outcomes_repo.create_outcome(conn, study_id, outcome)


@router.patch("/outcomes/{outcome_id}", response_model=OutcomeResponse)
def update_outcome(
    outcome_id: str,
    update: OutcomeUpdate,
    conn: DbConn,
) -> OutcomeResponse:
    existing = outcomes_repo.get_outcome(conn, outcome_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Outcome '{outcome_id}' not found",
        )

    updated = outcomes_repo.update_outcome(conn, outcome_id, update)
    if not updated:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Outcome '{outcome_id}' not found",
        )
    return updated


@router.delete("/outcomes/{outcome_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_outcome(
    outcome_id: str,
    conn: DbConn,
) -> None:
    existing = outcomes_repo.get_outcome(conn, outcome_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Outcome '{outcome_id}' not found",
        )

    outcomes_repo.delete_outcome(conn, outcome_id)
