"""Clopper-Pearson exact confidence bounds (§4.4)."""

from __future__ import annotations

from scipy.stats import beta


def clopper_pearson_upper(k: int, n: int, delta: float = 0.05) -> float:
    """One-sided (1 - delta) Clopper-Pearson upper confidence bound.

    p_upper = BetaInv(1 - delta; k + 1, n - k).
    When k == n, p_upper = 1.0.

    Reference values (§4.4):
    - delta = 0.05, k = 0, n = 58 -> p_upper ≈ 0.0503 (not excludable at tau = 0.05)
    - delta = 0.05, k = 0, n = 59 -> p_upper ≈ 0.0495 < 0.05 (excludable at tau = 0.05)
    """
    if n <= 0:
        return 1.0
    if k >= n:
        return 1.0
    if k < 0:
        return 0.0
    return float(beta.ppf(1.0 - delta, k + 1, n - k))


def clopper_pearson_lower(k: int, n: int, delta: float = 0.05) -> float:
    """One-sided (1 - delta) Clopper-Pearson lower confidence bound.

    p_lower = BetaInv(delta; k, n - k + 1) when k > 0, else 0.0.
    """
    if n <= 0 or k <= 0:
        return 0.0
    if k >= n:
        return float(beta.ppf(delta, n, 1))
    return float(beta.ppf(delta, k, n - k + 1))

