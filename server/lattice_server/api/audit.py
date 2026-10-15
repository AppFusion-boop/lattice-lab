"""API router for querying the audit log (§5, §6)."""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import audit as audit_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import AuditLogResponse

router = APIRouter(tags=["audit"])


@router.get(
    "/studies/{study_id}/audit",
    response_model=AuditLogResponse,
    status_code=status.HTTP_200_OK,
)
def get_study_audit_log(
    study_id: str,
    conn: DbConn,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    entity: str | None = Query(None),
    action: str | None = Query(None),
) -> AuditLogResponse:
    """Retrieve paginated audit log entries for a study, with optional entity and action filters."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    return audit_repo.list_audit_logs(
        conn=conn,
        study_id=study_id,
        offset=offset,
        limit=limit,
        entity=entity,
        action=action,
    )
