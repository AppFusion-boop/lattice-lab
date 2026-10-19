"""Unit tests for parameter auto-calibration module (§4.4, §13)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from lattice_server.schemas import (
    ModelVersionResponse,
    ParameterBindingModel,
)
from lattice_server.stats.calibration import run_parameter_calibration


def test_parameter_least_squares_calibration():
    model = ModelVersionResponse(
        id="mod_calib_1",
        study_id="s_calib",
        version=1,
        kind="flow",
        project={"nodes": [], "edges": []},
        parameter_bindings=[
            ParameterBindingModel(parameter_key="r_tc", node_id="n1", param_key="r_tc"),
        ],
        outcome_bindings=[],
        validation_status="unvalidated",
        notes="pre-calibrated",
        created_at="2026-10-15T00:00:00Z",
    )

    # True physical relation: y = 30 + 50 * r_tc
    # At true r_tc = 0.45: y = 52.5
    true_r_tc = 0.45

    def mock_evaluate(project, param_bindings, outcome_bindings, rows, **kwargs):
        res_list = []
        for r in rows:
            r_val = float(r["values"].get("r_tc", 0.1))
            sim_temp = 30.0 + 50.0 * r_val
            mock_res = MagicMock()
            mock_res.id = r["id"]
            mock_res.outcomes = {"t_junction": sim_temp}
            res_list.append(mock_res)
        return res_list

    # Evidence points with true measured value 52.5 ± noise
    evidence_points = [
        {"values": {"flow": 1.0}, "outcomes": {"t_junction": 52.4}},
        {"values": {"flow": 1.5}, "outcomes": {"t_junction": 52.6}},
        {"values": {"flow": 2.0}, "outcomes": {"t_junction": 52.5}},
    ]

    with patch("lattice_server.stats.calibration.bridge.evaluate", side_effect=mock_evaluate):
        result = run_parameter_calibration(
            model=model,
            parameter_key="r_tc",
            param_bounds=(0.05, 1.0),
            initial_guess=0.10,  # Far off prior
            evidence_points=evidence_points,
            target_outcome="t_junction",
        )

    assert result.parameter_key == "r_tc"
    assert result.prior_value == 0.10
    # Parameter should converge closely to 0.45
    assert abs(result.calibrated_value - true_r_tc) < 0.02
    assert result.prior_rmse > 15.0  # At 0.10: 35 vs 52.5 -> error ~17.5
    assert result.calibrated_rmse < 0.2
    assert result.rmse_reduction_pct > 90.0
    assert result.ci_95[0] <= true_r_tc <= result.ci_95[1]

