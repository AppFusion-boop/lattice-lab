"""API router for Tabular Evidence Import wizard (Phase 2, P2-3)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, UploadFile, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.importers.tabular import (
    commit_tabular_evidence,
    preview_tabular_evidence,
)
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import sources as sources_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    ImportCommitRequest,
    ImportCommitResponse,
    ImportPreviewResponse,
)

router = APIRouter(tags=["imports"])


@router.post(
    "/studies/{study_id}/imports/preview",
    response_model=ImportPreviewResponse,
)
async def preview_import(
    study_id: str,
    conn: DbConn,
    file: Annotated[UploadFile, File()],
) -> ImportPreviewResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    content = await file.read()
    filename = file.filename or "upload.csv"

    params = parameters_repo.list_parameters(conn, study_id)
    outcomes = outcomes_repo.list_outcomes(conn, study_id)

    return preview_tabular_evidence(
        study_id=study_id,
        content=content,
        filename=filename,
        params=params,
        outcomes=outcomes,
    )


@router.post(
    "/studies/{study_id}/imports/commit",
    response_model=ImportCommitResponse,
)
def commit_import(
    study_id: str,
    req: ImportCommitRequest,
    conn: DbConn,
) -> ImportCommitResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    if req.source_id:
        src = sources_repo.get_source(conn, req.source_id)
        if not src:
            raise ApiHttpError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="invalid_source",
                message=f"Source '{req.source_id}' not found",
                field="source_id",
            )

    return commit_tabular_evidence(
        conn=conn,
        study_id=study_id,
        req=req,
    )
