"""Screening pipeline implementation (§4.5)."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

import numpy as np

from lattice_server.expr.evaluate import CompiledExpression, compile_expression
from lattice_server.ids import compute_values_hash, new_id
from lattice_server.repo import candidates as candidates_repo
from lattice_server.repo import constraints as constraints_repo
from lattice_server.repo import models as models_repo
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import overrides as overrides_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import screening as screening_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    ConstraintResponse,
    ModelVersionResponse,
    OutcomeCriterion,
    OutcomeResponse,
    OverrideResponse,
    ParameterResponse,
    ScreeningFunnel,
    ScreeningRunResponse,
    ScreeningSummary,
)
from lattice_server.stats.montecarlo import run_monte_carlo_screening


def compute_evidence_fingerprint(conn: sqlite3.Connection, study_id: str) -> str:
    """Compute evidence fingerprint (SHA-256 of count, max created_at, ids) for valid evidence."""
    row = conn.execute(
        """
        SELECT COUNT(*) AS cnt, MAX(created_at) AS max_created, GROUP_CONCAT(id) AS id_list
        FROM evidence
        WHERE study_id = ? AND status = 'valid' AND retracted_at IS NULL
        """,
        (study_id,),
    ).fetchone()
    if not row or row["cnt"] == 0:
        return "none"
    payload = f"{row['cnt']}:{row['max_created'] or ''}:{row['id_list'] or ''}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def outcome_satisfies_criterion(criterion: OutcomeCriterion, val: float) -> bool:
    """Evaluate whether numerical outcome value satisfies outcome criterion."""
    op = criterion.op
    if op == "<":
        return criterion.value is not None and val < criterion.value
    if op == "<=":
        return criterion.value is not None and val <= criterion.value
    if op == ">":
        return criterion.value is not None and val > criterion.value
    if op == ">=":
        return criterion.value is not None and val >= criterion.value
    if op == "between":
        return (
            criterion.low is not None
            and criterion.high is not None
            and criterion.low <= val <= criterion.high
        )
    if op == "equals":
        return criterion.value is not None and bool(np.isclose(val, criterion.value, rtol=1e-7, atol=1e-9))
    return True


def evaluate_evidence_record_success(
    outcomes_dict: dict[str, Any],
    outcome_defs: list[OutcomeResponse],
) -> bool:
    """Check if an evidence record's outcomes meet all defined outcome criteria."""
    for o in outcome_defs:
        if o.criterion is None:
            continue
        out_entry = outcomes_dict.get(o.key)
        if out_entry is None:
            return False
        if isinstance(out_entry, dict):
            val = out_entry.get("value")
        elif isinstance(out_entry, (int, float)):
            val = float(out_entry)
        else:
            return False
        if val is None or not np.isfinite(val):
            return False
        if not outcome_satisfies_criterion(o.criterion, float(val)):
            return False
    return True


def matches_candidate(
    cand_id: str,
    cand_hash: str,
    cand_values: dict[str, Any],
    evi: dict[str, Any],
    controlled_params: list[ParameterResponse],
) -> bool:
    """Check whether an evidence record matches a candidate."""
    if evi["candidate_id"] and evi["candidate_id"] == cand_id:
        return True
    if evi["values_hash"] == cand_hash:
        return True

    evi_values = evi["values"]
    for p in controlled_params:
        if p.key not in cand_values or p.key not in evi_values:
            return False
        c_val = cand_values[p.key]
        e_val = evi_values[p.key]

        if p.kind == "continuous":
            atol = 1e-9
            p_min = p.spec.get("min") if isinstance(p.spec, dict) else getattr(p.spec, "min", None)
            p_max = p.spec.get("max") if isinstance(p.spec, dict) else getattr(p.spec, "max", None)
            if p_min is not None and p_max is not None:
                atol = max(atol, 0.005 * abs(float(p_max) - float(p_min)))
            if not np.isclose(float(c_val), float(e_val), rtol=1e-6, atol=atol):
                return False
        elif p.kind == "integer":
            if int(c_val) != int(e_val):
                return False
        else:
            if str(c_val) != str(e_val):
                return False
    return True


