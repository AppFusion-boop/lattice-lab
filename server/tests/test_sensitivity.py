"""Unit tests for Sobol sensitivity analysis module (§4.4, §13)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from lattice_server.schemas import (
    ModelVersionResponse,
    OutcomeResponse,
    ParameterBindingModel,
    ParameterResponse,
)
from lattice_server.stats.sensitivity import compute_sobol_sensitivity


def test_sobol_sensitivity_identification():
    # Construct mock parameters: x0 (dominant), x1 (secondary), x2 (negligible)
    p0 = ParameterResponse(
        id="p0",
        study_id="s1",
        label="channel_width",
        key="w",
        role="controlled",
        kind="continuous",
        spec={"min": 0.1, "max": 1.0},
        unit="mm",
        position=0,
    )
    p1 = ParameterResponse(
        id="p1",
        study_id="s1",
        label="flow_velocity",
        key="v",
        role="controlled",
        kind="continuous",
        spec={"min": 0.5, "max": 3.0},
        unit="m/s",
        position=1,
    )
    p2 = ParameterResponse(
        id="p2",
        study_id="s1",
        label="fin_thickness",
        key="t",
        role="controlled",
        kind="continuous",
        spec={"min": 0.1, "max": 0.5},
        unit="mm",
        position=2,
    )

    outcome = OutcomeResponse(
        id="out0",
        study_id="s1",
        label="Junction Temp",
        key="t_junction",
        unit="degC",
        kind="continuous",
        direction="minimize",
        criterion=None,
        position=0,
    )

    model = ModelVersionResponse(
        id="mod1",
        study_id="s1",
        version=1,
        kind="flow",
        project={"nodes": [], "edges": []},
        parameter_bindings=[
            ParameterBindingModel(parameter_key="w", node_id="n1", param_key="w"),
            ParameterBindingModel(parameter_key="v", node_id="n1", param_key="v"),
            ParameterBindingModel(parameter_key="t", node_id="n1", param_key="t"),
        ],
        outcome_bindings=[],
        validation_status="validated",
        notes="mock",
        created_at="2026-10-15T00:00:00Z",
    )

    # Mock the engine bridge evaluate to simulate:
    # y = 100 - 30*w - 10*v + 0.05*t
    def mock_evaluate(project, param_bindings, outcome_bindings, rows, **kwargs):
        res_list = []
        for r in rows:
            w_val = r["values"]["w"]
            v_val = r["values"]["v"]
            t_val = r["values"]["t"]
            y_val = 100.0 - 30.0 * w_val - 10.0 * v_val + 0.05 * t_val
            mock_res = MagicMock()
            mock_res.id = r["id"]
            mock_res.outcomes = {"t_junction": y_val}
            res_list.append(mock_res)
        return res_list

    with patch("lattice_server.stats.sensitivity.bridge.evaluate", side_effect=mock_evaluate):
        res = compute_sobol_sensitivity(
            model=model,
            parameters=[p0, p1, p2],
            outcome=outcome,
            n_samples=32,
            seed=42,
            freezing_threshold=0.05,
        )

    assert res.outcome_key == "t_junction"
    assert len(res.parameters) == 3

    # Ranking check: channel_width and flow_velocity dominate, fin_thickness is lowest
    param_order = [p.key for p in res.parameters]
    assert param_order[-1] == "t"

    w_sens = next(p for p in res.parameters if p.key == "w")
    t_sens = next(p for p in res.parameters if p.key == "t")

    assert w_sens.total_order > 0.4
    assert t_sens.total_order < 0.05

    # Check freezing recommendation for negligible parameter
    assert len(res.freezing_recommendations) >= 1
    frozen_keys = [fr.key for fr in res.freezing_recommendations]
    assert "t" in frozen_keys
    t_rec = next(fr for fr in res.freezing_recommendations if fr.key == "t")
    assert t_rec.suggested_value == 0.3  # Midpoint of [0.1, 0.5]
