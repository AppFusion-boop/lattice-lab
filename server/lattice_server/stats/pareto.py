"""Pareto frontier and multi-objective non-dominated sorting (§4.4, §13)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np


@dataclass
class ParetoPoint:
    candidate_id: str
    label: str | None
    values: dict[str, Any]
    outcomes: dict[str, float]
    rank: int


@dataclass
class ParetoResult:
    study_id: str
    x_outcome: str
    y_outcome: str
    x_direction: Literal["minimize", "maximize"]
    y_direction: Literal["minimize", "maximize"]
    total_candidates: int
    frontier_count: int
    ideal_point: dict[str, float]
    nadir_point: dict[str, float]
    frontier: list[ParetoPoint]
    all_points: list[ParetoPoint]


def non_dominated_sort_2d(
    costs: np.ndarray,
) -> np.ndarray:
    """Fast 2D non-dominated sorting where lower costs are better.

    Args:
        costs: (N, 2) array of normalized costs where minimization is assumed.

    Returns:
        ranks: (N,) integer array of Pareto ranks (1-indexed, 1 = non-dominated frontier).
    """
    n = costs.shape[0]
    ranks = np.zeros(n, dtype=int)
    remaining = np.ones(n, dtype=bool)
    current_rank = 1

    while np.any(remaining):
        subset_indices = np.where(remaining)[0]
        subset_costs = costs[subset_indices]
        m = len(subset_indices)
        is_efficient = np.ones(m, dtype=bool)

        for i in range(m):
            if not is_efficient[i]:
                continue
            c = subset_costs[i]
            # Dominated by c: c <= c_other for all dims AND c < c_other for at least one dim
            dominated = np.all(c <= subset_costs, axis=1) & np.any(c < subset_costs, axis=1)
            is_efficient[dominated] = False

        frontier_indices = subset_indices[is_efficient]
        ranks[frontier_indices] = current_rank
        remaining[frontier_indices] = False
        current_rank += 1

    return ranks


def compute_pareto_analysis(
    candidates: list[dict[str, Any]],
    x_outcome_key: str,
    y_outcome_key: str,
    study_id: str,
    x_direction: Literal["minimize", "maximize"] = "minimize",
    y_direction: Literal["minimize", "maximize"] = "minimize",
) -> ParetoResult:
    """Compute 2D Pareto trade-off frontier for two continuous outcomes.

    Args:
        candidates: List of candidate records containing 'id', 'values', 'outcomes'.
        x_outcome_key: Key of outcome to plot on X-axis (e.g. pressure_drop).
        y_outcome_key: Key of outcome to plot on Y-axis (e.g. t_junction).
        study_id: Parent study ID.
        x_direction: Minimization or maximization for X.
        y_direction: Minimization or maximization for Y.
    """
    valid_candidates = []
    x_vals: list[float] = []
    y_vals: list[float] = []

    for c in candidates:
        outs = c.get("outcomes") or {}
        vx = outs.get(x_outcome_key)
        vy = outs.get(y_outcome_key)
        if vx is not None and vy is not None:
            try:
                fx = float(vx)
                fy = float(vy)
                if np.isfinite(fx) and np.isfinite(fy):
                    valid_candidates.append(c)
                    x_vals.append(fx)
                    y_vals.append(fy)
            except (ValueError, TypeError):
                continue

    if not valid_candidates:
        return ParetoResult(
            study_id=study_id,
            x_outcome=x_outcome_key,
            y_outcome=y_outcome_key,
            x_direction=x_direction,
            y_direction=y_direction,
            total_candidates=0,
            frontier_count=0,
            ideal_point={},
            nadir_point={},
            frontier=[],
            all_points=[],
        )

    raw_x = np.array(x_vals, dtype=float)
    raw_y = np.array(y_vals, dtype=float)

    # Normalize so smaller is better
    norm_x = raw_x if x_direction == "minimize" else -raw_x
    norm_y = raw_y if y_direction == "minimize" else -raw_y

    costs = np.column_stack([norm_x, norm_y])
    ranks = non_dominated_sort_2d(costs)

    all_points: list[ParetoPoint] = []
    frontier: list[ParetoPoint] = []

    for idx, c in enumerate(valid_candidates):
        pt = ParetoPoint(
            candidate_id=c["id"],
            label=c.get("label"),
            values=c.get("values", {}),
            outcomes={x_outcome_key: raw_x[idx], y_outcome_key: raw_y[idx]},
            rank=int(ranks[idx]),
        )
        all_points.append(pt)
        if ranks[idx] == 1:
            frontier.append(pt)

    # Sort frontier points along X-axis for smooth curve rendering
    frontier.sort(key=lambda p: p.outcomes[x_outcome_key])

    # Ideal and nadir points on frontier
    frontier_x = [p.outcomes[x_outcome_key] for p in frontier]
    frontier_y = [p.outcomes[y_outcome_key] for p in frontier]

    ideal_x = min(frontier_x) if x_direction == "minimize" else max(frontier_x)
    ideal_y = min(frontier_y) if y_direction == "minimize" else max(frontier_y)
    nadir_x = max(frontier_x) if x_direction == "minimize" else min(frontier_x)
    nadir_y = max(frontier_y) if y_direction == "minimize" else min(frontier_y)

    return ParetoResult(
        study_id=study_id,
        x_outcome=x_outcome_key,
        y_outcome=y_outcome_key,
        x_direction=x_direction,
        y_direction=y_direction,
        total_candidates=len(valid_candidates),
        frontier_count=len(frontier),
        ideal_point={x_outcome_key: ideal_x, y_outcome_key: ideal_y},
        nadir_point={x_outcome_key: nadir_x, y_outcome_key: nadir_y},
        frontier=frontier,
        all_points=all_points,
    )

