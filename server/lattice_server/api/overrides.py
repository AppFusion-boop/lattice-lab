"""API router for candidate overrides."""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import overrides as overrides_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import OverrideCreate, OverrideResponse

router = APIRouter(tags=["overrides"])


@router.get("/studies/{study_id}/overrides", response_model=list[OverrideResponse])
def list_overrides(
    study_id: str,
    conn: DbConn,
    include_revoked: bool = Query(default=False),
) -> list[OverrideResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return overrides_repo.list_overrides(conn, study_id, include_revoked=include_revoked)


@router.post(
    "/studies/{study_id}/overrides",
    response_model=OverrideResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_override(
    study_id: str,
    req: OverrideCreate,
    conn: DbConn,
) -> OverrideResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    try:
        return overrides_repo.create_override(conn=conn, study_id=study_id, req=req)
    except ValueError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_override",
            message=str(exc),
            field="values_hash",
        ) from exc


@router.post("/overrides/{override_id}/revoke", response_model=OverrideResponse)
def revoke_override(
    override_id: str,
    conn: DbConn,
) -> OverrideResponse:
    revoked = overrides_repo.revoke_override(conn=conn, override_id=override_id)
    if not revoked:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Override '{override_id}' not found",
        )
    return revoked
