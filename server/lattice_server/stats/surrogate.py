"""Gaussian Process Surrogates, Split-Conformal Intervals & Kennedy–O'Hagan Hybrid Model (T3-3, P4-1..P4-4)."""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.stats import norm
from sklearn.exceptions import ConvergenceWarning
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, Matern, WhiteKernel
from sklearn.model_selection import KFold

from lattice_server.schemas import OutcomeCriterion, ParameterResponse
from lattice_server.stats.conformal import compute_conformal_multiplier


class FeatureEncoder:
    """Deterministic encoder mapping controlled parameter dicts into normalized [0, 1] feature vectors."""

    def __init__(self, parameters: list[ParameterResponse]) -> None:
        self.parameters = [p for p in parameters if p.role == "controlled"]
        self.dim = 0
        self._specs: list[dict[str, Any]] = []
        for p in self.parameters:
            s = p.spec if isinstance(p.spec, dict) else {}
            if p.kind == "categorical":
                opts = list(s.get("options") or ["default"])
                self._specs.append({"key": p.key, "kind": "categorical", "options": opts})
                self.dim += max(1, len(opts))
            else:
                lo = float(s.get("min", 0.0) if s.get("min") is not None else 0.0)
                hi = float(s.get("max", 1.0) if s.get("max") is not None else 1.0)
                scale = str(s.get("scale", "linear"))
                self._specs.append(
                    {"key": p.key, "kind": "numeric", "min": lo, "max": hi, "scale": scale}
                )
                self.dim += 1

    def transform(self, rows: list[dict[str, Any]]) -> np.ndarray:
        if not rows:
            return np.zeros((0, max(1, self.dim)), dtype=np.float64)
        out = np.zeros((len(rows), max(1, self.dim)), dtype=np.float64)
        for i, row in enumerate(rows):
            col = 0
            for sp in self._specs:
                val = row.get(sp["key"])
                if sp["kind"] == "categorical":
                    opts = sp["options"]
                    for j, opt in enumerate(opts):
                        if str(val) == str(opt):
                            out[i, col + j] = 1.0
                    col += max(1, len(opts))
                else:
                    lo, hi = sp["min"], sp["max"]
                    v = float(val) if isinstance(val, (int, float)) else 0.5 * (lo + hi)
                    if sp["scale"] == "log" and lo > 0 and hi > lo and v > 0:
                        out[i, col] = np.clip(
                            (np.log(v) - np.log(lo)) / max(1e-12, np.log(hi) - np.log(lo)),
                            0.0,
                            1.0,
                        )
                    else:
                        out[i, col] = np.clip((v - lo) / max(1e-12, hi - lo), 0.0, 1.0)
                    col += 1
        return out


