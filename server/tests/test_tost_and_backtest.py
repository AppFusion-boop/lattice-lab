"""Tests for T3-4: TOST practical equivalence, Holm-Bonferroni correction, and K-fold false-exclusion backtest."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from lattice_server.stats.tost import apply_multiplicity_correction, run_tost_equivalence


def test_tost_equivalence_shows_equivalence_and_rejects_large_differences() -> None:
    rng = np.random.default_rng(101)
    group_a = list(10.0 + rng.normal(0.0, 0.1, size=12))
    group_b = list(10.05 + rng.normal(0.0, 0.1, size=12))

    # Mean difference ~0.05 within ±0.5 margin -> equivalent == True, p < 0.05
    res_eq = run_tost_equivalence(
        group_a,
        group_b,
        margin=0.5,
        alpha=0.05,
        label_a="Nozzle=4",
        label_b="Nozzle=8",
        outcome_key="peak_pressure",
        unit="kPa",
    )
    assert res_eq.equivalent is True
    assert res_eq.p_value < 0.05
    assert "Equivalence shown within ±0.5 kPa" in res_eq.statement

    # Group C with mean difference ~1.2 outside ±0.5 margin -> equivalent == False
    group_c = list(11.2 + rng.normal(0.0, 0.1, size=12))
    res_neq = run_tost_equivalence(
        group_a,
        group_c,
        margin=0.5,
        alpha=0.05,
        label_a="Nozzle=4",
        label_b="Nozzle=12",
        outcome_key="peak_pressure",
        unit="kPa",
    )
    assert res_neq.equivalent is False
    assert "Equivalence not shown" in res_neq.statement


def test_holm_bonferroni_multiplicity_correction() -> None:
    p_vals = [0.005, 0.02, 0.08]
    reject, p_adj = apply_multiplicity_correction(p_vals, alpha=0.05, method="holm")
    assert reject == [True, True, False]
    assert len(p_adj) == 3


def test_kfold_backtest_endpoint_controls_false_exclusion_rate(client: TestClient) -> None:
    s_res = client.post("/api/v1/studies", json={"name": "Backtest Study", "rng_seed": 42})
    assert s_res.status_code == 201
    study_id = s_res.json()["id"]

    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "x",
            "label": "X",
            "unit": "m",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 0.0, "max": 1.0},
        },
    )
    client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "y",
            "label": "Y",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 5.0},
        },
    )

    rng = np.random.default_rng(42)
    for xv in np.linspace(0.0, 1.0, 20):
        yv = float(10.0 * xv + rng.normal(0.0, 0.2))
        client.post(
            f"/api/v1/studies/{study_id}/evidence",
            json={
                "kind": "lab",
                "values": {"x": float(xv)},
                "outcomes": {"y": yv},
                "status": "valid",
            },
        )

    bt_res = client.post(f"/api/v1/studies/{study_id}/analyses/backtest", json={"k_folds": 5})
    assert bt_res.status_code == 200
    body = bt_res.json()
    assert body["n_evidence"] == 20
    assert body["false_exclusion_rate"] <= body["nominal_delta"] + 0.05
    assert body["within_nominal_bound"] is True

