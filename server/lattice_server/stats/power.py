"""Statistical Power & Replicate Count Calculator (P5-3, T3-5)."""

from __future__ import annotations

import math

from statsmodels.stats.power import TTestIndPower


def calculate_required_replicates(
    min_effect: float,
    noise_sd: float,
    alpha: float = 0.05,
    power: float = 0.80,
) -> dict[str, float | int]:
    """Calculate minimum replicate count per group for a two-sided t-test at specified alpha and power."""
    if min_effect <= 0 or noise_sd <= 0:
        raise ValueError("min_effect and noise_sd must be > 0")
    cohens_d = min_effect / noise_sd
    n_raw = float(
        TTestIndPower().solve_power(
            effect_size=cohens_d,
            alpha=alpha,
            power=power,
            alternative="two-sided",
        )
    )
    replicates = max(2, math.ceil(n_raw))
    return {
        "cohens_d": round(cohens_d, 4),
        "exact_n": round(n_raw, 2),
        "recommended_replicates": replicates,
        "alpha": alpha,
        "power": power,
    }
