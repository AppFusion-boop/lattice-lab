"""Tests for T3-5 and T4-1: Active learning batch selection, power calculator, and Buckingham Pi dimensional reducer."""

from __future__ import annotations

from fastapi.testclient import TestClient

from lattice_server.stats.power import calculate_required_replicates


def test_power_calculator_returns_64_replicates_for_cohens_d_05() -> None:
    res = calculate_required_replicates(min_effect=0.5, noise_sd=1.0, alpha=0.05, power=0.80)
    assert res["cohens_d"] == 0.5
    assert res["recommended_replicates"] == 64


def test_active_learning_batch_selection_and_buckingham_pi(client: TestClient) -> None:
    s_res = client.post("/api/v1/studies", json={"name": "Batch & Dimensional Study", "rng_seed": 42})
    assert s_res.status_code == 201
    study_id = s_res.json()["id"]

    # Add 4 fluid-mechanics parameters: velocity (m/s), diameter (m), density (kg/m**3), viscosity (Pa*s)
    for key, unit, lo, hi in [
        ("velocity", "m/s", 1.0, 20.0),
        ("diameter", "m", 0.1, 2.0),
        ("density", "kg/m**3", 1.0, 1000.0),
        ("viscosity", "Pa*s", 0.001, 0.1),
    ]:
        p_res = client.post(
            f"/api/v1/studies/{study_id}/parameters",
            json={
                "key": key,
                "label": key.capitalize(),
                "unit": unit,
                "kind": "continuous",
                "role": "controlled",
                "spec": {"min": lo, "max": hi, "levels": 3},
            },
        )
        assert p_res.status_code == 201

    client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "pressure_drop",
            "label": "Pressure Drop",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 5000.0},
        },
    )

    # 1. Test Buckingham Pi dimensional analysis (5 variables across 3 fundamental dimensions [M, L, T] -> 2 Pi groups)
    dim_res = client.get(f"/api/v1/studies/{study_id}/analyses/dimensional")
    assert dim_res.status_code == 200
    dim_body = dim_res.json()
    assert dim_body["total_variables"] == 5
    assert dim_body["dimensional_rank"] == 3
    assert dim_body["num_pi_groups"] == 2
    assert len(dim_body["pi_groups"]) == 2

    # 2. Generate candidates and select a batch of 5
    cset_res = client.post(f"/api/v1/studies/{study_id}/candidate-sets", json={"method": "lhs", "settings": {"n": 30}})
    assert cset_res.status_code == 201

    batch_res = client.post(
        f"/api/v1/studies/{study_id}/batches",
        json={"batch_size": 5, "strategy": "balanced"},
    )
    assert batch_res.status_code == 200
    b_body = batch_res.json()
    assert b_body["batch_size"] == 5
    assert len(b_body["items"]) == 5
    for item in b_body["items"]:
        assert item["voi_reason"]

    # Verify candidates listing shows 5 recommended candidates
    rec_res = client.get(f"/api/v1/studies/{study_id}/candidates?status=recommended&limit=20")
    assert rec_res.status_code == 200
    assert rec_res.json()["total"] == 5

