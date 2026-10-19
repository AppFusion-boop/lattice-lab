"""Tests for T1-2: Uncertain distributions, adaptive 2-stage Monte Carlo, and Clopper-Pearson exclusion."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import numpy as np

from lattice_server.engine.bridge import RowResult
from lattice_server.schemas import (
    ModelVersionResponse,
    OutcomeBindingModel,
    OutcomeCriterion,
    OutcomeResponse,
    ParameterBindingModel,
    ParameterResponse,
)
from lattice_server.stats.montecarlo import (
    min_draws_for_exclusion,
    run_monte_carlo_screening,
    sample_uncertain_parameter,
)


def _make_param(
    key: str,
    kind: str = "continuous",
    spec: dict | None = None,
) -> ParameterResponse:
    return ParameterResponse(
        id=f"param_{key}",
        study_id="study_1",
        key=key,
        label=key,
        unit="",
        kind=kind,
        role="uncertain",
        spec=spec or {},
        position=0,
    )


def test_min_draws_for_exclusion() -> None:
    # For tau=0.05, delta=0.05 (95% confidence), n_min = 59
    assert min_draws_for_exclusion(0.05, 0.05) == 59


def test_all_five_uncertain_distributions_respect_bounds_and_moments() -> None:
    rng = np.random.default_rng(12345)
    n = 5000

    # 1. Uniform
    p_unif = _make_param("u", spec={"min": 10.0, "max": 20.0, "distribution": {"type": "uniform"}})
    d_unif = sample_uncertain_parameter(p_unif, rng, n)
    assert np.all((d_unif >= 10.0) & (d_unif <= 20.0))
    assert abs(np.mean(d_unif) - 15.0) < 0.3

    # 2. Normal (truncated)
    p_norm = _make_param(
        "n",
        spec={"min": 0.0, "max": 100.0, "distribution": {"type": "normal", "mean": 30.0, "sd": 5.0}},
    )
    d_norm = sample_uncertain_parameter(p_norm, rng, n)
    assert np.all((d_norm >= 0.0) & (d_norm <= 100.0))
    assert abs(np.mean(d_norm) - 30.0) < 0.3
    assert abs(np.std(d_norm) - 5.0) < 0.3

    # 3. Lognormal (truncated)
    p_logn = _make_param(
        "ln",
        spec={"min": 1.0, "max": 500.0, "distribution": {"type": "lognormal", "median": 25.0, "gsd": 1.4}},
    )
    d_logn = sample_uncertain_parameter(p_logn, rng, n)
    assert np.all((d_logn >= 1.0) & (d_logn <= 500.0))
    assert abs(np.median(d_logn) - 25.0) < 1.0

    # 4. Triangular
    p_tri = _make_param(
        "tri",
        spec={"min": 0.0, "max": 10.0, "distribution": {"type": "triangular", "mode": 8.0}},
    )
    d_tri = sample_uncertain_parameter(p_tri, rng, n)
    assert np.all((d_tri >= 0.0) & (d_tri <= 10.0))
    # Theoretical mean of Tri(a=0, b=10, c=8) is (0 + 10 + 8)/3 = 6.0
    assert abs(np.mean(d_tri) - 6.0) < 0.2

    # 5. Discrete with weights
    p_disc = _make_param(
        "disc",
        spec={
            "min": 1.0,
            "max": 3.0,
            "distribution": {"type": "discrete", "values": [1.0, 2.0, 3.0], "weights": [0.1, 0.2, 0.7]},
        },
    )
    d_disc = sample_uncertain_parameter(p_disc, rng, n)
    assert set(np.unique(d_disc)).issubset({1.0, 2.0, 3.0})
    prop_3 = np.mean(d_disc == 3.0)
    assert abs(prop_3 - 0.7) < 0.03


def test_adaptive_monte_carlo_excludes_at_60_draws_and_early_stops_successes() -> None:
    now = datetime.now(UTC).isoformat()
    uncertain_p = _make_param("temp", spec={"min": 10.0, "max": 30.0, "distribution": {"type": "uniform"}})
    outcome = OutcomeResponse(
        id="out_1",
        study_id="study_1",
        key="pressure",
        label="Pressure",
        unit="Pa",
        kind="continuous",
        direction="minimize",
        criterion=OutcomeCriterion(op="<", value=5000.0),
        position=0,
    )

    model_validated = ModelVersionResponse(
        id="mv_1",
        study_id="study_1",
        version=1,
        kind="flow",
        project={"nodes": []},
        parameter_bindings=[ParameterBindingModel(parameter_key="flow", node_id="n1", param_key="flow")],
        outcome_bindings=[OutcomeBindingModel(outcome_key="pressure", node_id="n1", port="out", reducer="maxAbs")],
        engine_version="2.2.0",
        signature="sig1",
        validation_status="validated",
        validation_json=None,
        notes="",
        created_at=now,
    )

    candidates = [
        {"id": "cand_fail", "idx": 0, "values": {"flow": 10.0}},  # Always fails (pressure = 9000 >= 5000)
        {"id": "cand_pass", "idx": 1, "values": {"flow": 80.0}},  # Always succeeds (pressure = 2000 < 5000)
    ]

    def fake_evaluate(project, param_bindings, outcome_bindings, rows, **kwargs):
        out = []
        for r in rows:
            flow = r["values"]["flow"]
            p = 9000.0 if flow < 50.0 else 2000.0
            out.append(RowResult(id=r["id"], status="ok", outcomes={"pressure": p}))
        return out

    with patch("lattice_server.engine.bridge.evaluate", side_effect=fake_evaluate):
        res = run_monte_carlo_screening(
            model=model_validated,
            candidates=candidates,
            uncertain_params=[uncertain_p],
            outcomes=[outcome],
            rng_seed=42,
            exclusion_threshold=0.05,
            confidence=0.95,
            mc_draws=60,
            adaptive=True,
            round_size=20,
        )

    # cand_fail: k=0 across 60 draws -> p_upper ~ 0.0487 < 0.05 -> excluded!
    fail_res = res["cand_fail"]
    assert fail_res.n_draws == 60
    assert fail_res.k_successes == 0
    assert fail_res.p_upper < 0.05
    assert fail_res.status == "excluded"

    # cand_pass: k=20 in round 0 -> p_lower ~ 0.861 >= 0.05 -> early stop at 20 draws!
    # And status MUST be "open", never "recommended"
    pass_res = res["cand_pass"]
    assert pass_res.n_draws == 20
    assert pass_res.k_successes == 20
    assert pass_res.p_lower >= 0.05
    assert pass_res.status == "open"

    # Unvalidated model: cand_fail must be deprioritised, NEVER excluded (Hard Rule 6)
    model_unvalidated = model_validated.model_copy(update={"validation_status": "unvalidated"})
    with patch("lattice_server.engine.bridge.evaluate", side_effect=fake_evaluate):
        res_unval = run_monte_carlo_screening(
            model=model_unvalidated,
            candidates=candidates,
            uncertain_params=[uncertain_p],
            outcomes=[outcome],
            rng_seed=42,
            exclusion_threshold=0.05,
            confidence=0.95,
            mc_draws=60,
            adaptive=True,
            round_size=20,
        )
    assert res_unval["cand_fail"].status == "deprioritised"
