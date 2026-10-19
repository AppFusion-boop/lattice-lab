"""Two One-Sided Tests (TOST) for Practical Equivalence & Holm-Bonferroni Multiplicity Control (§4.5, P4-5, T3-4)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
from scipy import stats
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.weightstats import ttost_ind


@dataclass(frozen=True)
class TostResult:
    label_a: str
    label_b: str
    outcome_key: str
    unit: str
    n_a: int
    n_b: int
    mean_a: float
    mean_b: float
    mean_diff: float
    ci_low: float
    ci_high: float
    margin: float
    alpha: float
    p_value: float
    equivalent: bool
    statement: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def run_tost_equivalence(
    group_a: list[float],
    group_b: list[float],
    *,
    margin: float,
    alpha: float = 0.05,
    label_a: str = "Group A",
    label_b: str = "Group B",
    outcome_key: str = "outcome",
    unit: str = "",
) -> TostResult:
    """Perform Welch's Two One-Sided Tests (TOST) for practical equivalence within ±margin."""
    if margin <= 0:
        raise ValueError("Equivalence margin must be strictly positive (> 0).")
    if len(group_a) < 2 or len(group_b) < 2:
        raise ValueError("Each group must contain at least 2 observations for TOST equivalence testing.")

    arr_a = np.asarray(group_a, dtype=np.float64)
    arr_b = np.asarray(group_b, dtype=np.float64)
    na, nb = len(arr_a), len(arr_b)
    mean_a, mean_b = float(np.mean(arr_a)), float(np.mean(arr_b))
    diff = mean_a - mean_b

    p_tost, _t1, _t2 = ttost_ind(arr_a, arr_b, -margin, margin, usevar="unequal")
    p_val = float(p_tost)

    # (1 - 2*alpha) Welch confidence interval for mean_a - mean_b
    va, vb = float(np.var(arr_a, ddof=1)), float(np.var(arr_b, ddof=1))
    se = max(1e-12, float(np.sqrt(va / na + vb / nb)))
    dof_num = (va / na + vb / nb) ** 2
    dof_den = ((va / na) ** 2) / max(1, na - 1) + ((vb / nb) ** 2) / max(1, nb - 1)
    dof = dof_num / max(1e-12, dof_den)
    t_crit = float(stats.t.ppf(1.0 - alpha, dof))
    ci_low = diff - t_crit * se
    ci_high = diff + t_crit * se

    equivalent = bool(p_val < alpha and ci_low > -margin and ci_high < margin)
    unit_sfx = f" {unit}" if unit else ""

    if equivalent:
        stmt = (
            f"Equivalence shown within ±{margin}{unit_sfx} between {label_a} and {label_b} "
            f"on {outcome_key} (TOST p = {p_val:.4f}, "
            f"{int((1 - 2 * alpha) * 100)}% CI [{ci_low:.3f}, {ci_high:.3f}]{unit_sfx}, n_A={na}, n_B={nb})."
        )
    else:
        stmt = (
            f"Equivalence not shown within ±{margin}{unit_sfx} between {label_a} and {label_b} "
            f"on {outcome_key} (TOST p = {p_val:.4f}, "
            f"{int((1 - 2 * alpha) * 100)}% CI [{ci_low:.3f}, {ci_high:.3f}]{unit_sfx}, n_A={na}, n_B={nb})."
        )

    return TostResult(
        label_a=label_a,
        label_b=label_b,
        outcome_key=outcome_key,
        unit=unit,
        n_a=na,
        n_b=nb,
        mean_a=round(mean_a, 4),
        mean_b=round(mean_b, 4),
        mean_diff=round(diff, 4),
        ci_low=round(ci_low, 4),
        ci_high=round(ci_high, 4),
        margin=margin,
        alpha=alpha,
        p_value=round(p_val, 6),
        equivalent=equivalent,
        statement=stmt,
    )


def apply_multiplicity_correction(
    p_values: list[float],
    alpha: float = 0.05,
    method: str = "holm",
) -> tuple[list[bool], list[float]]:
    """Apply Holm-Bonferroni ('holm') or Benjamini-Hochberg ('fdr_bh') correction to p-values."""
    if not p_values:
        return [], []
    reject, p_adj, _, _ = multipletests(p_values, alpha=alpha, method=method)
    return [bool(r) for r in reject], [round(float(p), 6) for p in p_adj]

