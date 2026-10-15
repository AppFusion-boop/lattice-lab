"""API router for Source operations (provenance records)."""

from __future__ import annotations

from fastapi import APIRouter, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import sources as sources_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import SourceCreate, SourceResponse

router = APIRouter(tags=["sources"])


@router.get("/studies/{study_id}/sources", response_model=list[SourceResponse])
def list_sources(
    study_id: str,
    conn: DbConn,
) -> list[SourceResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return sources_repo.list_sources(conn, study_id)


@router.post(
    "/studies/{study_id}/sources",
    response_model=SourceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_source(
    study_id: str,
    source: SourceCreate,
    conn: DbConn,
) -> SourceResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return sources_repo.create_source(conn, study_id, source)


@router.get("/sources/{source_id}", response_model=SourceResponse)
def get_source(
    source_id: str,
    conn: DbConn,
) -> SourceResponse:
    src = sources_repo.get_source(conn, source_id)
    if not src:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Source '{source_id}' not found",
        )
    return src
