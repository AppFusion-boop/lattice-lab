"""API router for screening runs."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, status

from lattice_server import db
from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.jobs import JobContext, job_manager
from lattice_server.repo import candidates as candidates_repo
from lattice_server.repo import screening as screening_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    JobResponse,
    ScreeningRunRequest,
    ScreeningRunResponse,
)
from lattice_server.screening.pipeline import run_screening_pipeline

router = APIRouter(tags=["screening"])


@router.post(
    "/studies/{study_id}/screening-runs",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_screening_run(
    study_id: str,
    req: ScreeningRunRequest,
    conn: DbConn,
) -> JobResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    active_cset = candidates_repo.get_active_candidate_set(conn, study_id)
    if not active_cset:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="no_active_candidate_set",
            message="Cannot run screening: study has no active candidate set.",
        )

    settings = req.settings

    def worker(ctx: JobContext) -> dict[str, Any]:
        worker_conn = db.connect()
        try:
            run_res = run_screening_pipeline(
                conn=worker_conn,
                study_id=study_id,
                candidate_set_id=active_cset.id,
                settings=settings,
                job_id=ctx.job_id,
                progress_callback=ctx.progress,
                is_cancelled_callback=ctx.is_cancelled,
            )
            return {"run_id": run_res.id, "summary": run_res.summary.model_dump()}
        finally:
            worker_conn.close()

    job_id = job_manager.submit(
        kind="screening",
        study_id=study_id,
        input_data=settings,
        fn=worker,
    )

    job = job_manager.get_job(job_id, conn=conn)
    if not job:
        raise ApiHttpError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="job_creation_failed",
            message="Failed to initialize screening job",
        )
    return job


@router.get(
    "/studies/{study_id}/screening-runs/latest",
    response_model=ScreeningRunResponse,
)
def get_latest_screening_run(
    study_id: str,
    conn: DbConn,
) -> ScreeningRunResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    run = screening_repo.get_latest_screening_run(conn, study_id)
    if not run:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="no_screening_run",
            message="No screening runs found for this study.",
        )
    return run


@router.get(
    "/studies/{study_id}/screening-runs/{run_id}",
    response_model=ScreeningRunResponse,
)
def get_screening_run(
    study_id: str,
    run_id: str,
    conn: DbConn,
) -> ScreeningRunResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    run = screening_repo.get_screening_run(conn, run_id)
    if not run or run.study_id != study_id:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Screening run '{run_id}' not found in study '{study_id}'",
        )
    return run