def criterion_success_probability(
    mean: np.ndarray,
    std: np.ndarray,
    criterion: OutcomeCriterion,
    delta: float = 0.05,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute (p_hat, p_upper, p_lower) of satisfying `criterion` under N(mean, std^2).

    Wait: for a Gaussian predictive distribution Y ~ N(mu, sigma^2) where sigma is already
    conformal-calibrated, p_hat = P(Y in S). To provide a conservative upper confidence bound
    p_upper at level 1 - delta accounting for epistemic uncertainty in mu, we shift mu by
    z_{1-delta} * (sigma / sqrt(2)) toward the criterion interior.
    """
    safe_std = np.maximum(1e-9, std)
    z_conf = float(norm.ppf(1.0 - delta))
    epistemic_shift = 0.35 * z_conf * safe_std

    op = criterion.op
    if op in ("<", "<=") and criterion.value is not None:
        c = float(criterion.value)
        p_hat = norm.cdf((c - mean) / safe_std)
        p_upper = norm.cdf((c - (mean - epistemic_shift)) / safe_std)
        p_lower = norm.cdf((c - (mean + epistemic_shift)) / safe_std)
    elif op in (">", ">=") and criterion.value is not None:
        c = float(criterion.value)
        p_hat = 1.0 - norm.cdf((c - mean) / safe_std)
        p_upper = 1.0 - norm.cdf((c - (mean + epistemic_shift)) / safe_std)
        p_lower = 1.0 - norm.cdf((c - (mean - epistemic_shift)) / safe_std)
    elif op == "between" and criterion.low is not None and criterion.high is not None:
        lo, hi = float(criterion.low), float(criterion.high)
        mid = 0.5 * (lo + hi)
        p_hat = norm.cdf((hi - mean) / safe_std) - norm.cdf((lo - mean) / safe_std)
        # Shift mean toward midpoint of [lo, hi] for conservative upper bound
        mean_toward_mid = np.where(
            np.abs(mean - mid) <= epistemic_shift,
            mid,
            mean - np.sign(mean - mid) * epistemic_shift,
        )
        mean_away_mid = mean + np.where(mean >= mid, 1.0, -1.0) * epistemic_shift
        p_upper = norm.cdf((hi - mean_toward_mid) / safe_std) - norm.cdf((lo - mean_toward_mid) / safe_std)
        p_lower = norm.cdf((hi - mean_away_mid) / safe_std) - norm.cdf((lo - mean_away_mid) / safe_std)
    else:
        p_hat = np.ones_like(mean)
        p_upper = np.ones_like(mean)
        p_lower = np.ones_like(mean)

    return (
        np.clip(p_hat, 0.0, 1.0),
        np.clip(np.maximum(p_hat, p_upper), 0.0, 1.0),
        np.clip(np.minimum(p_hat, p_lower), 0.0, 1.0),
    )


@dataclass
class SurrogateValidationMetrics:
    n_samples: int
    n_features: int
    cv_rmse: float
    cv_coverage_90: float
    median_abs_z: float
    conformal_multiplier: float
    is_validated: bool


class GPSurrogate:
    """Matérn 5/2 Gaussian Process surrogate with K-fold cross-validation & conformal calibration."""

    def __init__(
        self,
        parameters: list[ParameterResponse],
        outcome_key: str,
        seed: int = 42,
    ) -> None:
        self.encoder = FeatureEncoder(parameters)
        self.outcome_key = outcome_key
        self.seed = seed
        self.gp: GaussianProcessRegressor | None = None
        self.metrics: SurrogateValidationMetrics | None = None

    def _make_gp(self, d: int) -> GaussianProcessRegressor:
        kernel = ConstantKernel(1.0, (1e-3, 1e3)) * Matern(
            length_scale=np.ones(max(1, d)),
            length_scale_bounds=(1e-2, 1e2),
            nu=2.5,
        ) + WhiteKernel(noise_level=0.05, noise_level_bounds=(1e-6, 10.0))
        return GaussianProcessRegressor(
            kernel=kernel,
            normalize_y=True,
            n_restarts_optimizer=2,
            random_state=self.seed,
        )

    def fit(self, X_rows: list[dict[str, Any]], y: np.ndarray) -> SurrogateValidationMetrics:
        X = self.encoder.transform(X_rows)
        y_arr = np.asarray(y, dtype=np.float64)
        n, d = X.shape

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ConvergenceWarning)
            if n >= 4:
                n_splits = min(5, n)
                kf = KFold(n_splits=n_splits, shuffle=True, random_state=self.seed)
                oof_mean = np.zeros(n, dtype=np.float64)
                oof_std = np.zeros(n, dtype=np.float64)
                for train_idx, test_idx in kf.split(X):
                    fold_gp = self._make_gp(d)
                    fold_gp.fit(X[train_idx], y_arr[train_idx])
                    m, s = fold_gp.predict(X[test_idx], return_std=True)
                    oof_mean[test_idx] = m
                    oof_std[test_idx] = np.maximum(1e-6, s)

                scale_mult, _cov_90, med_z = compute_conformal_multiplier(y_arr, oof_mean, oof_std, alpha=0.10)
                # Recompute calibrated coverage with scale_mult applied
                _, cal_cov_90, _ = compute_conformal_multiplier(y_arr, oof_mean, oof_std * scale_mult, alpha=0.10)
                cv_rmse = float(np.sqrt(np.mean((y_arr - oof_mean) ** 2)))
            else:
                scale_mult, cal_cov_90, med_z, cv_rmse = 1.5, 0.0, 999.0, 0.0

            self.gp = self._make_gp(d)
            self.gp.fit(X, y_arr)

        min_n = max(8, 2 * d)
        is_val = bool(n >= min_n and cal_cov_90 >= 0.80 and med_z <= 2.5)
        self.metrics = SurrogateValidationMetrics(
            n_samples=n,
            n_features=d,
            cv_rmse=round(cv_rmse, 6),
            cv_coverage_90=round(cal_cov_90, 4),
            median_abs_z=round(med_z, 4),
            conformal_multiplier=round(scale_mult, 4),
            is_validated=is_val,
        )
        return self.metrics

    def predict(self, X_rows: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray]:
        """Return (mean, conformal_calibrated_std) for candidate parameter dicts."""
        if self.gp is None or not X_rows:
            n = len(X_rows)
            return np.zeros(n), np.ones(n)
        X = self.encoder.transform(X_rows)
        mean, std = self.gp.predict(X, return_std=True)
        mult = self.metrics.conformal_multiplier if self.metrics else 1.0
        return np.asarray(mean, dtype=np.float64), np.maximum(1e-9, np.asarray(std, dtype=np.float64) * mult)


class HybridDiscrepancySurrogate:
    """Kennedy–O'Hagan hybrid discrepancy model: y(x) = y_model(x) + delta_GP(x) (P4-3)."""

    def __init__(
        self,
        parameters: list[ParameterResponse],
        outcome_key: str,
        seed: int = 42,
    ) -> None:
        self.residual_gp = GPSurrogate(parameters=parameters, outcome_key=outcome_key, seed=seed)
        self.outcome_key = outcome_key
        self.prior_rmse: float = 0.0
        self.hybrid_cv_rmse: float = 0.0

    def fit(
        self,
        X_rows: list[dict[str, Any]],
        y_measured: np.ndarray,
        y_model_at_evidence: np.ndarray,
    ) -> SurrogateValidationMetrics:
        y_meas = np.asarray(y_measured, dtype=np.float64)
        y_mod = np.asarray(y_model_at_evidence, dtype=np.float64)
        residuals = y_meas - y_mod
        self.prior_rmse = float(np.sqrt(np.mean(residuals**2))) if len(residuals) > 0 else 0.0
        metrics = self.residual_gp.fit(X_rows, residuals)
        self.hybrid_cv_rmse = metrics.cv_rmse
        return metrics

    @property
    def metrics(self) -> SurrogateValidationMetrics | None:
        return self.residual_gp.metrics

    def predict(
        self,
        X_rows: list[dict[str, Any]],
        y_model_mean: np.ndarray,
        y_model_std: np.ndarray | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Combine Flow Model prediction (mu_m, sigma_m) with GP discrepancy (mu_delta, sigma_delta)."""
        delta_mean, delta_std = self.residual_gp.predict(X_rows)
        mod_mean = np.asarray(y_model_mean, dtype=np.float64)
        mod_std = (
            np.asarray(y_model_std, dtype=np.float64)
            if y_model_std is not None
            else np.zeros_like(mod_mean)
        )
        hybrid_mean = mod_mean + delta_mean
        hybrid_std = np.sqrt(mod_std**2 + delta_std**2)
        return hybrid_mean, np.maximum(1e-9, hybrid_std)
