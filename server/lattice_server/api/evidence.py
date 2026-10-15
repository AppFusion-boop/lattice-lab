"""API router for Evidence operations (immutable scientific evidence store)."""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import evidence as evidence_repo
from lattice_server.repo import sources as sources_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    EvidenceCreate,
    EvidenceResponse,
    EvidenceRetractRequest,
)

router = APIRouter(tags=["evidence"])


@router.get("/studies/{study_id}/evidence", response_model=list[EvidenceResponse])
def list_evidence(
    study_id: str,
    conn: DbConn,
    include_retracted: bool = Query(default=False),
    status_filter: str | None = Query(default=None, alias="status"),
    kind_filter: str | None = Query(default=None, alias="kind"),
    source_id: str | None = Query(default=None),
    candidate_id: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
) -> list[EvidenceResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return evidence_repo.list_evidence(
        conn=conn,
        study_id=study_id,
        include_retracted=include_retracted,
        status_filter=status_filter,
        kind_filter=kind_filter,
        source_id=source_id,
        candidate_id=candidate_id,
        offset=offset,
        limit=limit,
    )


@router.post(
    "/studies/{study_id}/evidence",
    response_model=EvidenceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_evidence(
    study_id: str,
    evidence: EvidenceCreate,
    conn: DbConn,
) -> EvidenceResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    if evidence.source_id:
        src = sources_repo.get_source(conn, evidence.source_id)
        if not src:
            raise ApiHttpError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="invalid_source",
                message=f"Source '{evidence.source_id}' not found",
                field="source_id",
            )

    return evidence_repo.create_evidence(conn, study_id, evidence)


@router.get("/evidence/{evidence_id}", response_model=EvidenceResponse)
def get_evidence(
    evidence_id: str,
    conn: DbConn,
) -> EvidenceResponse:
    evi = evidence_repo.get_evidence(conn, evidence_id)
    if not evi:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Evidence '{evidence_id}' not found",
        )
    return evi


@router.post(
    "/evidence/{evidence_id}/supersede",
    response_model=EvidenceResponse,
    status_code=status.HTTP_201_CREATED,
)
def supersede_evidence(
    evidence_id: str,
    new_evidence: EvidenceCreate,
    conn: DbConn,
) -> EvidenceResponse:
    existing = evidence_repo.get_evidence(conn, evidence_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Evidence '{evidence_id}' not found",
        )

    if existing.retracted_at is not None:
        raise ApiHttpError(
            status_code=status.HTTP_409_CONFLICT,
            code="conflict",
            message=f"Cannot supersede already retracted evidence '{evidence_id}'",
        )

    if new_evidence.source_id:
        src = sources_repo.get_source(conn, new_evidence.source_id)
        if not src:
            raise ApiHttpError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="invalid_source",
                message=f"Source '{new_evidence.source_id}' not found",
                field="source_id",
            )

    return evidence_repo.supersede_evidence(conn, evidence_id, new_evidence)


@router.post(
    "/evidence/{evidence_id}/retract",
    response_model=EvidenceResponse,
)
def retract_evidence(
    evidence_id: str,
    req: EvidenceRetractRequest,
    conn: DbConn,
) -> EvidenceResponse:
    existing = evidence_repo.get_evidence(conn, evidence_id)
    if not existing:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Evidence '{evidence_id}' not found",
        )

    if existing.retracted_at is not None:
        raise ApiHttpError(
            status_code=status.HTTP_409_CONFLICT,
            code="conflict",
            message=f"Evidence '{evidence_id}' is already retracted",
        )

    return evidence_repo.retract_evidence(conn, evidence_id, req.reason)