@dataclass
class FilterVerdict:
    status: Literal["open", "excluded", "deprioritised", "recommended", "tested_pass", "tested_fail"]
    filter: str
    p_hat: float | None = None
    p_upper: float | None = None
    reason: str = ""
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class CandidateBatch:
    ids: list[str]
    indices: list[int]
    values_hashes: list[str]
    values_by_key: dict[str, np.ndarray]
    raw_values: list[dict[str, Any]]


@dataclass
class ScreeningContext:
    study_id: str
    active_overrides: dict[str, OverrideResponse]
    controlled_params: list[ParameterResponse]
    outcomes: list[OutcomeResponse]
    evidence_records: list[dict[str, Any]]
    evidence_by_cand_id: dict[str, list[dict[str, Any]]]
    evidence_by_hash: dict[str, list[dict[str, Any]]]
    hard_constraints: list[tuple[ConstraintResponse, CompiledExpression]]
    soft_constraints: list[tuple[ConstraintResponse, CompiledExpression]]
    active_model: ModelVersionResponse | None = None
    uncertain_params: list[ParameterResponse] = field(default_factory=list)
    rng_seed: int = 42
    exclusion_threshold: float = 0.05
    confidence: float = 0.95
    mc_draws: int = 60
    adaptive: bool = True
    enable_dominance: bool = False
    enable_redundancy: bool = False


FilterFn = Callable[[ScreeningContext, CandidateBatch, list[FilterVerdict | None]], None]


def override_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 1: Override exists (not revoked) -> status from override, filter = 'override'."""
    for i, v_hash in enumerate(batch.values_hashes):
        if verdicts[i] is not None:
            continue
        if v_hash in ctx.active_overrides:
            ovr = ctx.active_overrides[v_hash]
            verdicts[i] = FilterVerdict(
                status=ovr.status,
                filter="override",
                reason=ovr.reason,
            )


def evidence_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 2: Tested: valid evidence exists whose controlled values match candidate.

    (continuous: relative tolerance 1e-6 or 0.5% span; integer/categorical: exact)
    -> tested_pass if majority of replicates succeed, else tested_fail.
    filter = 'evidence_match'
    """
    if not ctx.evidence_records:
        return

    has_continuous = any(p.kind == "continuous" for p in ctx.controlled_params)

    for i in range(len(batch.ids)):
        if verdicts[i] is not None:
            continue

        c_id = batch.ids[i]
        c_hash = batch.values_hashes[i]
        c_vals = batch.raw_values[i]

        matching: list[dict[str, Any]] = []

        # 1. Check candidate_id index
        if c_id in ctx.evidence_by_cand_id:
            matching.extend(ctx.evidence_by_cand_id[c_id])

        # 2. Check values_hash index
        if c_hash in ctx.evidence_by_hash:
            for r in ctx.evidence_by_hash[c_hash]:
                if r not in matching:
                    matching.append(r)

        # 3. Check continuous tolerance match across all evidence records to aggregate all replicates
        if has_continuous:
            for r in ctx.evidence_records:
                if r not in matching and matches_candidate(c_id, c_hash, c_vals, r, ctx.controlled_params):
                    matching.append(r)

        if not matching:
            continue

        valid_recs = [r for r in matching if r["status"] == "valid"]
        failed_runs = [r for r in matching if r["status"] == "failed_run"]
        outliers = [r for r in matching if r["status"] == "outlier"]

        if not valid_recs:
            # Only failed runs or outliers: do not decide pass/fail
            continue

        passes = sum(1 for r in valid_recs if r["is_success"])
        n_valid = len(valid_recs)
        majority_pass = passes > (n_valid / 2)

        status_str: Literal["tested_pass", "tested_fail"] = (
            "tested_pass" if majority_pass else "tested_fail"
        )
        reason_str = (
            f"Tested: {passes}/{n_valid} replicates passed outcome criteria"
            if majority_pass
            else f"Tested: {n_valid - passes}/{n_valid} replicates failed outcome criteria"
        )

        outcome_means: dict[str, float] = {}
        outcome_stds: dict[str, float] = {}
        for o in ctx.outcomes:
            vals = []
            for r in valid_recs:
                out_entry = r["outcomes"].get(o.key)
                v = out_entry.get("value") if isinstance(out_entry, dict) else out_entry
                if isinstance(v, (int, float)) and np.isfinite(float(v)):
                    vals.append(float(v))
            if vals:
                outcome_means[o.key] = round(float(np.mean(vals)), 4)
                outcome_stds[o.key] = round(float(np.std(vals, ddof=1)) if len(vals) > 1 else 0.0, 4)

        details: dict[str, Any] = {
            "replicates": n_valid,
            "passes": passes,
            "fails": n_valid - passes,
            "failed_runs": len(failed_runs),
            "outliers": len(outliers),
            "evidence_ids": [r["id"] for r in valid_recs],
        }
        if outcome_means:
            details["outcome_means"] = outcome_means
            details["outcome_stds"] = outcome_stds
        if failed_runs:
            details["failed_run_ids"] = [r["id"] for r in failed_runs]

        verdicts[i] = FilterVerdict(
            status=status_str,
            filter="evidence_match",
            p_hat=round(passes / n_valid, 4),
            reason=reason_str,
            details=details,
        )


