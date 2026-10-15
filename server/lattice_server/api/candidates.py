"""API router for Candidate Set generation and Candidate inspection."""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, UploadFile, status

from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.importers import tabular
from lattice_server.repo import candidates as candidates_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    CandidateImportResponse,
    CandidateSetGenerateRequest,
    CandidateSetResponse,
    PaginatedCandidatesResponse,
)
from lattice_server.stats import doe
from lattice_server.stats.doe import TooManyCandidatesError

router = APIRouter(tags=["candidates"])


@router.post(
    "/studies/{study_id}/candidate-sets",
    response_model=CandidateSetResponse,
    status_code=status.HTTP_201_CREATED,
)
def generate_candidate_set(
    study_id: str,
    req: CandidateSetGenerateRequest,
    conn: DbConn,
) -> CandidateSetResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    params = parameters_repo.list_parameters(conn, study_id)
    controlled = [p for p in params if p.role == "controlled"]
    if not controlled:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="no_controlled_parameters",
            message="Study has no controlled parameters. Add at least one controlled parameter to generate candidates.",
            field="role",
        )

    method = req.method
    settings = req.settings

    try:
        if method == "grid":
            rows = doe.grid(params)
        elif method == "lhs":
            n = int(settings.get("n", 1000))
            seed = settings.get("seed")
            rows = doe.lhs(params, n=n, seed=seed)
        elif method == "sobol":
            n = int(settings.get("n", 1024))
            seed = settings.get("seed")
            rows = doe.sobol(params, n=n, seed=seed)
        else:
            raise ApiHttpError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="invalid_method",
                message=f"Unsupported candidate generation method: {method}",
                field="method",
            )
    except TooManyCandidatesError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="too_many_candidates",
            message=str(exc),
            field="method",
        ) from exc

    return candidates_repo.create_candidate_set(
        conn=conn,
        study_id=study_id,
        method=method,
        settings=settings,
        candidate_rows=rows,
    )


@router.post(
    "/studies/{study_id}/candidate-sets/import",
    response_model=CandidateImportResponse,
    status_code=status.HTTP_201_CREATED,
)
def import_candidate_set(
    study_id: str,
    conn: DbConn,
    file: Annotated[UploadFile, File()],
    mapping: Annotated[str | None, Form()] = None,
    skip_invalid: Annotated[bool, Form()] = False,
) -> CandidateImportResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    params = parameters_repo.list_parameters(conn, study_id)
    content = file.file.read()
    filename = file.filename or "candidates.csv"

    try:
        headers, data_rows = tabular.parse_tabular_file(content, filename)
    except ValueError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_file",
            message=str(exc),
            field="file",
        ) from exc

    if mapping:
        try:
            mapping_dict: dict[str, str] = json.loads(mapping)
        except Exception as exc:
            raise ApiHttpError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="invalid_mapping",
                message=f"Mapping must be valid JSON: {exc}",
                field="mapping",
            ) from exc
    else:
        # Auto-derive mapping from headers
        mapping_dict = {}
        for h in headers:
            clean_name, _ = tabular.parse_header_unit(h)
            clean_lower = clean_name.lower()
            if clean_lower in ("label", "id", "name", "candidate"):
                mapping_dict[h] = "label"
            else:
                for p in params:
                    if p.key.lower() == clean_lower or p.label.lower() == clean_lower:
                        mapping_dict[h] = p.key
                        break

    try:
        valid_rows, errors = tabular.validate_and_map_candidates(
            headers=headers,
            data_rows=data_rows,
            mapping=mapping_dict,
            params=params,
            skip_invalid=skip_invalid,
        )
    except ValueError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="validation_failed",
            message=str(exc),
            field="file",
        ) from exc

    if not valid_rows:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="no_valid_candidates",
            message="No valid candidate rows could be imported from the file.",
            field="file",
        )

    cset = candidates_repo.create_candidate_set(
        conn=conn,
        study_id=study_id,
        method="imported",
        settings={"filename": filename, "mapping": mapping_dict},
        candidate_rows=valid_rows,
    )

    return CandidateImportResponse(
        candidate_set=cset,
        imported_count=len(valid_rows),
        skipped_count=len(errors),
        errors=errors,
    )



@router.get("/studies/{study_id}/candidate-sets", response_model=list[CandidateSetResponse])
def list_candidate_sets(
    study_id: str,
    conn: DbConn,
) -> list[CandidateSetResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return candidates_repo.list_candidate_sets(conn, study_id)


@router.get("/studies/{study_id}/candidate-sets/active", response_model=CandidateSetResponse)
def get_active_candidate_set(
    study_id: str,
    conn: DbConn,
) -> CandidateSetResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    active = candidates_repo.get_active_candidate_set(conn, study_id)
    if not active:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="no_active_candidate_set",
            message="Study has no active candidate set.",
        )
    return active


@router.get("/studies/{study_id}/candidates", response_model=PaginatedCandidatesResponse)
def list_candidates(
    study_id: str,
    conn: DbConn,
    set_id: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    sort: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
) -> PaginatedCandidatesResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    return candidates_repo.list_candidates_paginated(
        conn=conn,
        study_id=study_id,
        set_id=set_id,
        status_filter=status_filter,
        sort=sort,
        offset=offset,
        limit=limit,
    )
