"""Parameter Auto-Calibration engine (§4.4, §13).

Calibrates unvalidated or empirical physics model coefficients against
real-world physical lab bench evidence using bounded non-linear least squares.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import optimize

from lattice_server.engine import bridge
from lattice_server.schemas import ModelVersionResponse

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CalibrationResult:
    parameter_key: str
    prior_value: float
    calibrated_value: float
    ci_95: list[float]
    standard_error: float
    prior_rmse: float
    calibrated_rmse: float
    rmse_reduction_pct: float
    n_evidence_points: int


def run_parameter_calibration(
    model: ModelVersionResponse,
    parameter_key: str,
    param_bounds: tuple[float, float],
    initial_guess: float,
    evidence_points: list[dict[str, Any]],
    target_outcome: str,
    seed: int = 42,
) -> CalibrationResult:
    """Calibrate a single model parameter against physical evidence observations."""
    if not evidence_points:
        raise ValueError("At least 1 physical evidence point is required for calibration.")

    p_min, p_max = param_bounds
    if p_min >= p_max:
        raise ValueError(f"Invalid parameter bounds: [{p_min}, {p_max}]")

    theta_0 = float(np.clip(initial_guess, p_min, p_max))

    # Extract target measured values
    y_measured = []
    valid_points = []
    for pt in evidence_points:
        out_dict = pt.get("outcomes", {})
        if target_outcome in out_dict:
            raw = out_dict[target_outcome]
            val = raw if isinstance(raw, (int, float)) else raw.get("value", None)
            if val is not None:
                y_measured.append(float(val))
                valid_points.append(pt)

    if len(y_measured) == 0:
        raise ValueError(f"None of the provided evidence points contain outcome '{target_outcome}'.")

    y_meas_arr = np.array(y_measured, dtype=np.float64)
    m = len(y_meas_arr)

    # Evaluation helper: runs batch through model bridge at parameter value theta
    def evaluate_model_at_theta(theta: float) -> np.ndarray:
        eval_rows = []
        for idx, pt in enumerate(valid_points):
            row_vals = dict(pt.get("values", {}))
            row_vals[parameter_key] = float(theta)
            eval_rows.append(
                {
                    "id": f"calib_{idx}",
                    "idx": idx,
                    "values": row_vals,
                }
            )

        results = bridge.evaluate(
            project=model.project,
            param_bindings=[b.model_dump() for b in model.parameter_bindings],
            outcome_bindings=[b.model_dump() for b in model.outcome_bindings],
            rows=eval_rows,
            chunk_size=128,
        )

        sim_y = []
        for r in results:
            sim_y.append(float(r.outcomes.get(target_outcome, 0.0)))
        return np.array(sim_y, dtype=np.float64)

    # 1. Compute Prior RMSE
    y_prior = evaluate_model_at_theta(theta_0)
    prior_residuals = y_meas_arr - y_prior
    prior_rmse = float(np.sqrt(np.mean(prior_residuals**2)))

    # 2. Objective Function: Residual Sum of Squares (RSS)
    def loss_function(theta_val: float) -> float:
        y_sim = evaluate_model_at_theta(theta_val)
        res = y_meas_arr - y_sim
        return float(np.sum(res**2))

    # 3. Optimize using bounded scalar minimization
    opt_res = optimize.minimize_scalar(
        loss_function,
        bounds=(p_min, p_max),
        method="bounded",
        options={"xatol": 1e-4, "maxiter": 50},
    )

    theta_opt = float(opt_res.x)
    y_opt = evaluate_model_at_theta(theta_opt)
    calib_residuals = y_meas_arr - y_opt
    calib_rss = float(np.sum(calib_residuals**2))
    calib_rmse = float(np.sqrt(np.mean(calib_residuals**2)))

    # 4. Compute Standard Error and 95% Confidence Interval via finite differences
    eps = max(1e-4, (p_max - p_min) * 1e-3)
    y_plus = evaluate_model_at_theta(min(p_max, theta_opt + eps))
    y_minus = evaluate_model_at_theta(max(p_min, theta_opt - eps))
    actual_step = (min(p_max, theta_opt + eps) - max(p_min, theta_opt - eps))
    jacobian = (y_plus - y_minus) / (actual_step if actual_step > 0 else eps)

    # Approximate variance of residuals
    dof = max(1, m - 1)
    sigma2 = calib_rss / dof
    jt_j = float(np.dot(jacobian, jacobian))

    if jt_j > 1e-12:
        se = float(np.sqrt(sigma2 / jt_j))
    else:
        se = float((p_max - p_min) * 0.05)

    ci_low = float(np.clip(theta_opt - 1.96 * se, p_min, p_max))
    ci_high = float(np.clip(theta_opt + 1.96 * se, p_min, p_max))

    rmse_reduction = float(max(0.0, ((prior_rmse - calib_rmse) / prior_rmse) * 100.0)) if prior_rmse > 0 else 0.0

    return CalibrationResult(
        parameter_key=parameter_key,
        prior_value=round(theta_0, 4),
        calibrated_value=round(theta_opt, 4),
        ci_95=[round(ci_low, 4), round(ci_high, 4)],
        standard_error=round(se, 4),
        prior_rmse=round(prior_rmse, 3),
        calibrated_rmse=round(calib_rmse, 3),
        rmse_reduction_pct=round(rmse_reduction, 1),
        n_evidence_points=m,
    )

