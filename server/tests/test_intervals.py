"""Tests for T3-1: Deterministic Interval Arithmetic Futility Prover & Critical Threshold Theorems."""

from __future__ import annotations

import math

from lattice_server.schemas import OutcomeCriterion, OutcomeResponse, ParameterResponse
from lattice_server.stats.intervals import (
    Interval,
    evaluate_interval_expression,
    find_critical_threshold_theorems,
    is_interval_proven_futile,
    is_interval_proven_viable,
)


def test_interval_arithmetic_bounds_and_futility_proof() -> None:
    # Evaluate amplitude * exp(-0.01 * flow) over amplitude in [15000, 25000], flow in [1, 50]
    env = {
        "amplitude": Interval(15000.0, 25000.0),
        "flow": Interval(1.0, 50.0),
    }
    bounds = evaluate_interval_expression("amplitude * exp(-0.01 * flow)", env)

    expected_low = 15000.0 * math.exp(-0.01 * 50.0)
    expected_high = 25000.0 * math.exp(-0.01 * 1.0)
    assert abs(bounds.low - expected_low) < 1e-6
    assert abs(bounds.high - expected_high) < 1e-6

    # Criterion: peak_pressure < 8000 Pa
    # Since bounds.low ~ 9097.96 >= 8000, NO combination of parameters can satisfy < 8000!
    crit_impossible = OutcomeCriterion(op="<", value=8000.0)
    assert is_interval_proven_futile(bounds, crit_impossible) is True
    assert is_interval_proven_viable(bounds, crit_impossible) is False

    # Criterion: peak_pressure < 30000 Pa
    # Since bounds.high ~ 24751.25 < 30000, ALL combinations satisfy < 30000!
    crit_guaranteed = OutcomeCriterion(op="<", value=30000.0)
    assert is_interval_proven_futile(bounds, crit_guaranteed) is False
    assert is_interval_proven_viable(bounds, crit_guaranteed) is True


def test_critical_threshold_theorems_extracts_futile_parameter_subrange() -> None:
    # Suppose peak_pressure = amplitude * (1 - 0.008 * flow)
    # where uncertain amplitude in [15000, 20000] Pa, controlled flow in [0, 100] L/min,
    # and criterion is peak_pressure < 9000 Pa.
    # Even at the minimum possible amplitude (15000 Pa), if flow <= 50 L/min,
    # peak_pressure >= 15000 * (1 - 0.4) = 9000 Pa, which violates < 9000 Pa!
    params = [
        ParameterResponse(
            id="p_flow",
            study_id="s1",
            key="flow",
            label="Water Flow",
            unit="L/min",
            kind="continuous",
            role="controlled",
            spec={"min": 0.0, "max": 100.0},
            position=0,
        ),
        ParameterResponse(
            id="p_amp",
            study_id="s1",
            key="amplitude",
            label="Blast Amplitude",
            unit="Pa",
            kind="continuous",
            role="uncertain",
            spec={"min": 15000.0, "max": 20000.0},
            position=1,
        ),
    ]
    outcome = OutcomeResponse(
        id="o_p",
        study_id="s1",
        key="peak_pressure",
        label="Peak Pressure",
        unit="Pa",
        kind="continuous",
        direction="minimize",
        criterion=OutcomeCriterion(op="<", value=9000.0),
        position=0,
    )

    theorems = find_critical_threshold_theorems(
        expression="amplitude * (1 - 0.008 * flow)",
        parameters=params,
        outcome=outcome,
        n_slices=50,
    )
    assert len(theorems) == 1
    thm = theorems[0]
    assert thm.parameter_key == "flow"
    assert abs(thm.futile_low - 0.0) < 1e-6
    assert abs(thm.futile_high - 50.0) < 1e-6
    assert thm.outcome_bounds[0] >= 9000.0
    assert "violates criterion" in thm.statement

