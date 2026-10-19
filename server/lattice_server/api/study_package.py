"""API router for portable study packages (.lat format)."""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, File, Form, Response, UploadFile, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import studies as studies_repo
from lattice_server.repo import study_package as package_repo
from lattice_server.schemas import StudyPackageInspectResponse, StudyResponse

router = APIRouter(tags=["study-package"])


def _slugify(name: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", name.lower()).strip()
    slug = re.sub(r"[-\s]+", "_", cleaned)
    return slug or "study"


@router.get(
    "/studies/{study_id}/export.lat",
    status_code=status.HTTP_200_OK,
)
def export_study_lat(
    study_id: str,
    conn: DbConn,
) -> Response:
    """Export complete study as a single portable .lat archive."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    lat_bytes = package_repo.export_study_package(conn, study_id)
    slug = _slugify(study.name)
    filename = f"{slug}.lat"

    return Response(
        content=lat_bytes,
        media_type="application/x-lattice-study",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Study-Id": study.id,
            "X-Study-Name": study.name,
        },
    )


@router.post(
    "/studies/package/inspect",
    response_model=StudyPackageInspectResponse,
    status_code=status.HTTP_200_OK,
)
async def inspect_study_package_endpoint(
    file: Annotated[UploadFile, File()],
) -> StudyPackageInspectResponse:
    """Inspect and preview metadata from a .lat package without importing."""
    try:
        content = await file.read()
        inspected = package_repo.inspect_study_package(content)
        return StudyPackageInspectResponse.model_validate(inspected)
    except ValueError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_package",
            message=str(exc),
        ) from exc


@router.post(
    "/studies/package/import",
    response_model=StudyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_study_package_endpoint(
    conn: DbConn,
    file: Annotated[UploadFile, File()],
    name: Annotated[str | None, Form()] = None,
) -> StudyResponse:
    """Import a .lat package archive as a new fully restored study."""
    try:
        content = await file.read()
        return package_repo.import_study_package(
            conn=conn,
            zip_bytes=content,
            new_name=name,
        )
    except ValueError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_package",
            message=str(exc),
        ) from exc
    except Exception as exc:
        raise ApiHttpError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="import_failed",
            message=f"Study import failed: {exc}",
        ) from exc
