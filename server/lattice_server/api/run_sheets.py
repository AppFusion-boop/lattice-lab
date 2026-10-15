"""API router for Run Sheet operations (§4.5, §6)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Response, UploadFile, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import run_sheets as run_sheets_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    RunSheetCreate,
    RunSheetImportResponse,
    RunSheetResponse,
)

router = APIRouter(tags=["run-sheets"])


@router.post(
    "/studies/{study_id}/run-sheets",
    response_model=RunSheetResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_run_sheet(
    study_id: str,
    req: RunSheetCreate,
    conn: DbConn,
) -> RunSheetResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    return run_sheets_repo.create_run_sheet(conn, study_id, req)


@router.get("/studies/{study_id}/run-sheets", response_model=list[RunSheetResponse])
def list_run_sheets(
    study_id: str,
    conn: DbConn,
) -> list[RunSheetResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return run_sheets_repo.list_run_sheets(conn, study_id)


@router.get("/run-sheets/{run_sheet_id}.csv")
def download_run_sheet_csv(
    run_sheet_id: str,
    conn: DbConn,
) -> Response:
    rs = run_sheets_repo.get_run_sheet(conn, run_sheet_id)
    if not rs:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Run sheet '{run_sheet_id}' not found",
        )

    csv_text = run_sheets_repo.generate_run_sheet_csv(conn, run_sheet_id)
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="run_sheet_{run_sheet_id}.csv"'},
    )


@router.get("/run-sheets/{run_sheet_id}", response_model=RunSheetResponse)
def get_run_sheet(
    run_sheet_id: str,
    conn: DbConn,
) -> RunSheetResponse:
    rs = run_sheets_repo.get_run_sheet(conn, run_sheet_id)
    if not rs:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Run sheet '{run_sheet_id}' not found",
        )
    return rs


@router.post(
    "/run-sheets/{run_sheet_id}/results",
    response_model=RunSheetImportResponse,
)
async def import_run_sheet_results(
    run_sheet_id: str,
    conn: DbConn,
    file: Annotated[UploadFile, File()],
) -> RunSheetImportResponse:
    rs = run_sheets_repo.get_run_sheet(conn, run_sheet_id)
    if not rs:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Run sheet '{run_sheet_id}' not found",
        )

    content = await file.read()
    filename = file.filename or "results.csv"

    return run_sheets_repo.import_run_sheet_results(
        conn=conn,
        run_sheet_id=run_sheet_id,
        content=content,
        filename=filename,
    )
