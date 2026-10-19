"""API router for reproducible scientific study reports (P6-1, T4-4)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, status
from fastapi.responses import PlainTextResponse

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import studies as studies_repo
from lattice_server.reports.markdown import generate_study_report

router = APIRouter(tags=["reports"])


@router.get("/studies/{study_id}/report")
def get_study_report_json(study_id: str, conn: DbConn) -> dict[str, Any]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return generate_study_report(conn, study_id)


@router.get("/studies/{study_id}/report.md", response_class=PlainTextResponse)
def get_study_report_markdown(study_id: str, conn: DbConn) -> PlainTextResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    rep = generate_study_report(conn, study_id)
    return PlainTextResponse(
        content=rep["markdown"],
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="study_report_{study_id}.md"'
        },
    )