def constraint_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Steps 3 & 4: Evaluate hard and soft constraints vectorized.

    Step 3: Hard constraint violated -> excluded, filter = 'constraint'.
    Step 4: Constraint error (expression non-finite) -> open with flag 'constraint_error'.
    Soft constraints do not exclude; penalty stored in details.soft_penalty.
    """
    n = len(batch.ids)
    if n == 0:
        return

    hard_errors: list[list[str]] = [[] for _ in range(n)]
    hard_violations: list[list[str]] = [[] for _ in range(n)]
    soft_penalties: list[float] = [0.0 for _ in range(n)]

    # Evaluate hard constraints
    for constraint, compiled_expr in ctx.hard_constraints:
        values, finite_mask = compiled_expr.evaluate_vec(batch.values_by_key, n=n)
        for i in range(n):
            if not finite_mask[i]:
                hard_errors[i].append(constraint.expression)
            elif values[i] <= 0:
                reason = constraint.rationale if constraint.rationale else constraint.expression
                hard_violations[i].append(f"{constraint.expression} ({reason})")

    # Evaluate soft constraints using their actual penalty weight
    for _constraint, compiled_expr in ctx.soft_constraints:
        weight = float(_constraint.penalty) if _constraint.penalty is not None else 1.0
        values, finite_mask = compiled_expr.evaluate_vec(batch.values_by_key, n=n)
        for i in range(n):
            if not finite_mask[i] or values[i] <= 0:
                soft_penalties[i] += weight

    for i in range(n):
        if verdicts[i] is not None:
            continue

        # Step 4 check: Constraint error (expression non-finite for this candidate)
        # Takes precedence over exclusion so scientists are alerted and candidates are not silently lost.
        if hard_errors[i]:
            details: dict[str, Any] = {
                "flags": ["constraint_error"],
                "error_expressions": hard_errors[i],
            }
            if soft_penalties[i] > 0:
                details["soft_penalty"] = soft_penalties[i]
            verdicts[i] = FilterVerdict(
                status="open",
                filter="constraint_error",
                reason=f"Constraint calculation error in: {', '.join(hard_errors[i])}",
                details=details,
            )
        elif hard_violations[i]:
            # Step 3: Hard constraint violated
            details = {}
            if soft_penalties[i] > 0:
                details["soft_penalty"] = soft_penalties[i]
            verdicts[i] = FilterVerdict(
                status="excluded",
                filter="constraint",
                reason=f"Violates hard constraint: {'; '.join(hard_violations[i])}",
                details=details,
            )
        elif soft_penalties[i] > 0:
            # Passed hard constraints but incurred soft penalty
            pass


def dominance_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 6: Pareto dominance deprioritisation among open candidates when enabled."""
    if not ctx.enable_dominance:
        return
    directed_outcomes = [o for o in ctx.outcomes if o.direction in ("minimize", "maximize")]
    if not directed_outcomes:
        return

    open_indices = [
        i
        for i, v in enumerate(verdicts)
        if v is not None and v.status == "open" and "outcome_means" in v.details
    ]
    if len(open_indices) < 2:
        return

    for i in open_indices:
        vi = verdicts[i]
        assert vi is not None
        means_i = vi.details["outcome_means"]
        for j in open_indices:
            if i == j:
                continue
            vj = verdicts[j]
            assert vj is not None
            means_j = vj.details["outcome_means"]
            # Check if j dominates i on all directed outcomes
            all_better_or_eq = True
            strictly_better = False
            for o in directed_outcomes:
                mi = means_i.get(o.key)
                mj = means_j.get(o.key)
                if mi is None or mj is None:
                    all_better_or_eq = False
                    break
                if o.direction == "minimize":
                    if mj > mi:
                        all_better_or_eq = False
                        break
                    if mj < mi:
                        strictly_better = True
                else:
                    if mj < mi:
                        all_better_or_eq = False
                        break
                    if mj > mi:
                        strictly_better = True
            if all_better_or_eq and strictly_better:
                vi.status = "deprioritised"
                vi.filter = "dominance"
                vi.reason = f"Pareto-dominated on all directed outcomes by candidate #{batch.indices[j] + 1}"
                vi.details["dominated_by"] = batch.ids[j]
                break


