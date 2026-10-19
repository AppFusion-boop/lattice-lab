"""Active Learning Batch Selection: EI×PF, Straddle, Kriging Believer & VoI Cards (P5-2, T3-5)."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

import numpy as np
from scipy.stats import norm

from lattice_server.audit import write_audit
from lattice_server.errors import ApiHttpError
from lattice_server.expr.evaluate import compile_expression
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.screening.pipeline import run_screening_pipeline
from lattice_server.stats.doe import select_d_optimal_batch, select_maximin_batch
from lattice_server.stats.surrogate import (
    FeatureEncoder,
    GPSurrogate,
    criterion_success_probability,
)


def _compute_expected_improvement(
    mean: np.ndarray,
    std: np.ndarray,
    best_y: float,
    direction: str,
) -> np.ndarray:
    safe_std = np.maximum(1e-9, std)
    if direction == "minimize":
        imp = best_y - mean
    else:
        imp = mean - best_y
    z = imp / safe_std
    ei = imp * norm.cdf(z) + safe_std * norm.pdf(z)
    return np.maximum(0.0, ei)


def select_next_batch(
    conn: sqlite3.Connection,
    study_id: str,
    batch_size: int = 5,
    strategy: str = "balanced",
    actor: str = "local-user",
) -> dict[str, Any]:
    """Select the highest-priority batch of B open candidates and mark them 'recommended'."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(404, "not_found", f"Study '{study_id}' not found")

    batch_size = max(1, min(100, int(batch_size)))

    run_row = conn.execute(
        """
        SELECT id, summary_json
        FROM screening_runs
        WHERE study_id = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (study_id,),
    ).fetchone()

    if not run_row:
        run_obj = run_screening_pipeline(conn=conn, study_id=study_id, actor=actor)
        run_id = run_obj.id
        summary_dict = run_obj.summary.model_dump()
    else:
        run_id = run_row["id"]
        summary_dict = json.loads(run_row["summary_json"]) if run_row["summary_json"] else {}

    # Reset any previous acquisition-recommended rows in this run back to 'open'
    conn.execute(
        """
        UPDATE decisions
        SET status = 'open', filter = 'none', reason = 'Passed all active constraints'
        WHERE screening_run_id = ? AND status = 'recommended' AND filter = 'acquisition'
        """,
        (run_id,),
    )

    open_rows = conn.execute(
        """
        SELECT c.id, c.idx, c.label, c.values_json, d.p_hat, d.p_upper, d.details_json
        FROM decisions d
        JOIN candidates c ON c.id = d.candidate_id
        WHERE d.screening_run_id = ? AND d.status IN ('open', 'deprioritised')
        ORDER BY CASE WHEN d.status = 'open' THEN 0 ELSE 1 END, c.idx ASC
        """,
        (run_id,),
    ).fetchall()

    if not open_rows:
        return {
            "study_id": study_id,
            "screening_run_id": run_id,
            "strategy": strategy,
            "batch_size": 0,
            "items": [],
        }

    params = parameters_repo.list_parameters(conn, study_id)
    controlled_params = [p for p in params if p.role == "controlled"]
    outcomes = outcomes_repo.list_outcomes(conn, study_id)

    cand_ids = [r["id"] for r in open_rows]
    cand_labels = [r["label"] or f"C-{r['idx'] + 1}" for r in open_rows]
    cand_values = [json.loads(r["values_json"]) for r in open_rows]
    cand_details = [json.loads(r["details_json"] or "{}") for r in open_rows]
    n_open = len(cand_ids)

    # Evaluate cost expression if defined
    costs = np.ones(n_open, dtype=np.float64)
    if study.cost_expression:
        try:
            comp_cost = compile_expression(
                study.cost_expression,
                variables={p.key for p in params},
                strict=False,
            )
            vals_by_key: dict[str, np.ndarray] = {}
            for p in params:
                vals_by_key[p.key] = np.array(
                    [
                        float(v.get(p.key, 0.0)) if isinstance(v.get(p.key), (int, float)) else 0.0
                        for v in cand_values
                    ],
                    dtype=np.float64,
                )
            c_vec, c_fin = comp_cost.evaluate_vec(vals_by_key, n=n_open)
            costs = np.where(c_fin & (c_vec > 1e-6), c_vec, 1.0)
        except (ValueError, KeyError, RuntimeError):
            costs = np.ones(n_open, dtype=np.float64)

    # Soft constraint penalty attenuation exp(-soft_penalty)
    soft_mult = np.array(
        [np.exp(-float(det.get("soft_penalty", 0.0))) for det in cand_details],
        dtype=np.float64,
    )

    # Load valid evidence to fit GP if available
    ev_rows = conn.execute(
        """
        SELECT values_json, outcomes_json
        FROM evidence
        WHERE study_id = ? AND status = 'valid' AND retracted_at IS NULL
        """,
        (study_id,),
    ).fetchall()

    pf_vec = np.array(
        [float(r["p_hat"]) if r["p_hat"] is not None else 0.5 for r in open_rows],
        dtype=np.float64,
    )
    ei_vec = np.ones(n_open, dtype=np.float64)
    straddle_vec = np.zeros(n_open, dtype=np.float64)
    unc_vec = np.ones(n_open, dtype=np.float64)

    enc = FeatureEncoder(controlled_params)
    X_open = enc.transform(cand_values)

    if len(ev_rows) >= 3 and outcomes:
        for o in outcomes:
            tx: list[dict[str, Any]] = []
            ty: list[float] = []
            for er in ev_rows:
                vd = json.loads(er["values_json"]) if er["values_json"] else {}
                od = json.loads(er["outcomes_json"]) if er["outcomes_json"] else {}
                oe = od.get(o.key)
                v = oe.get("value") if isinstance(oe, dict) else oe
                if isinstance(v, (int, float)) and np.isfinite(float(v)):
                    tx.append(vd)
                    ty.append(float(v))
            if len(tx) >= 3:
                gp = GPSurrogate(parameters=controlled_params, outcome_key=o.key, seed=study.rng_seed)
                gp.fit(tx, np.asarray(ty, dtype=np.float64))
                mean, std = gp.predict(cand_values)
                std_norm = std / max(1e-9, float(np.std(ty)) if len(ty) > 1 else 1.0)
                unc_vec = np.maximum(unc_vec, std_norm)

                if o.criterion is not None:
                    ph, _pu, _pl = criterion_success_probability(
                        mean, std, o.criterion, delta=1.0 - study.confidence
                    )
                    pf_vec = np.minimum(pf_vec, ph)
                    if o.criterion.value is not None:
                        c_val = float(o.criterion.value)
                        strad = np.maximum(0.0, 1.96 * std - np.abs(mean - c_val))
                        straddle_vec = np.maximum(straddle_vec, strad / max(1e-9, float(np.max(std))))

                if o.direction in ("minimize", "maximize"):
                    best_y = float(np.min(ty)) if o.direction == "minimize" else float(np.max(ty))
                    ei_raw = _compute_expected_improvement(mean, std, best_y, o.direction)
                    max_ei = float(np.max(ei_raw))
                    if max_ei > 1e-12:
                        ei_vec = ei_raw / max_ei
    else:
        # Use Monte Carlo p_hat proximity to threshold 0.5 as boundary straddle proxy
        straddle_vec = 1.0 - 2.0 * np.abs(pf_vec - 0.5)
        ei_vec = pf_vec.copy()

    actual_b = min(batch_size, n_open)
    selected_indices: list[int] = []
    voi_reasons: dict[int, str] = {}
    scores_map: dict[int, float] = {}

    if strategy == "maximin":
        selected_indices = select_maximin_batch(cand_values, controlled_params, actual_b, seed=study.rng_seed)
        for idx in selected_indices:
            voi_reasons[idx] = "Space Explorer — maximizes minimum distance across feasible parameter space"
            scores_map[idx] = float(unc_vec[idx])
    elif strategy == "d_optimal":
        selected_indices = select_d_optimal_batch(cand_values, controlled_params, actual_b, seed=study.rng_seed)
        for idx in selected_indices:
            voi_reasons[idx] = "D-Optimal Anchor — maximizes parameter-space information matrix determinant"
            scores_map[idx] = 1.0
    else:
        exploit_score = (ei_vec * pf_vec * soft_mult) / costs
        boundary_score = (straddle_vec * soft_mult) / costs
        explore_score = (unc_vec * soft_mult) / costs

        # Normalize component scores to [0, 1]
        def _norm01(v: np.ndarray) -> np.ndarray:
            vmin, vmax = float(np.min(v)), float(np.max(v))
            if vmax - vmin < 1e-12:
                return np.ones_like(v)
            return (v - vmin) / (vmax - vmin)

        ex_n = _norm01(exploit_score)
        bd_n = _norm01(boundary_score)
        xp_n = _norm01(explore_score)

        if strategy == "exploit":
            base_score = ex_n
        elif strategy == "boundary":
            base_score = bd_n
        elif strategy == "explore":
            base_score = xp_n
        else:
            # "balanced": combine exploit, boundary, and exploration
            base_score = 0.45 * ex_n + 0.35 * bd_n + 0.20 * xp_n

        # Kriging-Believer / spatial repulsion loop for batch diversity
        min_dist_sq = np.full(n_open, np.inf, dtype=np.float64)
        for step in range(actual_b):
            diversity_factor = (
                np.ones(n_open, dtype=np.float64)
                if step == 0
                else np.clip(min_dist_sq / max(1e-9, float(np.max(min_dist_sq[np.isfinite(min_dist_sq)]))), 0.15, 1.0)
            )
            step_score = base_score * diversity_factor
            for s_idx in selected_indices:
                step_score[s_idx] = -1e18

            chosen = int(np.argmax(step_score))
            selected_indices.append(chosen)
            scores_map[chosen] = round(float(step_score[chosen]), 4)

            # Classify primary Value-of-Information card
            if strategy == "boundary" or (bd_n[chosen] >= ex_n[chosen] and bd_n[chosen] >= xp_n[chosen] and bd_n[chosen] > 0.4):
                voi_reasons[chosen] = "Boundary Resolver — resolves threshold cliff uncertainty"
            elif strategy == "exploit" or (ex_n[chosen] >= xp_n[chosen] and ex_n[chosen] > 0.3):
                voi_reasons[chosen] = "Top Performer — highest expected improvement × feasibility"
            else:
                voi_reasons[chosen] = "Space Explorer — covers high-uncertainty parameter region"

            d_new = np.sum((X_open - X_open[chosen : chosen + 1]) ** 2, axis=1)
            min_dist_sq = np.minimum(min_dist_sq, d_new)

    recommended_items: list[dict[str, Any]] = []
    for rank, idx in enumerate(selected_indices, start=1):
        c_id = cand_ids[idx]
        voi = voi_reasons.get(idx, "High expected value of information")
        sc = scores_map.get(idx, 1.0)
        det = dict(cand_details[idx])
        det["voi_reason"] = voi
        det["acquisition_score"] = sc
        det["strategy"] = strategy
        det["batch_rank"] = rank

        conn.execute(
            """
            UPDATE decisions
            SET status = 'recommended', filter = 'acquisition', reason = ?, details_json = ?
            WHERE screening_run_id = ? AND candidate_id = ?
            """,
            (voi, json.dumps(det, separators=(",", ":"), sort_keys=True), run_id, c_id),
        )
        recommended_items.append(
            {
                "candidate_id": c_id,
                "label": cand_labels[idx],
                "values": cand_values[idx],
                "rank": rank,
                "acquisition_score": sc,
                "p_hat": round(float(pf_vec[idx]), 4),
                "voi_reason": voi,
            }
        )

    # Update summary_json counts in screening_runs
    status_rows = conn.execute(
        "SELECT status, COUNT(*) AS cnt FROM decisions WHERE screening_run_id = ? GROUP BY status",
        (run_id,),
    ).fetchall()
    counts_by_status = {r["status"]: int(r["cnt"]) for r in status_rows}
    summary_dict["counts_by_status"] = counts_by_status
    if "funnel" in summary_dict and isinstance(summary_dict["funnel"], dict):
        summary_dict["funnel"]["recommended"] = counts_by_status.get("recommended", 0)

    conn.execute(
        "UPDATE screening_runs SET summary_json = ? WHERE id = ?",
        (json.dumps(summary_dict), run_id),
    )

    write_audit(
        conn,
        action="select_batch",
        entity="screening_run",
        entity_id=run_id,
        study_id=study_id,
        actor=actor,
        details={
            "strategy": strategy,
            "batch_size": len(recommended_items),
            "candidate_ids": [it["candidate_id"] for it in recommended_items],
        },
    )

    return {
        "study_id": study_id,
        "screening_run_id": run_id,
        "strategy": strategy,
        "batch_size": len(recommended_items),
        "items": recommended_items,
    }
