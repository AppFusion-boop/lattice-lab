"""Unit tests for Pareto frontier analysis (§4.4, §13)."""

from __future__ import annotations

import numpy as np
import pytest

from lattice_server.stats.pareto import compute_pareto_analysis, non_dominated_sort_2d


def test_non_dominated_sort_2d_known_points():
    # 2D minimization: lower is better
    # Points:
    # A=(10, 50) -> frontier (low x)
    # B=(20, 30) -> frontier (trade-off)
    # C=(30, 20) -> frontier (trade-off)
    # D=(50, 10) -> frontier (low y)
    # E=(25, 35) -> dominated by B=(20, 30)
    # F=(35, 25) -> dominated by C=(30, 20)
    # G=(40, 40) -> dominated by B, C
    costs = np.array([
        [10.0, 50.0],
        [20.0, 30.0],
        [30.0, 20.0],
        [50.0, 10.0],
        [25.0, 35.0],
        [35.0, 25.0],
        [40.0, 40.0],
    ])
    ranks = non_dominated_sort_2d(costs)

    # A, B, C, D should have rank 1
    assert ranks[0] == 1
    assert ranks[1] == 1
    assert ranks[2] == 1
    assert ranks[3] == 1

    # E, F, G should be rank > 1
    assert ranks[4] > 1
    assert ranks[5] > 1
    assert ranks[6] > 1


def test_compute_pareto_analysis():
    candidates = [
        {"id": "c1", "label": "Low Temp", "values": {"w": 0.2}, "outcomes": {"pressure_drop": 45.0, "t_junction": 65.0}},
        {"id": "c2", "label": "Balanced", "values": {"w": 0.4}, "outcomes": {"pressure_drop": 25.0, "t_junction": 72.0}},
        {"id": "c3", "label": "Low Head", "values": {"w": 0.6}, "outcomes": {"pressure_drop": 15.0, "t_junction": 82.0}},
        {"id": "c4", "label": "Dominated 1", "values": {"w": 0.3}, "outcomes": {"pressure_drop": 35.0, "t_junction": 78.0}},
        {"id": "c5", "label": "Dominated 2", "values": {"w": 0.5}, "outcomes": {"pressure_drop": 28.0, "t_junction": 80.0}},
    ]

    res = compute_pareto_analysis(
        candidates=candidates,
        x_outcome_key="pressure_drop",
        y_outcome_key="t_junction",
        study_id="std_test",
        x_direction="minimize",
        y_direction="minimize",
    )

    assert res.total_candidates == 5
    assert res.frontier_count == 3
    frontier_ids = [p.candidate_id for p in res.frontier]
    assert frontier_ids == ["c3", "c2", "c1"]  # Sorted along x_outcome ascending: 15, 25, 45
    assert res.ideal_point["pressure_drop"] == 15.0
    assert res.ideal_point["t_junction"] == 65.0

