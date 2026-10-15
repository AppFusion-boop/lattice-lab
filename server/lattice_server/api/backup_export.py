"""API router for backup and export operations (§4.5, §6)."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import backup_export as backup_export_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import BackupResponse

router = APIRouter(tags=["backup-export"])


@router.post(
    "/studies/{study_id}/backup",
    response_model=BackupResponse,
    status_code=status.HTTP_201_CREATED,
)
def backup_study(
    study_id: str,
    conn: DbConn,
) -> BackupResponse:
    """Create a point-in-time SQLite database backup."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    return backup_export_repo.create_backup(conn, study_id=study_id)


@router.get(
    "/studies/{study_id}/export.zip",
    status_code=status.HTTP_200_OK,
)
def export_study_zip(
    study_id: str,
    conn: DbConn,
) -> Response:
    """Export complete study data and metadata as a reproducible ZIP archive."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    zip_bytes = backup_export_repo.generate_study_export_zip(conn, study_id)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="study_{study_id}_export.zip"',
        },
    )
