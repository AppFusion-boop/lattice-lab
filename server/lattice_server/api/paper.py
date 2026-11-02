"""FastAPI router for scientific research paper generation and export (PE-4)."""

from __future__ import annotations

import re

from fastapi import APIRouter, Response, status
from fastapi.responses import PlainTextResponse

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import studies as studies_repo
from lattice_server.reports.figures import (
    generate_funnel_figure,
    generate_pareto_figure,
    generate_phase_space_figure,
    generate_sensitivity_figure,
)
from lattice_server.reports.latex import build_paper_manuscript
from lattice_server.reports.paper_bundle import generate_paper_zip_bundle
from lattice_server.reports.paper_models import (
    PaperCustomizationRequest,
    PaperResponse,
)

router = APIRouter(tags=["paper"])


def _clean_slug(name: str) -> str:
    s = (name or "study").lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[-\s]+", "_", s)
    return s[:32] or "study"


@router.get("/studies/{study_id}/paper", response_model=PaperResponse)
def get_paper_manuscript(study_id: str, conn: DbConn) -> PaperResponse:
    """Generate default scientific paper manuscript model."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return build_paper_manuscript(conn, study_id)


@router.post("/studies/{study_id}/paper/preview", response_model=PaperResponse)
def preview_paper_customized(
    study_id: str, req: PaperCustomizationRequest, conn: DbConn
) -> PaperResponse:
    """Generate scientific paper with customized author metadata and options."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return build_paper_manuscript(conn, study_id, req)


@router.get("/studies/{study_id}/paper.tex", response_class=PlainTextResponse)
def get_paper_latex_file(study_id: str, conn: DbConn) -> PlainTextResponse:
    """Download single standalone LaTeX manuscript file."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    paper = build_paper_manuscript(conn, study_id)
    slug = _clean_slug(study.name)
    return PlainTextResponse(
        content=paper.latex,
        media_type="text/x-tex; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="paper_{slug}_{study_id[:8]}.tex"'},
    )


@router.get("/studies/{study_id}/paper.zip")
def download_paper_zip_bundle(study_id: str, conn: DbConn) -> Response:
    """Download complete Overleaf-ready publication archive (.zip)."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    zip_bytes = generate_paper_zip_bundle(conn, study_id)
    slug = _clean_slug(study.name)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="paper_{slug}_{study_id[:8]}_bundle.zip"'},
    )


@router.post("/studies/{study_id}/paper.zip")
def download_custom_paper_zip_bundle(
    study_id: str, req: PaperCustomizationRequest, conn: DbConn
) -> Response:
    """Download customized Overleaf-ready publication archive (.zip)."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    zip_bytes = generate_paper_zip_bundle(conn, study_id, req)
    slug = _clean_slug(study.name)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="paper_{slug}_{study_id[:8]}_bundle.zip"'},
    )


@router.post("/studies/{study_id}/paper.tex", response_class=PlainTextResponse)
def get_custom_paper_latex_file(
    study_id: str, req: PaperCustomizationRequest, conn: DbConn
) -> PlainTextResponse:
    """Download customized standalone LaTeX manuscript file."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    paper = build_paper_manuscript(conn, study_id, req)
    slug = _clean_slug(study.name)
    return PlainTextResponse(
        content=paper.latex,
        media_type="text/x-tex; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="paper_{slug}_{study_id[:8]}.tex"'},
    )


@router.get("/studies/{study_id}/paper/figures/{figure_name}.{fmt}")
def get_paper_figure(study_id: str, figure_name: str, fmt: str, conn: DbConn) -> Response:
    """Render and retrieve individual publication vector or raster figures."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    clean_fmt = fmt.lower()
    if clean_fmt not in ("png", "pdf", "svg"):
        raise ApiHttpError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_format",
            message="Supported formats are 'png', 'pdf', 'svg'",
        )

    clean_name = figure_name.lower().replace("-", "_")
    if "funnel" in clean_name:
        fig_bytes = generate_funnel_figure(conn, study_id, fmt=clean_fmt)
    elif "phase" in clean_name or "space" in clean_name:
        fig_bytes = generate_phase_space_figure(conn, study_id, fmt=clean_fmt)
    elif "sensitivity" in clean_name or "sobol" in clean_name or "tornado" in clean_name:
        fig_bytes = generate_sensitivity_figure(conn, study_id, fmt=clean_fmt)
    elif "pareto" in clean_name or "tradeoff" in clean_name:
        fig_bytes = generate_pareto_figure(conn, study_id, fmt=clean_fmt)
    else:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="figure_not_found",
            message=f"Figure '{figure_name}' not recognized. Available: funnel, phase_space, sensitivity, pareto.",
        )

    media_types = {
        "png": "image/png",
        "svg": "image/svg+xml",
        "pdf": "application/pdf",
    }
    return Response(content=fig_bytes, media_type=media_types[clean_fmt])
