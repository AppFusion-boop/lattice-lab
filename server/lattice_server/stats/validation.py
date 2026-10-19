"""Model empirical validation against physical evidence & human acceptance (T3-2, §4.6, P3-8)."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

import numpy as np

from lattice_server import ids
from lattice_server.audit import write_audit
from lattice_server.engine import bridge
from lattice_server.errors import ApiHttpError
from lattice_server.repo import models as models_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import ModelVersionResponse
from lattice_server.screening.pipeline import compute_evidence_fingerprint
from lattice_server.stats.montecarlo import sample_uncertain_parameter


def _extract_numeric_outcome(outcomes_dict: dict[str, Any], key: str) -> float | None:
    raw = outcomes_dict.get(key)
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        val = float(raw)
        return val if np.isfinite(val) else None
    if isinstance(raw, dict) and isinstance(raw.get("value"), (int, float)):
        val = float(raw["value"])
        return val if np.isfinite(val) else None
    return None


def validate_flow_model(
    conn: sqlite3.Connection,
    study_id: str,
    model_id: str,
    n_draws: int = 60,
    actor: str = "local-user",
) -> dict[str, Any]:
    """Compare Flow Model predictions against valid physical evidence rows (§4.6).

    Computes 90% prediction intervals per evidence point, empirical coverage, RMSE, MAE,
    parity plot points, and eligibility for human validation acceptance (Hard Rule 6).
    """
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(404, "not_found", f"Study '{study_id}' not found")

    mv = models_repo.get_model_version(conn, model_id)
    if not mv or mv.study_id != study_id:
        raise ApiHttpError(404, "not_found", f"Model version '{model_id}' not found in study '{study_id}'")

    if not mv.project or not mv.outcome_bindings:
        raise ApiHttpError(422, "invalid_model", "Model version has no flow project or outcome bindings")

    params = parameters_repo.list_parameters(conn, study_id)
    controlled_params = [p for p in params if p.role == "controlled"]
    uncertain_params = [p for p in params if p.role == "uncertain"]
    fixed_params = [p for p in params if p.role == "fixed"]

    min_required_rows = 5 if len(controlled_params) <= 2 else 8
    fingerprint = compute_evidence_fingerprint(conn, study_id)

    ev_rows = conn.execute(
        """
        SELECT id, values_json, outcomes_json
        FROM evidence
        WHERE study_id = ? AND status = 'valid' AND retracted_at IS NULL
        ORDER BY created_at ASC
        """,
        (study_id,),
    ).fetchall()

    bound_outcome_keys = [ob.outcome_key for ob in mv.outcome_bindings]
    valid_ev: list[dict[str, Any]] = []
    for r in ev_rows:
        v_dict = json.loads(r["values_json"]) if r["values_json"] else {}
        o_dict = json.loads(r["outcomes_json"]) if r["outcomes_json"] else {}
        meas_map: dict[str, float] = {}
        for ok in bound_outcome_keys:
            m_val = _extract_numeric_outcome(o_dict, ok)
            if m_val is not None:
                meas_map[ok] = m_val
        if meas_map:
            valid_ev.append({"id": r["id"], "values": v_dict, "measured": meas_map})

    draws_per_row = 1 if len(uncertain_params) == 0 else max(10, int(n_draws))
    batch_rows: list[dict[str, Any]] = []
    ev_draw_ids: dict[str, list[str]] = {}

    fixed_defaults: dict[str, Any] = {}
    for fp in fixed_params:
        s = fp.spec if isinstance(fp.spec, dict) else {}
        if s.get("value") is not None:
            fixed_defaults[fp.key] = s["value"]

    for idx, ev in enumerate(valid_ev):
        ev_id = ev["id"]
        ev_draw_ids[ev_id] = []
        row_rng = np.random.default_rng([study.rng_seed, idx])
        sampled_unc: dict[str, np.ndarray] = {
            up.key: sample_uncertain_parameter(up, row_rng, draws_per_row)
            for up in uncertain_params
        }
        for d in range(draws_per_row):
            r_id = f"{ev_id}__v{d}"
            ev_draw_ids[ev_id].append(r_id)
            vals = dict(fixed_defaults)
            vals.update(ev["values"])
            for up in uncertain_params:
                v = sampled_unc[up.key][d]
                vals[up.key] = v.item() if hasattr(v, "item") else v
            batch_rows.append({"id": r_id, "values": vals})

    raw_results = (
        bridge.evaluate(
            project=mv.project,
            param_bindings=[pb.model_dump() for pb in mv.parameter_bindings],
            outcome_bindings=[ob.model_dump() for ob in mv.outcome_bindings],
            rows=batch_rows,
        )
        if batch_rows
        else []
    )
    res_by_id = {r.id: r for r in raw_results}

    parity_points: list[dict[str, Any]] = []
    sq_errors_by_outcome: dict[str, list[float]] = {ok: [] for ok in bound_outcome_keys}
    abs_errors_by_outcome: dict[str, list[float]] = {ok: [] for ok in bound_outcome_keys}
    total_checks = 0
    covered_checks = 0

    for ev in valid_ev:
        ev_id = ev["id"]
        r_ids = ev_draw_ids[ev_id]
        for ok, y_meas in ev["measured"].items():
            sim_vals: list[float] = []
            for r_id in r_ids:
                rr = res_by_id.get(r_id)
                if rr and rr.status == "ok" and ok in rr.outcomes:
                    sv = float(rr.outcomes[ok])
                    if np.isfinite(sv):
                        sim_vals.append(sv)
            if not sim_vals:
                continue

            arr = np.asarray(sim_vals, dtype=np.float64)
            pred_mean = float(np.mean(arr))
            q05 = float(np.percentile(arr, 5))
            q95 = float(np.percentile(arr, 95))

            # Minimum 5% instrument/discretization tolerance band when uncertain spread is zero
            min_half_band = max(1e-6, 0.05 * max(abs(pred_mean), abs(y_meas)))
            if (q95 - q05) < 2.0 * min_half_band:
                center = 0.5 * (q05 + q95)
                pi_low_90 = center - min_half_band
                pi_high_90 = center + min_half_band
            else:
                pi_low_90 = q05
                pi_high_90 = q95

            covered = bool(pi_low_90 <= y_meas <= pi_high_90)
            total_checks += 1
            if covered:
                covered_checks += 1

            err = pred_mean - y_meas
            sq_errors_by_outcome[ok].append(err * err)
            abs_errors_by_outcome[ok].append(abs(err))

            parity_points.append(
                {
                    "evidence_id": ev_id,
                    "outcome_key": ok,
                    "measured": round(y_meas, 6),
                    "pred_mean": round(pred_mean, 6),
                    "pi_low_90": round(pi_low_90, 6),
                    "pi_high_90": round(pi_high_90, 6),
                    "covered": covered,
                }
            )

    n_evidence_rows = len(valid_ev)
    empirical_coverage_90 = round(covered_checks / total_checks, 4) if total_checks > 0 else 0.0

    rmse_by_outcome = {
        ok: round(float(np.sqrt(np.mean(errs))), 6) if errs else 0.0
        for ok, errs in sq_errors_by_outcome.items()
    }
    mae_by_outcome = {
        ok: round(float(np.mean(errs)), 6) if errs else 0.0
        for ok, errs in abs_errors_by_outcome.items()
    }

    eligible_for_acceptance = bool(
        n_evidence_rows >= min_required_rows and empirical_coverage_90 >= 0.80
    )

    now = datetime.now(UTC).isoformat()
    validation_report: dict[str, Any] = {
        "model_id": model_id,
        "study_id": study_id,
        "evaluated_at": now,
        "evidence_fingerprint": fingerprint,
        "n_evidence_rows": n_evidence_rows,
        "min_required_rows": min_required_rows,
        "empirical_coverage_90": empirical_coverage_90,
        "target_coverage_90": 0.80,
        "rmse_by_outcome": rmse_by_outcome,
        "mae_by_outcome": mae_by_outcome,
        "parity_points": parity_points,
        "eligible_for_acceptance": eligible_for_acceptance,
        "accepted_by": None,
        "accepted_at": None,
        "acceptance_reason": None,
    }

    # If enough rows were tested and coverage failed (< 0.80), mark status='failed';
    # otherwise keep 'unvalidated' until explicit human acceptance (Hard Rule 6).
    new_status = (
        "failed"
        if (n_evidence_rows >= min_required_rows and empirical_coverage_90 < 0.80)
        else "unvalidated"
    )

    conn.execute(
        """
        UPDATE model_versions
        SET validation_status = ?, validation_json = ?
        WHERE id = ?
        """,
        (new_status, json.dumps(validation_report), model_id),
    )

    analysis_id = ids.new_id("ana")
    conn.execute(
        """
        INSERT INTO analyses (id, study_id, kind, model_version_id, input_json, result_json, job_id, created_at)
        VALUES (?, ?, 'validation', ?, ?, ?, NULL, ?)
        """,
        (
            analysis_id,
            study_id,
            model_id,
            json.dumps({"n_draws": draws_per_row}),
            json.dumps(validation_report),
            now,
        ),
    )

    write_audit(
        conn,
        action="validate_model",
        entity="model_version",
        entity_id=model_id,
        study_id=study_id,
        actor=actor,
        details={
            "n_evidence_rows": n_evidence_rows,
            "empirical_coverage_90": empirical_coverage_90,
            "eligible_for_acceptance": eligible_for_acceptance,
            "new_status": new_status,
        },
    )

    validation_report["validation_status"] = new_status
    return validation_report


def accept_model_validation(
    conn: sqlite3.Connection,
    model_id: str,
    reason: str,
    actor: str = "local-user",
) -> ModelVersionResponse:
    """Human action to accept empirical validation of a model version (Hard Rule 6)."""
    mv = models_repo.get_model_version(conn, model_id)
    if not mv:
        raise ApiHttpError(404, "not_found", f"Model version '{model_id}' not found")

    if not reason or len(reason.strip()) < 3:
        raise ApiHttpError(422, "invalid_reason", "Acceptance reason must be at least 3 characters", field="reason")

    val_data = dict(mv.validation_json) if mv.validation_json else {}
    if not val_data.get("eligible_for_acceptance"):
        raise ApiHttpError(
            422,
            "validation_not_eligible",
            (
                "Model version has not passed empirical coverage validation "
                f"(coverage={val_data.get('empirical_coverage_90', 0.0):.1%}, "
                f"rows={val_data.get('n_evidence_rows', 0)}/{val_data.get('min_required_rows', 5)}). "
                "Run validation against physical evidence first."
            ),
        )

    current_fp = compute_evidence_fingerprint(conn, mv.study_id)
    if val_data.get("evidence_fingerprint") != current_fp:
        raise ApiHttpError(
            409,
            "stale_evidence_fingerprint",
            "New evidence has been recorded since validation ran. Re-run validation before accepting.",
        )

    now = datetime.now(UTC).isoformat()
    val_data["accepted_by"] = actor
    val_data["accepted_at"] = now
    val_data["acceptance_reason"] = reason.strip()

    conn.execute(
        """
        UPDATE model_versions
        SET validation_status = 'validated', validation_json = ?
        WHERE id = ?
        """,
        (json.dumps(val_data), model_id),
    )

    write_audit(
        conn,
        action="accept_validation",
        entity="model_version",
        entity_id=model_id,
        study_id=mv.study_id,
        actor=actor,
        details={
            "reason": reason.strip(),
            "evidence_fingerprint": current_fp,
            "empirical_coverage_90": val_data.get("empirical_coverage_90"),
        },
    )

    updated = models_repo.get_model_version(conn, model_id)
    assert updated is not None
    return updated
