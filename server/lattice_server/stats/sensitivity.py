"""Global sensitivity analysis module using Sobol variance decomposition (§4.4, §13)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.stats import sobol_indices, uniform

from lattice_server.engine import bridge
from lattice_server.schemas import (
    ModelVersionResponse,
    OutcomeResponse,
    ParameterResponse,
)

logger = logging.getLogger(__name__)


@dataclass
class ParameterSensitivity:
    param_id: str
    name: str
    key: str
    first_order: float
    total_order: float
    ci_95: list[float]  # [low, high]


@dataclass
class FreezingRecommendation:
    param_id: str
    key: str
    name: str
    reason: str
    suggested_value: float
    unit: str | None


@dataclass
class SensitivityResult:
    outcome_id: str
    outcome_key: str
    n_samples: int
    n_evaluations: int
    parameters: list[ParameterSensitivity]
    freezing_recommendations: list[FreezingRecommendation]


def compute_sobol_sensitivity(
    model: ModelVersionResponse,
    parameters: list[ParameterResponse],
    outcome: OutcomeResponse,
    n_samples: int = 64,
    seed: int = 42,
    freezing_threshold: float = 0.05,
) -> SensitivityResult:
    """Calculate Sobol first-order and total-order sensitivity indices for controlled parameters.

    Args:
        model: Verified ModelVersion with parameter and outcome bindings.
        parameters: List of controlled parameters with min/max bounds.
        outcome: Target outcome to analyze variance contribution for.
        n_samples: Base sample size N for Saltelli design (total runs = N*(2k+2)).
        seed: Random seed for reproducibility.
        freezing_threshold: Total index threshold below which parameter freezing is recommended.
    """
    controlled_params = [
        p for p in parameters if p.role == "controlled" and p.kind in ("continuous", "discrete")
    ]
    if not controlled_params:
        raise ValueError("Sensitivity analysis requires at least one continuous or discrete controlled parameter.")

    k = len(controlled_params)
    param_keys = [p.key for p in controlled_params]

    # Build uniform distributions per parameter over their [min, max] ranges
    dists = []
    param_ranges: list[tuple[float, float]] = []
    for p in controlled_params:
        spec = p.spec if isinstance(p.spec, dict) else (p.spec.model_dump() if hasattr(p.spec, "model_dump") else {})
        p_min = float(spec.get("min", 0.0))
        p_max = float(spec.get("max", 1.0))
        scale = max(1e-9, p_max - p_min)
        dists.append(uniform(loc=p_min, scale=scale))
        param_ranges.append((p_min, p_max))

    # Collect baseline defaults for all parameters (including non-controlled/uncertain)
    all_defaults: dict[str, float] = {}
    for p in parameters:
        spec = p.spec if isinstance(p.spec, dict) else (p.spec.model_dump() if hasattr(p.spec, "model_dump") else {})
        if "value" in spec and spec["value"] is not None:
            all_defaults[p.key] = float(spec["value"])
        elif "min" in spec and "max" in spec:
            all_defaults[p.key] = (float(spec["min"]) + float(spec["max"])) / 2.0
        else:
            all_defaults[p.key] = 1.0

    # Evaluation function for scipy.stats.sobol_indices
    # func receives x of shape (k, n_evals)
    def model_evaluator(x: np.ndarray) -> np.ndarray:
        n_evals = x.shape[1]
        batch_rows: list[dict[str, Any]] = []
        for j in range(n_evals):
            row_vals = dict(all_defaults)
            for i in range(k):
                row_vals[param_keys[i]] = float(x[i, j])
            batch_rows.append({"id": f"s_{j}", "values": row_vals})

        # Evaluate through TS engine bridge
        results = bridge.evaluate(
            project=model.project,
            param_bindings=[pb.model_dump() for pb in model.parameter_bindings],
            outcome_bindings=[ob.model_dump() for ob in model.outcome_bindings],
            rows=batch_rows,
        )

        outcomes_map = {r.id: r.outcomes.get(outcome.key, np.nan) for r in results}
        y = np.array([float(outcomes_map.get(f"s_{j}", np.nan)) for j in range(n_evals)], dtype=float)

        # Handle any non-finite outcomes safely
        if not np.all(np.isfinite(y)):
            valid_mean = float(np.nanmean(y)) if np.any(np.isfinite(y)) else 0.0
            y = np.nan_to_num(y, nan=valid_mean, posinf=valid_mean, neginf=valid_mean)
        return y

    # Run Sobol decomposition
    res = sobol_indices(
        func=model_evaluator,
        n=n_samples,
        dists=dists,
        random_state=seed,
    )

    # Compute bootstrap confidence intervals
    try:
        boot = res.bootstrap(n_resamples=100)
        ci_low = boot.total_order.confidence_interval.low
        ci_high = boot.total_order.confidence_interval.high
    except Exception as e:
        logger.warning("Bootstrap confidence interval calculation failed: %s", e)
        ci_low = np.maximum(0.0, res.total_order - 0.05)
        ci_high = np.minimum(1.0, res.total_order + 0.05)

    param_sensitivities: list[ParameterSensitivity] = []
    freezing_recommendations: list[FreezingRecommendation] = []

    for i, p in enumerate(controlled_params):
        s1 = float(np.clip(res.first_order[i], 0.0, 1.0))
        st = float(np.clip(res.total_order[i], 0.0, 1.0))
        c_low = float(np.clip(ci_low[i], 0.0, 1.0))
        c_high = float(np.clip(ci_high[i], 0.0, 1.0))

        p_name = getattr(p, "label", getattr(p, "name", p.key))
        param_sensitivities.append(
            ParameterSensitivity(
                param_id=p.id,
                name=p_name,
                key=p.key,
                first_order=round(s1, 4),
                total_order=round(st, 4),
                ci_95=[round(c_low, 4), round(c_high, 4)],
            )
        )

        # Smart Freezing: if total variance contribution is below threshold
        if st < freezing_threshold:
            p_min, p_max = param_ranges[i]
            midpoint = round((p_min + p_max) / 2.0, 3)
            percent = round(st * 100.0, 1)
            out_name = getattr(outcome, "label", getattr(outcome, "name", outcome.key))
            reason = (
                f"Total variance contribution is {percent}% (< {int(freezing_threshold * 100)}% threshold). "
                f"Parameter has negligible impact on {out_name}. Freezing reduces fabrication cost and search complexity."
            )
            freezing_recommendations.append(
                FreezingRecommendation(
                    param_id=p.id,
                    key=p.key,
                    name=p_name,
                    reason=reason,
                    suggested_value=midpoint,
                    unit=p.unit,
                )
            )

    # Sort parameters by total-order sensitivity descending
    param_sensitivities.sort(key=lambda s: s.total_order, reverse=True)

    total_evals = n_samples * (2 * k + 2)
    return SensitivityResult(
        outcome_id=outcome.id,
        outcome_key=outcome.key,
        n_samples=n_samples,
        n_evaluations=total_evals,
        parameters=param_sensitivities,
        freezing_recommendations=freezing_recommendations,
    )
