"""K-Fold False-Exclusion Back-Testing on Physical Evidence (§4.5, P4-6, T3-4)."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

import numpy as np
from sklearn.model_selection import KFold
from statsmodels.stats.proportion import proportion_confint

from lattice_server import ids
from lattice_server.errors import ApiHttpError
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.screening.pipeline import evaluate_evidence_record_success
from lattice_server.stats.surrogate import GPSurrogate, criterion_success_probability


def run_kfold_backtest(
    conn: sqlite3.Connection,
    study_id: str,
    k_folds: int = 5,
    actor: str = "local-user",
) -> dict[str, Any]:
    """Run K-fold out-of-sample false-exclusion backtest across valid physical evidence."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(404, "not_found", f"Study '{study_id}' not found")

    params = parameters_repo.list_parameters(conn, study_id)
    controlled_params = [p for p in params if p.role == "controlled"]
    outcomes = outcomes_repo.list_outcomes(conn, study_id)
    outcomes_with_crit = [o for o in outcomes if o.criterion is not None]
    if not outcomes_with_crit:
        raise ApiHttpError(422, "no_criteria", "At least one outcome with a criterion is required for back-testing.")

    ev_rows = conn.execute(
        """
        SELECT id, values_json, outcomes_json
        FROM evidence
        WHERE study_id = ? AND status = 'valid' AND retracted_at IS NULL
        ORDER BY created_at ASC
        """,
        (study_id,),
    ).fetchall()

    records: list[dict[str, Any]] = []
    for r in ev_rows:
        vals = json.loads(r["values_json"]) if r["values_json"] else {}
        outs = json.loads(r["outcomes_json"]) if r["outcomes_json"] else {}
        is_succ = evaluate_evidence_record_success(outs, outcomes)
        records.append({"id": r["id"], "values": vals, "outcomes": outs, "is_success": is_succ})

    n = len(records)
    if n < 5:
        raise ApiHttpError(
            422,
            "insufficient_evidence",
            f"Back-testing requires at least 5 valid evidence records (found {n}).",
        )

    n_splits = min(max(2, int(k_folds)), n)
    kf = KFold(n_splits=n_splits, shuffle=True, random_state=study.rng_seed)
    delta = 1.0 - study.confidence
    tau = study.exclusion_threshold

    total_true_successes = sum(1 for r in records if r["is_success"])
    total_true_failures = n - total_true_successes
    false_exclusions = 0
    correct_exclusions = 0
    fold_results: list[dict[str, Any]] = []

    indices = np.arange(n)
    for fold_idx, (train_idx, test_idx) in enumerate(kf.split(indices)):
        train_recs = [records[i] for i in train_idx]
        test_recs = [records[i] for i in test_idx]
        test_x = [r["values"] for r in test_recs]

        joint_p_upper = np.ones(len(test_recs), dtype=np.float64)
        for o in outcomes_with_crit:
            tx: list[dict[str, Any]] = []
            ty: list[float] = []
            for tr in train_recs:
                oe = tr["outcomes"].get(o.key)
                v = oe.get("value") if isinstance(oe, dict) else oe
                if isinstance(v, (int, float)) and np.isfinite(float(v)):
                    tx.append(tr["values"])
                    ty.append(float(v))
            if len(tx) < 3:
                continue
            gp = GPSurrogate(parameters=controlled_params, outcome_key=o.key, seed=study.rng_seed + fold_idx)
            gp.fit(tx, np.asarray(ty, dtype=np.float64))
            mean, std = gp.predict(test_x)
            assert o.criterion is not None
            _ph, pu, _pl = criterion_success_probability(mean, std, o.criterion, delta=delta)
            joint_p_upper = np.minimum(joint_p_upper, pu)

        fold_false_excl = 0
        fold_correct_excl = 0
        for j, tr in enumerate(test_recs):
            excluded_pred = bool(joint_p_upper[j] < tau)
            if excluded_pred:
                if tr["is_success"]:
                    false_exclusions += 1
                    fold_false_excl += 1
                else:
                    correct_exclusions += 1
                    fold_correct_excl += 1

        fold_results.append(
            {
                "fold": fold_idx + 1,
                "n_test": len(test_recs),
                "false_exclusions": fold_false_excl,
                "correct_exclusions": fold_correct_excl,
            }
        )

    denom_succ = max(1, total_true_successes)
    false_excl_rate = round(false_exclusions / denom_succ, 4) if total_true_successes > 0 else 0.0
    ci_low, ci_high = (
        proportion_confint(false_exclusions, denom_succ, alpha=0.05, method="wilson")
        if total_true_successes > 0
        else (0.0, 0.0)
    )
    true_excl_rate = (
        round(correct_exclusions / max(1, total_true_failures), 4)
        if total_true_failures > 0
        else 0.0
    )

    now = datetime.now(UTC).isoformat()
    report: dict[str, Any] = {
        "study_id": study_id,
        "k_folds": n_splits,
        "n_evidence": n,
        "total_true_successes": total_true_successes,
        "total_true_failures": total_true_failures,
        "false_exclusions": false_exclusions,
        "correct_exclusions": correct_exclusions,
        "false_exclusion_rate": false_excl_rate,
        "false_exclusion_ci_95": [round(float(ci_low), 4), round(float(ci_high), 4)],
        "true_exclusion_rate": true_excl_rate,
        "nominal_delta": round(delta, 4),
        "exclusion_threshold": tau,
        "within_nominal_bound": bool(false_excl_rate <= delta + 0.05),
        "folds": fold_results,
        "created_at": now,
    }

    ana_id = ids.new_id("ana")
    conn.execute(
        """
        INSERT INTO analyses (id, study_id, kind, model_version_id, input_json, result_json, job_id, created_at)
        VALUES (?, ?, 'backtest', NULL, ?, ?, NULL, ?)
        """,
        (ana_id, study_id, json.dumps({"k_folds": n_splits}), json.dumps(report), now),
    )

    return report

