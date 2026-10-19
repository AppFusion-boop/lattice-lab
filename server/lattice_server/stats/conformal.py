"""Split & Cross-Validation Conformal Prediction Calibration (§4.6, P4-2, T3-3)."""

from __future__ import annotations

import math

import numpy as np


def compute_conformal_multiplier(
    y_true: np.ndarray,
    y_pred_mean: np.ndarray,
    y_pred_std: np.ndarray,
    alpha: float = 0.10,
) -> tuple[float, float, float]:
    """Compute finite-sample conformal scaling factor q_hat, empirical 90% coverage, and median |z|.

    Returns:
        (scale_multiplier, empirical_coverage_90, median_abs_z)
    """
    n = len(y_true)
    if n == 0:
        return 1.0, 0.0, 999.0
    safe_std = np.maximum(1e-9, y_pred_std)
    abs_z = np.abs(y_true - y_pred_mean) / safe_std
    median_z = float(np.median(abs_z))

    # 90% normal z-score = 1.6448536
    z_90 = 1.6448536269514722
    covered = np.mean(abs_z <= z_90)

    # Finite-sample conformal quantile level: ceil((n + 1) * (1 - alpha)) / n
    q_level = min(1.0, math.ceil((n + 1) * (1.0 - alpha)) / n)
    q_hat = float(np.quantile(abs_z, q_level))
    scale_mult = max(1.0, q_hat / z_90)
    return scale_mult, float(covered), median_z

