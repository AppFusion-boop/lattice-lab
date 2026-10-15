"""Monte Carlo simulation filter for model-based screening (§4.4, §4.5 step 5)."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.stats import truncnorm

from lattice_server.engine import bridge
from lattice_server.repo import models as models_repo
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
    status: str  # "excluded" | "deprioritised" | "open" | "recommended"
    reason: str
    details: dict[str, Any]


def sample_uncertain_parameter(
    param: ParameterResponse,
    rng: np.random.Generator,
    size: int,
) -> np.ndarray:
    """Sample values for an uncertain parameter from its defined distribution."""
    spec = param.spec if isinstance(param.spec, dict) else (param.spec.model_dump() if hasattr(param.spec, "model_dump") else {})
    dist = spec.get("distribution") if isinstance(spec, dict) else getattr(spec, "distribution", None)
    dist = dist if isinstance(dist, dict) else (dist.model_dump() if hasattr(dist, "model_dump") else {})

    dist_type = dist.get("type", "uniform") if isinstance(dist, dict) else getattr(dist, "type", "uniform")

    if dist_type == "normal":
        mean = float(dist.get("mean", 0.0) if isinstance(dist, dict) else getattr(dist, "mean", 0.0))
        sd = float(dist.get("sd", 1.0) if isinstance(dist, dict) else getattr(dist, "sd", 1.0))
        min_v = float(spec.get("min", -np.inf) if isinstance(spec, dict) else getattr(spec, "min", -np.inf))
        max_v = float(spec.get("max", np.inf) if isinstance(spec, dict) else getattr(spec, "max", np.inf))

        if np.isneginf(min_v) and np.isposinf(max_v):
            return rng.normal(mean, sd, size=size)
        a = (min_v - mean) / max(1e-9, sd)
        b = (max_v - mean) / max(1e-9, sd)
        return truncnorm.rvs(a, b, loc=mean, scale=sd, size=size, random_state=rng)

    min_v = float(spec.get("min", 0.0) if isinstance(spec, dict) else getattr(spec, "min", 0.0))
    max_v = float(spec.get("max", 1.0) if isinstance(spec, dict) else getattr(spec, "max", 1.0))
    return rng.uniform(min_v, max_v, size=size)


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
    mc_draws: int = 10,
    progress_cb: Callable[[float, str], None] | None = None,
    cancelled_cb: Callable[[], bool] | None = None,
) -> dict[str, CandidateSimulationResult]:
    """Run Monte Carlo simulation screening across candidates using the active flow model."""
    if not candidates:
        return {}

    delta = 1.0 - confidence
    tau = exclusion_threshold
    is_validated = model.validation_status == "validated"

    # Pre-sample uncertain parameters per candidate
    batch_rows: list[dict[str, Any]] = []
    cand_draw_ids: dict[str, list[str]] = {}

    for cand in candidates:
        cand_id = cand["id"]
        cand_idx = cand.get("idx", 0)
        cand_values = cand["values"]
        cand_draw_ids[cand_id] = []

        # Deterministic seed per candidate (§10 Rule 12)
        cand_rng = np.random.default_rng([rng_seed, cand_idx])

        # Draw uncertain parameters
        sampled_uncertain: dict[str, np.ndarray] = {}
        for up in uncertain_params:
            sampled_uncertain[up.key] = sample_uncertain_parameter(up, cand_rng, mc_draws)

        for d in range(mc_draws):
            row_id = f"{cand_id}__d{d}"
            cand_draw_ids[cand_id].append(row_id)
            row_vals = dict(cand_values)
            for up in uncertain_params:
                row_vals[up.key] = float(sampled_uncertain[up.key][d])
            batch_rows.append({"id": row_id, "values": row_vals})

    if progress_cb:
        progress_cb(0.1, f"Evaluating {len(batch_rows)} 3D simulation draws...")

    # Run batch through engine bridge
    raw_results = bridge.evaluate(
        project=model.project,
        param_bindings=[pb.model_dump() for pb in model.parameter_bindings],
        outcome_bindings=[ob.model_dump() for ob in model.outcome_bindings],
        rows=batch_rows,
        cancelled=cancelled_cb,
    )

    results_by_id = {r.id: r for r in raw_results}
    sim_decisions: dict[str, CandidateSimulationResult] = {}

    outcomes_with_crit = [o for o in outcomes if o.criterion is not None]

    for cand in candidates:
        cand_id = cand["id"]
        row_ids = cand_draw_ids[cand_id]
        k_successes = 0
        n_draws = len(row_ids)

        for r_id in row_ids:
            res = results_by_id.get(r_id)
            if not res or res.status != "ok":
                continue

            # Check if all criteria are satisfied
            row_succ = True
            for o in outcomes_with_crit:
                val = res.outcomes.get(o.key)
                if val is None or not evaluate_outcome_success(float(val), o):
                    row_succ = False
                    break

            if row_succ:
                k_successes += 1

        p_hat = k_successes / max(1, n_draws)
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
        }

        # Apply Hard Rule 6 & §4.4 exclusion rule
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
        elif p_hat >= 0.70:
            status = "recommended"
            reason = (
                f"High predicted success rate under model v{model.version}: "
                f"p_hat = {p_hat:.1%} ({k_successes}/{n_draws} simulated successes)."
            )
        else:
            status = "open"
            reason = f"Simulated success rate p_hat = {p_hat:.1%} ({k_successes}/{n_draws} successes)."

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
