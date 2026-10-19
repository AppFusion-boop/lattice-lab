"""API router for statistical analyses, TOST equivalence, K-fold backtest, power, Buckingham Pi, intervals, and batch selection."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, status

from lattice_server import ids
from lattice_server.db import DbConn
from lattice_server.errors import ApiHttpError
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.stats.acquisition import select_next_batch
from lattice_server.stats.backtest import run_kfold_backtest
from lattice_server.stats.dimensional import compute_buckingham_pi
from lattice_server.stats.intervals import find_critical_threshold_theorems
from lattice_server.stats.power import calculate_required_replicates
from lattice_server.stats.tost import run_tost_equivalence

router = APIRouter(tags=["analyses"])


@router.get("/studies/{study_id}/analyses", response_model=list[dict[str, Any]])
def list_study_analyses(study_id: str, conn: DbConn, kind: str | None = None) -> list[dict[str, Any]]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(status.HTTP_404_NOT_FOUND, "not_found", f"Study '{study_id}' not found")

    if kind:
        rows = conn.execute(
            "SELECT * FROM analyses WHERE study_id = ? AND kind = ? ORDER BY created_at DESC",
            (study_id, kind),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM analyses WHERE study_id = ? ORDER BY created_at DESC",
            (study_id,),
        ).fetchall()

    return [
        {
            "id": r["id"],
            "study_id": r["study_id"],
            "kind": r["kind"],
            "model_version_id": r["model_version_id"],
            "input": json.loads(r["input_json"] or "{}"),
            "result": json.loads(r["result_json"] or "{}"),
            "job_id": r["job_id"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.post("/studies/{study_id}/analyses/tost", response_model=dict[str, Any])
def run_tost_endpoint(study_id: str, payload: dict[str, Any], conn: DbConn) -> dict[str, Any]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(status.HTTP_404_NOT_FOUND, "not_found", f"Study '{study_id}' not found")

    margin = float(payload.get("margin", 0.0))
    alpha = float(payload.get("alpha", 1.0 - study.confidence))
    outcome_key = str(payload.get("outcome_key", "outcome"))
    unit = str(payload.get("unit", ""))

    group_a = payload.get("group_a")
    group_b = payload.get("group_b")
    label_a = str(payload.get("label_a", "Group A"))
    label_b = str(payload.get("label_b", "Group B"))

    # If group_a / group_b are not passed directly, extract from evidence by parameter_key == value_a / value_b
    if group_a is None or group_b is None:
        param_key = payload.get("parameter_key")
        val_a = payload.get("value_a")
        val_b = payload.get("value_b")
        if not param_key or val_a is None or val_b is None:
            raise ApiHttpError(
                422,
                "invalid_tost_input",
                "Provide either ('group_a' and 'group_b') or ('parameter_key', 'value_a', 'value_b').",
            )
        ev_rows = conn.execute(
            "SELECT values_json, outcomes_json FROM evidence WHERE study_id = ? AND status = 'valid' AND retracted_at IS NULL",
            (study_id,),
        ).fetchall()
        group_a = []
        group_b = []
        for r in ev_rows:
            vd = json.loads(r["values_json"] or "{}")
            od = json.loads(r["outcomes_json"] or "{}")
            oe = od.get(outcome_key)
            ov = oe.get("value") if isinstance(oe, dict) else oe
            if not isinstance(ov, (int, float)):
                continue
            pv = vd.get(param_key)
            if str(pv) == str(val_a) or (isinstance(pv, (int, float)) and isinstance(val_a, (int, float)) and abs(float(pv) - float(val_a)) < 1e-6):
                group_a.append(float(ov))
            elif str(pv) == str(val_b) or (isinstance(pv, (int, float)) and isinstance(val_b, (int, float)) and abs(float(pv) - float(val_b)) < 1e-6):
                group_b.append(float(ov))
        label_a = f"{param_key}={val_a}"
        label_b = f"{param_key}={val_b}"

    try:
        res = run_tost_equivalence(
            [float(x) for x in group_a],
            [float(x) for x in group_b],
            margin=margin,
            alpha=alpha,
            label_a=label_a,
            label_b=label_b,
            outcome_key=outcome_key,
            unit=unit,
        )
    except ValueError as exc:
        raise ApiHttpError(422, "tost_error", str(exc)) from exc

    res_dict = res.to_dict()
    now = datetime.now(UTC).isoformat()
    ana_id = ids.new_id("ana")
    conn.execute(
        """
        INSERT INTO analyses (id, study_id, kind, model_version_id, input_json, result_json, job_id, created_at)
        VALUES (?, ?, 'tost', NULL, ?, ?, NULL, ?)
        """,
        (ana_id, study_id, json.dumps(payload), json.dumps(res_dict), now),
    )
    return res_dict


@router.post("/studies/{study_id}/analyses/backtest", response_model=dict[str, Any])
def run_backtest_endpoint(
    study_id: str,
    conn: DbConn,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    k_folds = int((payload or {}).get("k_folds", 5))
    return run_kfold_backtest(conn=conn, study_id=study_id, k_folds=k_folds)


@router.post("/studies/{study_id}/analyses/power", response_model=dict[str, Any])
def run_power_endpoint(study_id: str, payload: dict[str, Any], conn: DbConn) -> dict[str, Any]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(status.HTTP_404_NOT_FOUND, "not_found", f"Study '{study_id}' not found")

    try:
        res = calculate_required_replicates(
            min_effect=float(payload.get("min_effect", 0.0)),
            noise_sd=float(payload.get("noise_sd", 0.0)),
            alpha=float(payload.get("alpha", 1.0 - study.confidence)),
            power=float(payload.get("power", 0.80)),
        )
    except ValueError as exc:
        raise ApiHttpError(422, "invalid_power_params", str(exc)) from exc

    now = datetime.now(UTC).isoformat()
    ana_id = ids.new_id("ana")
    conn.execute(
        """
        INSERT INTO analyses (id, study_id, kind, model_version_id, input_json, result_json, job_id, created_at)
        VALUES (?, ?, 'power', NULL, ?, ?, NULL, ?)
        """,
        (ana_id, study_id, json.dumps(payload), json.dumps(res), now),
    )
    return res


@router.get("/studies/{study_id}/analyses/dimensional", response_model=dict[str, Any])
def get_dimensional_analysis_endpoint(study_id: str, conn: DbConn) -> dict[str, Any]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(status.HTTP_404_NOT_FOUND, "not_found", f"Study '{study_id}' not found")

    params = parameters_repo.list_parameters(conn, study_id)
    outcomes = outcomes_repo.list_outcomes(conn, study_id)
    res = compute_buckingham_pi(params, outcomes)
    return res.to_dict()


@router.post("/studies/{study_id}/analyses/intervals", response_model=dict[str, Any])
def run_interval_theorems_endpoint(study_id: str, payload: dict[str, Any], conn: DbConn) -> dict[str, Any]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(status.HTTP_404_NOT_FOUND, "not_found", f"Study '{study_id}' not found")

    expression = str(payload.get("expression", "")).strip()
    outcome_key = str(payload.get("outcome_key", "")).strip()
    if not expression or not outcome_key:
        raise ApiHttpError(422, "missing_fields", "Both 'expression' and 'outcome_key' are required.")

    params = parameters_repo.list_parameters(conn, study_id)
    outcomes = outcomes_repo.list_outcomes(conn, study_id)
    target_out = next((o for o in outcomes if o.key == outcome_key), None)
    if not target_out:
        raise ApiHttpError(404, "not_found", f"Outcome '{outcome_key}' not found in study")

    try:
        theorems = find_critical_threshold_theorems(
            expression=expression,
            parameters=params,
            outcome=target_out,
            n_slices=int(payload.get("n_slices", 50)),
        )
    except Exception as exc:
        raise ApiHttpError(422, "interval_error", str(exc)) from exc

    return {
        "study_id": study_id,
        "outcome_key": outcome_key,
        "expression": expression,
        "theorems": [
            {
                "parameter_key": t.parameter_key,
                "parameter_label": t.parameter_label,
                "parameter_unit": t.parameter_unit,
                "futile_low": t.futile_low,
                "futile_high": t.futile_high,
                "outcome_key": t.outcome_key,
                "outcome_bounds": list(t.outcome_bounds),
                "statement": t.statement,
            }
            for t in theorems
        ],
    }


@router.post("/studies/{study_id}/batches", response_model=dict[str, Any])
def create_batch_selection_endpoint(
    study_id: str,
    payload: dict[str, Any],
    conn: DbConn,
) -> dict[str, Any]:
    batch_size = int(payload.get("batch_size", 5))
    strategy = str(payload.get("strategy", "balanced"))
    return select_next_batch(conn=conn, study_id=study_id, batch_size=batch_size, strategy=strategy)