def fallback_open_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 8: Any remaining candidates are marked open, and soft penalties attached."""
    n = len(batch.ids)
    soft_penalties: list[float] = [0.0 for _ in range(n)]
    for _constraint, compiled_expr in ctx.soft_constraints:
        weight = float(_constraint.penalty) if _constraint.penalty is not None else 1.0
        values, finite_mask = compiled_expr.evaluate_vec(batch.values_by_key, n=n)
        for i in range(n):
            if not finite_mask[i] or values[i] <= 0:
                soft_penalties[i] += weight

    for i in range(n):
        if verdicts[i] is None:
            details: dict[str, Any] = {}
            if soft_penalties[i] > 0:
                details["soft_penalty"] = soft_penalties[i]
            verdicts[i] = FilterVerdict(
                status="open",
                filter="none",
                reason="Passed all active constraints",
                details=details,
            )
        elif soft_penalties[i] > 0 and "soft_penalty" not in verdicts[i].details:
            verdicts[i].details["soft_penalty"] = soft_penalties[i]


def model_simulation_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 5: Active Flow Model simulation screening (§4.5 step 5)."""
    if not ctx.active_model:
        return

    unresolved_cands = []
    unresolved_indices = []
    for i in range(len(batch.ids)):
        if verdicts[i] is None:
            unresolved_cands.append(
                {
                    "id": batch.ids[i],
                    "idx": batch.indices[i],
                    "values": batch.raw_values[i],
                }
            )
            unresolved_indices.append(i)

    if not unresolved_cands:
        return

    sim_results = run_monte_carlo_screening(
        model=ctx.active_model,
        candidates=unresolved_cands,
        uncertain_params=ctx.uncertain_params,
        outcomes=ctx.outcomes,
        rng_seed=ctx.rng_seed,
        exclusion_threshold=ctx.exclusion_threshold,
        confidence=ctx.confidence,
        mc_draws=ctx.mc_draws,
        adaptive=ctx.adaptive,
    )

    for i in unresolved_indices:
        cand_id = batch.ids[i]
        res = sim_results.get(cand_id)
        if res:
            verdicts[i] = FilterVerdict(
                status=res.status,
                filter="model",
                p_hat=res.p_hat,
                p_upper=res.p_upper,
                reason=res.reason,
                details=res.details,
            )


