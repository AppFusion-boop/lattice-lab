"""API router for background job status and cancellation."""

from __future__ import annotations

from fastapi import APIRouter, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.jobs import job_manager
from lattice_server.schemas import JobResponse

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobResponse)
def get_job_status(job_id: str, conn: DbConn) -> JobResponse:
    job = job_manager.get_job(job_id, conn=conn)
    if not job:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Job '{job_id}' not found",
        )
    return job


@router.post("/{job_id}/cancel", response_model=JobResponse)
def cancel_job(job_id: str, conn: DbConn) -> JobResponse:
    job = job_manager.get_job(job_id, conn=conn)
    if not job:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Job '{job_id}' not found",
        )

    job_manager.cancel(job_id)
    updated = job_manager.get_job(job_id, conn=conn)
    return updated or job
