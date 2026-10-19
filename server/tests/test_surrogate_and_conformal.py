"""Tests for T3-3: Gaussian Process surrogates, split-conformal intervals, and Kennedy-O'Hagan hybrid model."""

from __future__ import annotations

import numpy as np

from lattice_server.schemas import OutcomeCriterion, ParameterResponse
from lattice_server.stats.surrogate import (
    GPSurrogate,
    HybridDiscrepancySurrogate,
    criterion_success_probability,
)


def _make_controlled_param(key: str = "x", lo: float = 0.0, hi: float = 1.0) -> ParameterResponse:
    return ParameterResponse(
        id=f"p_{key}",
        study_id="s1",
        key=key,
        label=key.upper(),
        unit="m",
        kind="continuous",
        role="controlled",
        spec={"min": lo, "max": hi},
        position=0,
    )


def test_gp_surrogate_conformal_coverage_and_exclusion() -> None:
    rng = np.random.default_rng(42)
    param = _make_controlled_param("x", 0.0, 1.0)

    x_vals = np.linspace(0.0, 1.0, 15)
    y_true = 10.0 * x_vals + rng.normal(0.0, 0.15, size=15)
    x_rows = [{"x": float(xv)} for xv in x_vals]

    gp = GPSurrogate(parameters=[param], outcome_key="y", seed=42)
    metrics = gp.fit(x_rows, y_true)

    assert metrics.n_samples == 15
    assert metrics.cv_coverage_90 >= 0.80
    assert np.isfinite(metrics.conformal_multiplier)
    assert metrics.is_validated is True

    # Evaluate candidates at x=0.1 (y~1.0, passes y < 3.0) and x=0.9 (y~9.0, fails y < 3.0)
    cand_rows = [{"x": 0.1}, {"x": 0.9}]
    mean, std = gp.predict(cand_rows)
    crit = OutcomeCriterion(op="<", value=3.0)
    p_hat, p_upper, p_lower = criterion_success_probability(mean, std, crit, delta=0.05)

    # x=0.1 should have high success probability
    assert p_hat[0] > 0.95
    assert p_lower[0] > 0.80
    # x=0.9 should have p_upper < 0.05 -> excluded at 95% confidence!
    assert p_upper[1] < 0.05


def test_kennedy_ohagan_hybrid_discrepancy_reduces_biased_model_rmse() -> None:
    param = _make_controlled_param("x", 0.0, 10.0)
    x_vals = np.linspace(0.0, 10.0, 12)
    x_rows = [{"x": float(xv)} for xv in x_vals]

    # Biased physics model: y_model = 2.0 * x
    # True physical system: y_meas = 2.0 * x + 5.0 + 0.3 * x
    y_mod = 2.0 * x_vals
    y_meas = 2.3 * x_vals + 5.0

    hybrid = HybridDiscrepancySurrogate(parameters=[param], outcome_key="y", seed=42)
    metrics = hybrid.fit(x_rows, y_meas, y_mod)

    # Hybrid CV RMSE must be < 10% of the uncalibrated physics model prior RMSE
    assert hybrid.prior_rmse > 5.0
    assert metrics.cv_rmse < 0.10 * hybrid.prior_rmse

    # Check prediction at x = 5.0 (true = 16.5, model = 10.0)
    pred_mean, pred_std = hybrid.predict([{"x": 5.0}], np.array([10.0]))
    assert abs(pred_mean[0] - 16.5) < 0.25
    assert pred_std[0] > 0.0