def evidence_gp_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 5b: Evidence GP surrogate screening when no Flow Model is active and >= 8 valid evidence rows exist."""
    if ctx.active_model is not None:
        return

    valid_evi = [r for r in ctx.evidence_records if r["status"] == "valid"]
    if len(valid_evi) < 8:
        return

    outcomes_with_crit = [o for o in ctx.outcomes if o.criterion is not None]
    if not outcomes_with_crit:
        return

    unresolved_indices = [i for i in range(len(batch.ids)) if verdicts[i] is None]
    if not unresolved_indices:
        return

    from lattice_server.stats.surrogate import GPSurrogate, criterion_success_probability

    cand_rows = [batch.raw_values[i] for i in unresolved_indices]
    m_cands = len(cand_rows)
    delta = 1.0 - ctx.confidence
    tau = ctx.exclusion_threshold

    joint_p_hat = np.ones(m_cands, dtype=np.float64)
    joint_p_upper = np.ones(m_cands, dtype=np.float64)
    all_gp_validated = True
    gp_details: dict[str, Any] = {}

    for o in outcomes_with_crit:
        x_rows: list[dict[str, Any]] = []
        y_vals: list[float] = []
        for r in valid_evi:
            out_entry = r["outcomes"].get(o.key)
            val = out_entry.get("value") if isinstance(out_entry, dict) else out_entry
            if isinstance(val, (int, float)) and np.isfinite(float(val)):
                x_rows.append(r["values"])
                y_vals.append(float(val))
        if len(x_rows) < 8:
            return

        gp = GPSurrogate(parameters=ctx.controlled_params, outcome_key=o.key, seed=ctx.rng_seed)
        metrics = gp.fit(x_rows, np.asarray(y_vals, dtype=np.float64))
        if not metrics.is_validated:
            all_gp_validated = False

        mean, std = gp.predict(cand_rows)
        assert o.criterion is not None
        p_h, p_u, _p_l = criterion_success_probability(mean, std, o.criterion, delta=delta)
        joint_p_hat = np.minimum(joint_p_hat, p_h)
        joint_p_upper = np.minimum(joint_p_upper, p_u)
        gp_details[o.key] = {
            "n_samples": metrics.n_samples,
            "cv_rmse": metrics.cv_rmse,
            "cv_coverage_90": metrics.cv_coverage_90,
            "conformal_multiplier": metrics.conformal_multiplier,
            "is_validated": metrics.is_validated,
        }

    for k_idx, i in enumerate(unresolved_indices):
        ph = float(joint_p_hat[k_idx])
        pu = float(joint_p_upper[k_idx])
        if all_gp_validated and pu < tau:
            status_str: Literal["excluded", "deprioritised", "open"] = "excluded"
            reason = (
                f"Excluded at {int(ctx.confidence * 100)}% confidence under conformal-validated Evidence GP: "
                f"p_upper ({pu:.3f}) < threshold ({tau})."
            )
        elif ph < tau:
            status_str = "deprioritised"
            reason = f"Deprioritised under Evidence GP: p_hat ({ph:.3f}) < threshold ({tau})."
        else:
            status_str = "open"
            reason = f"Viable under Evidence GP: p_hat = {ph:.1%} (p_upper = {pu:.3f})."

        verdicts[i] = FilterVerdict(
            status=status_str,
            filter="evidence_gp",
            p_hat=round(ph, 4),
            p_upper=round(pu, 4),
            reason=reason,
            details={"gp_outcomes": gp_details, "p_hat": round(ph, 4), "p_upper": round(pu, 4)},
        )


# Ordered list of screening filters matching §4.5
PIPELINE_FILTERS: list[FilterFn] = [
    override_filter,          # Step 1: Override
    evidence_filter,          # Step 2: Tested evidence match
    constraint_filter,        # Steps 3 & 4: Hard/soft constraints + errors
    model_simulation_filter,  # Step 5a: Active Flow Model simulation
    evidence_gp_filter,       # Step 5b: Evidence GP surrogate (when >= 8 valid rows & no flow model)
    dominance_filter,         # Step 6: Pareto dominance deprioritisation
    fallback_open_filter,     # Step 8: Open fallback
]


def run_screening_pipeline(
    conn: sqlite3.Connection,
    study_id: str,
    candidate_set_id: str | None = None,
    settings: dict[str, Any] | None = None,
    job_id: str | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
    is_cancelled_callback: Callable[[], bool] | None = None,
    batch_size: int = 50_000,
    actor: str = "local-user",
) -> ScreeningRunResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ValueError(f"Study '{study_id}' not found")

    cset = (
        candidates_repo.get_candidate_set(conn, candidate_set_id)
        if candidate_set_id
        else candidates_repo.get_active_candidate_set(conn, study_id)
    )
    if not cset:
        raise ValueError("No active candidate set found for study")

    settings = settings or {}

    # Compile constraints
    params = parameters_repo.list_parameters(conn, study_id)
    controlled_params = [p for p in params if p.role == "controlled"]
    controlled_keys = {p.key for p in controlled_params}
    param_keys = {p.key for p in params}

    all_constraints = constraints_repo.list_constraints(conn, study_id)
    enabled_constraints = [c for c in all_constraints if c.enabled]

    hard_compiled: list[tuple[ConstraintResponse, CompiledExpression]] = []
    soft_compiled: list[tuple[ConstraintResponse, CompiledExpression]] = []

    for c in enabled_constraints:
        compiled = compile_expression(c.expression, variables=param_keys, strict=False)
        if c.kind == "hard":
            hard_compiled.append((c, compiled))
        else:
            soft_compiled.append((c, compiled))

    # Load active overrides
    overrides_map = overrides_repo.get_active_overrides_map(conn, study_id)

    # Load study outcomes and non-retracted evidence for tested_* matching
    study_outcomes = outcomes_repo.list_outcomes(conn, study_id)

    evidence_rows = conn.execute(
        """
        SELECT id, candidate_id, values_json, outcomes_json, status, replicate
        FROM evidence
        WHERE study_id = ? AND retracted_at IS NULL
        """,
        (study_id,),
    ).fetchall()

    evidence_records: list[dict[str, Any]] = []
    evidence_by_cand_id: dict[str, list[dict[str, Any]]] = {}
    evidence_by_hash: dict[str, list[dict[str, Any]]] = {}

    for er in evidence_rows:
        val_dict = json.loads(er["values_json"]) if er["values_json"] else {}
        out_dict = json.loads(er["outcomes_json"]) if er["outcomes_json"] else {}
        val_hash = compute_values_hash(val_dict, controlled_keys)
        is_succ = evaluate_evidence_record_success(out_dict, study_outcomes)

        rec = {
            "id": er["id"],
            "candidate_id": er["candidate_id"],
            "values": val_dict,
            "values_hash": val_hash,
            "outcomes": out_dict,
            "status": er["status"],
            "replicate": er["replicate"],
            "is_success": is_succ,
        }
        evidence_records.append(rec)

        if er["candidate_id"]:
            evidence_by_cand_id.setdefault(er["candidate_id"], []).append(rec)
        evidence_by_hash.setdefault(val_hash, []).append(rec)

    fingerprint = compute_evidence_fingerprint(conn, study_id)
    active_model = models_repo.get_latest_model_version(conn, study_id)
    if (
        active_model
        and active_model.validation_status == "validated"
        and active_model.validation_json
        and active_model.validation_json.get("evidence_fingerprint")
        and active_model.validation_json.get("evidence_fingerprint") != fingerprint
    ):
        active_model = active_model.model_copy(update={"validation_status": "unvalidated"})

    uncertain_params = [p for p in params if p.role == "uncertain"]
    has_valid_model = bool(
        active_model
        and active_model.project
        and active_model.parameter_bindings
        and active_model.outcome_bindings
        and settings.get("simulate_model", True)
    )

    ctx = ScreeningContext(
        study_id=study_id,
        active_overrides=overrides_map,
        controlled_params=controlled_params,
        outcomes=study_outcomes,
        evidence_records=evidence_records,
        evidence_by_cand_id=evidence_by_cand_id,
        evidence_by_hash=evidence_by_hash,
        hard_constraints=hard_compiled,
        soft_constraints=soft_compiled,
        active_model=active_model if has_valid_model else None,
        uncertain_params=uncertain_params,
        rng_seed=study.rng_seed,
        exclusion_threshold=study.exclusion_threshold,
        confidence=study.confidence,
        mc_draws=int(settings.get("mc_draws", 60)),
        adaptive=bool(settings.get("adaptive", True)),
        enable_dominance=bool(settings.get("enable_dominance", False)),
    )

    total_candidates = cset.count
    decision_rows: list[tuple[str, str, str, str, float | None, float | None, str, str]] = []

    run_id = new_id("run")
    now = datetime.now(UTC).isoformat()

    # Stream candidates in chunks of batch_size
    cursor = conn.execute(
        "SELECT id, idx, values_json, values_hash FROM candidates WHERE candidate_set_id = ? ORDER BY idx ASC",
        (cset.id,),
    )

    processed_count = 0

    while True:
        if is_cancelled_callback and is_cancelled_callback():
            raise RuntimeError("Screening run was cancelled by user")

        rows = cursor.fetchmany(batch_size)
        if not rows:
            break

        batch_ids = [r["id"] for r in rows]
        batch_indices = [r["idx"] for r in rows]
        batch_hashes = [r["values_hash"] for r in rows]
        batch_values = [json.loads(r["values_json"]) for r in rows]

        # Vectorize numeric columns
        values_by_key: dict[str, np.ndarray] = {}
        for p in params:
            col_vals = []
            for v_dict in batch_values:
                val = v_dict.get(p.key, 0.0)
                if isinstance(val, (int, float)):
                    col_vals.append(float(val))
                else:
                    col_vals.append(np.nan)
            values_by_key[p.key] = np.array(col_vals, dtype=np.float64)

        batch = CandidateBatch(
            ids=batch_ids,
            indices=batch_indices,
            values_hashes=batch_hashes,
            values_by_key=values_by_key,
            raw_values=batch_values,
        )

        verdicts: list[FilterVerdict | None] = [None] * len(batch_ids)

        # Apply filters in order
        for filter_fn in PIPELINE_FILTERS:
            filter_fn(ctx, batch, verdicts)

        for i, verdict in enumerate(verdicts):
            assert verdict is not None
            details_str = json.dumps(verdict.details, separators=(",", ":"), sort_keys=True)
            decision_rows.append(
                (
                    run_id,
                    batch_ids[i],
                    verdict.status,
                    verdict.filter,
                    verdict.p_hat,
                    verdict.p_upper,
                    verdict.reason,
                    details_str,
                )
            )

        processed_count += len(rows)
        if progress_callback and total_candidates > 0:
            frac = min(0.99, processed_count / total_candidates)
            progress_callback(frac, f"Evaluated {processed_count}/{total_candidates} candidates")

    # Compute summary counts
    status_counts = Counter(d[2] for d in decision_rows)
    filter_counts = Counter(d[3] for d in decision_rows)

    excluded_by_constraints = filter_counts.get("constraint", 0)
    after_constraints = max(0, total_candidates - excluded_by_constraints)
    stat_excl_count = sum(
        1 for d in decision_rows if d[2] == "excluded" and d[3] in ("model", "evidence", "evidence_gp", "hybrid")
    )
    excluded_statistical = status_counts.get("tested_fail", 0) + stat_excl_count
    after_statistical = max(0, after_constraints - excluded_statistical)
    deprioritised = status_counts.get("deprioritised", 0)
    after_deprioritised = max(0, after_statistical - deprioritised)
    recommended = status_counts.get("recommended", 0)

    funnel = ScreeningFunnel(
        total=total_candidates,
        after_constraints=after_constraints,
        after_statistical=after_statistical,
        after_deprioritised=after_deprioritised,
        recommended=recommended,
    )

    delta = 1.0 - study.confidence
    expected_false_exclusions_bound = (
        round(delta * after_constraints, 4) if stat_excl_count > 0 else 0.0
    )

    summary = ScreeningSummary(
        total_candidates=total_candidates,
        funnel=funnel,
        counts_by_status=dict(status_counts),
        counts_by_filter=dict(filter_counts),
        expected_false_exclusions_bound=expected_false_exclusions_bound,
    )

    # Persist in DB
    result = screening_repo.save_screening_run(
        conn=conn,
        run_id=run_id,
        study_id=study_id,
        candidate_set_id=cset.id,
        model_version_id=ctx.active_model.id if ctx.active_model else None,
        evidence_fingerprint=fingerprint,
        settings=settings,
        summary=summary,
        job_id=job_id,
        created_at=now,
        decision_rows=decision_rows,
        actor=actor,
    )

    if progress_callback:
        progress_callback(1.0, f"Completed screening for {total_candidates} candidates")

    return result
