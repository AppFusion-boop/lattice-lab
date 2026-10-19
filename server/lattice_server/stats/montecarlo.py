"""Monte Carlo simulation filter for model-based screening (§4.4, §4.5 step 5)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.stats import triang, truncnorm

from lattice_server.engine import bridge
from lattice_server.schemas import (
    ModelVersionResponse,
    OutcomeResponse,
    ParameterResponse,
)
from lattice_server.stats.bounds import (
    clopper_pearson_lower,
    clopper_pearson_upper,
)


@dataclass
class CandidateSimulationResult:
    candidate_id: str
    p_hat: float
    p_upper: float
    p_lower: float
    n_draws: int
    k_successes: int
    status: str  # "excluded" | "deprioritised" | "open"
    reason: str
    details: dict[str, Any]


def min_draws_for_exclusion(tau: float, delta: float) -> int:
    """Minimum MC draws n so that k=0 successes yields Clopper-Pearson p_upper < tau."""
    if tau <= 0.0 or tau >= 1.0 or delta <= 0.0 or delta >= 1.0:
        return 60
    return int(np.floor(np.log(delta) / np.log(1.0 - tau))) + 1


def sample_uncertain_parameter(
    param: ParameterResponse,
    rng: np.random.Generator,
    size: int,
) -> np.ndarray:
    """Sample values for an uncertain parameter from its defined distribution, truncated to [min, max]."""
    spec = (
        param.spec
        if isinstance(param.spec, dict)
        else (param.spec.model_dump() if hasattr(param.spec, "model_dump") else {})
    )
    dist = spec.get("distribution") if isinstance(spec, dict) else getattr(spec, "distribution", None)
    if hasattr(dist, "model_dump"):
        dist = dist.model_dump()
    if not isinstance(dist, dict):
        dist = {}

    dist_type = dist.get("type", "uniform")
    if param.kind == "categorical":
        options = spec.get("options") or dist.get("values") or ["default"]
        weights = spec.get("weights") or dist.get("weights")
        if weights is not None and len(weights) == len(options):
            p = np.asarray(weights, dtype=np.float64)
            p = p / np.sum(p)
        else:
            p = None
        return rng.choice(options, size=size, p=p)

    if dist_type == "discrete":
        values = dist.get("values") or spec.get("values") or [0.0]
        weights = dist.get("weights") or spec.get("weights")
        if weights is not None and len(weights) == len(values):
            p = np.asarray(weights, dtype=np.float64)
            p = p / np.sum(p)
        else:
            p = None
        sampled = rng.choice(values, size=size, p=p)
        return sampled.astype(np.int64 if param.kind == "integer" else np.float64)

    min_v = float(spec.get("min", 0.0) if spec.get("min") is not None else 0.0)
    max_v = float(spec.get("max", 1.0) if spec.get("max") is not None else 1.0)
    span = max(1e-12, max_v - min_v)

    if dist_type == "normal":
        mean = float(dist.get("mean") if dist.get("mean") is not None else 0.5 * (min_v + max_v))
        sd = max(1e-9, float(dist.get("sd") if dist.get("sd") is not None else span / 4.0))
        a = (min_v - mean) / sd
        b = (max_v - mean) / sd
        draws = truncnorm.rvs(a, b, loc=mean, scale=sd, size=size, random_state=rng)
    elif dist_type == "lognormal":
        default_med = float(np.sqrt(max(1e-9, min_v) * max(1e-6, max_v)))
        median = max(1e-9, float(dist.get("median") if dist.get("median") is not None else default_med))
        gsd = max(1.0001, float(dist.get("gsd") if dist.get("gsd") is not None else 1.5))
        mu_ln = float(np.log(median))
        sd_ln = float(np.log(gsd))
        low_ln = float(np.log(max(1e-12, min_v)))
        high_ln = float(np.log(max(1e-9, max_v)))
        a = (low_ln - mu_ln) / sd_ln
        b = (high_ln - mu_ln) / sd_ln
        draws = np.exp(truncnorm.rvs(a, b, loc=mu_ln, scale=sd_ln, size=size, random_state=rng))
    elif dist_type == "triangular":
        mode = float(dist.get("mode") if dist.get("mode") is not None else 0.5 * (min_v + max_v))
        c = float(np.clip((mode - min_v) / span, 0.0, 1.0))
        draws = triang.rvs(c, loc=min_v, scale=span, size=size, random_state=rng)
    else:
        draws = rng.uniform(min_v, max_v, size=size)

    draws_arr = np.clip(np.asarray(draws, dtype=np.float64), min_v, max_v)
    if param.kind == "integer":
        return np.round(draws_arr).astype(np.int64)
    return draws_arr


def evaluate_outcome_success(
    val: float,
    outcome: OutcomeResponse,
) -> bool:
    """Check if numerical value satisfies outcome criterion."""
    crit = outcome.criterion
    if not crit or not np.isfinite(val):
        return False
    op = crit.op
    if op == "<":
        return crit.value is not None and val < crit.value
    if op == "<=":
        return crit.value is not None and val <= crit.value
    if op == ">":
        return crit.value is not None and val > crit.value
    if op == ">=":
        return crit.value is not None and val >= crit.value
    if op == "between":
        return (
            crit.low is not None
            and crit.high is not None
            and crit.low <= val <= crit.high
        )
    if op == "equals":
        return crit.value is not None and bool(np.isclose(val, crit.value, atol=1e-6))
    return True


def run_monte_carlo_screening(
    model: ModelVersionResponse,
    candidates: list[dict[str, Any]],  # list of {"id": str, "idx": int, "values": dict[str, Any]}
    uncertain_params: list[ParameterResponse],
    outcomes: list[OutcomeResponse],
    rng_seed: int,
    exclusion_threshold: float = 0.05,
    confidence: float = 0.95,
    mc_draws: int = 60,
    adaptive: bool = True,
    round_size: int = 20,
    progress_cb: Callable[[float, str], None] | None = None,
    cancelled_cb: Callable[[], bool] | None = None,
) -> dict[str, CandidateSimulationResult]:
    """Run adaptive two-stage Monte Carlo simulation screening across candidates using the active flow model."""
    if not candidates:
        return {}

    delta = 1.0 - confidence
    tau = exclusion_threshold
    is_validated = model.validation_status == "validated"
    outcomes_with_crit = [o for o in outcomes if o.criterion is not None]
    deterministic_mode = len(uncertain_params) == 0

    total_max_draws = 1 if deterministic_mode else max(1, int(mc_draws))
    step_draws = 1 if deterministic_mode else (max(1, int(round_size)) if adaptive else total_max_draws)

    n_draws_map: dict[str, int] = {c["id"]: 0 for c in candidates}
    k_succ_map: dict[str, int] = {c["id"]: 0 for c in candidates}
    active_cands: list[dict[str, Any]] = list(candidates)

    drawn_so_far = 0
    round_idx = 0

    while drawn_so_far < total_max_draws and active_cands:
        cur_step = min(step_draws, total_max_draws - drawn_so_far)
        batch_rows: list[dict[str, Any]] = []
        cand_round_row_ids: dict[str, list[str]] = {}

        for cand in active_cands:
            cand_id = cand["id"]
            cand_idx = cand.get("idx", 0)
            cand_values = cand["values"]
            cand_round_row_ids[cand_id] = []

            # Deterministic seed per candidate and round (§10 Rule 12)
            cand_rng = np.random.default_rng([rng_seed, cand_idx, round_idx])

            sampled_uncertain: dict[str, np.ndarray] = {}
            for up in uncertain_params:
                sampled_uncertain[up.key] = sample_uncertain_parameter(up, cand_rng, cur_step)

            for d in range(cur_step):
                draw_num = drawn_so_far + d
                row_id = f"{cand_id}__d{draw_num}"
                cand_round_row_ids[cand_id].append(row_id)
                row_vals = dict(cand_values)
                for up in uncertain_params:
                    val = sampled_uncertain[up.key][d]
                    row_vals[up.key] = val.item() if hasattr(val, "item") else val
                batch_rows.append({"id": row_id, "values": row_vals})

        if progress_cb:
            progress_cb(
                0.1 + 0.8 * (drawn_so_far / max(1, total_max_draws)),
                f"Evaluating round {round_idx + 1}: {len(batch_rows)} 3D simulation draws across {len(active_cands)} candidates...",
            )

        raw_results = bridge.evaluate(
            project=model.project,
            param_bindings=[pb.model_dump() for pb in model.parameter_bindings],
            outcome_bindings=[ob.model_dump() for ob in model.outcome_bindings],
            rows=batch_rows,
            cancelled=cancelled_cb,
        )
        results_by_id = {r.id: r for r in raw_results}

        next_active_cands: list[dict[str, Any]] = []
        for cand in active_cands:
            cand_id = cand["id"]
            for r_id in cand_round_row_ids[cand_id]:
                res = results_by_id.get(r_id)
                if not res or res.status != "ok":
                    continue
                n_draws_map[cand_id] += 1
                row_succ = True
                for o in outcomes_with_crit:
                    val = res.outcomes.get(o.key)
                    if val is None or not evaluate_outcome_success(float(val), o):
                        row_succ = False
                        break
                if row_succ:
                    k_succ_map[cand_id] += 1

            n_cur = n_draws_map[cand_id]
            k_cur = k_succ_map[cand_id]
            if deterministic_mode or not adaptive or n_cur == 0:
                next_active_cands.append(cand)
                continue

            p_up = clopper_pearson_upper(k_cur, n_cur, delta=delta)
            p_lo = clopper_pearson_lower(k_cur, n_cur, delta=delta)
            # Early stop if candidate is decisively below tau or decisively >= tau
            if p_up < tau or p_lo >= tau:
                continue
            next_active_cands.append(cand)

        active_cands = next_active_cands
        drawn_so_far += cur_step
        round_idx += 1

    sim_decisions: dict[str, CandidateSimulationResult] = {}
    for cand in candidates:
        cand_id = cand["id"]
        cand_idx = cand.get("idx", 0)
        n_draws = n_draws_map[cand_id]
        k_successes = k_succ_map[cand_id]

        p_hat = k_successes / max(1, n_draws)
        if deterministic_mode and n_draws > 0:
            p_upper = p_hat
            p_lower = p_hat
        else:
            p_upper = clopper_pearson_upper(k_successes, n_draws, delta=delta)
            p_lower = clopper_pearson_lower(k_successes, n_draws, delta=delta)

        details = {
            "model_version_id": model.id,
            "engine_version": model.engine_version,
            "signature": model.signature,
            "validation_status": model.validation_status,
            "n_draws": n_draws,
            "k_successes": k_successes,
            "p_hat": round(p_hat, 4),
            "p_upper": round(p_upper, 4),
            "p_lower": round(p_lower, 4),
            "exclusion_threshold": tau,
            "confidence": confidence,
            "seed": [rng_seed, cand_idx],
            "adaptive": adaptive,
        }

        # Apply Hard Rule 6 & §4.4 exclusion rule (never set status="recommended" here)
        if is_validated and p_upper < tau:
            status = "excluded"
            reason = (
                f"Excluded at {int(confidence*100)}% confidence under model v{model.version}: "
                f"p_upper ({p_upper:.3f}) < threshold ({tau}) with {k_successes}/{n_draws} successes."
            )
        elif not is_validated and p_hat < tau:
            status = "deprioritised"
            reason = (
                f"Deprioritised under unvalidated model v{model.version} (Hard Rule 6): "
                f"p_hat ({p_hat:.3f}) < threshold ({tau}) with {k_successes}/{n_draws} successes."
            )
        elif is_validated and p_hat < tau:
            status = "deprioritised"
            reason = (
                f"Deprioritised under model v{model.version}: p_hat ({p_hat:.3f}) < threshold ({tau}), "
                f"but {n_draws} draws insufficient for {int(confidence*100)}% confidence exclusion (p_upper={p_upper:.3f} >= {tau})."
            )
        else:
            status = "open"
            reason = (
                f"Viable under model v{model.version}: p_hat = {p_hat:.1%} "
                f"[95% CI: {p_lower:.3f}, {p_upper:.3f}] ({k_successes}/{n_draws} successes)."
            )

        sim_decisions[cand_id] = CandidateSimulationResult(
            candidate_id=cand_id,
            p_hat=p_hat,
            p_upper=p_upper,
            p_lower=p_lower,
            n_draws=n_draws,
            k_successes=k_successes,
            status=status,
            reason=reason,
            details=details,
        )

    return sim_decisions
