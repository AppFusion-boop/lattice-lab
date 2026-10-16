"""API router for Pareto frontier trade-off analysis (§4.4, §13)."""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Query, status

from lattice_server.db import DbConn
from lattice_server.engine import bridge
from lattice_server.errors import ApiHttpError
from lattice_server.repo import candidates as candidates_repo
from lattice_server.repo import models as models_repo
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import ParetoPointModel, ParetoResponse
from lattice_server.stats.pareto import compute_pareto_analysis

router = APIRouter(tags=["pareto"])


@router.get(
    "/studies/{study_id}/pareto",
    response_model=ParetoResponse,
    status_code=status.HTTP_200_OK,
)
def get_pareto_frontier(
    study_id: str,
    conn: DbConn,
    x_outcome: str = Query(..., description="Key of outcome for X-axis"),
    y_outcome: str = Query(..., description="Key of outcome for Y-axis"),
    x_direction: Literal["minimize", "maximize"] = Query("minimize"),
    y_direction: Literal["minimize", "maximize"] = Query("minimize"),
    max_candidates: int = Query(250, ge=10, le=1000),
) -> ParetoResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    # Check active candidate set
    active_cset = candidates_repo.get_active_candidate_set(conn, study_id)
    if not active_cset:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="no_candidates",
            message="Study has no active candidate set.",
        )

    # Fetch candidates from DB
    c_rows = conn.execute(
        """
        SELECT id, label, values_json
        FROM candidates
        WHERE candidate_set_id = ?
        ORDER BY idx ASC
        LIMIT ?
        """,
        (active_cset.id, max_candidates),
    ).fetchall()

    if not c_rows:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="no_candidates",
            message="No candidate records found in active set.",
        )

    # Parse candidate values
    candidates_list: list[dict[str, Any]] = []
    eval_batch: list[dict[str, Any]] = []
    for r in c_rows:
        vals = json.loads(r["values_json"]) if r["values_json"] else {}
        cand_dict = {
            "id": r["id"],
            "label": r["label"],
            "values": vals,
            "outcomes": {},
        }
        candidates_list.append(cand_dict)
        eval_batch.append({"id": r["id"], "values": vals})

    # Evaluate outcomes using active model if available
    model = models_repo.get_active_model_version(conn, study_id)
    if model and model.project:
        results = bridge.evaluate(
            project=model.project,
            param_bindings=[pb.model_dump() for pb in model.parameter_bindings],
            outcome_bindings=[ob.model_dump() for ob in model.outcome_bindings],
            rows=eval_batch,
        )
        for res in results:
            match = next((c for c in candidates_list if c["id"] == res.id), None)
            if match:
                match["outcomes"] = res.outcomes
    else:
        # Check if outcomes are stored in decisions or evidence
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="no_active_model",
            message="Pareto analysis requires an active model version to simulate candidate outcomes.",
        )

    res = compute_pareto_analysis(
        candidates=candidates_list,
        x_outcome_key=x_outcome,
        y_outcome_key=y_outcome,
        study_id=study_id,
        x_direction=x_direction,
        y_direction=y_direction,
    )

    return ParetoResponse(
        study_id=res.study_id,
        x_outcome=res.x_outcome,
        y_outcome=res.y_outcome,
        x_direction=res.x_direction,
        y_direction=res.y_direction,
        total_candidates=res.total_candidates,
        frontier_count=res.frontier_count,
        ideal_point=res.ideal_point,
        nadir_point=res.nadir_point,
        frontier=[
            ParetoPointModel(
                candidate_id=p.candidate_id,
                label=p.label,
                values=p.values,
                outcomes=p.outcomes,
                rank=p.rank,
            )
            for p in res.frontier
        ],
        all_points=[
            ParetoPointModel(
                candidate_id=p.candidate_id,
                label=p.label,
                values=p.values,
                outcomes=p.outcomes,
                rank=p.rank,
            )
            for p in res.all_points
        ],
    )

