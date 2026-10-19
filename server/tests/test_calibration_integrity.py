"""Tests for T1-1: Calibration scientific integrity (no fake data, parameter apply, unvalidated status)."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from lattice_server import config


def test_calibration_rejects_missing_evidence_and_applies_parameter_cleanly(client: TestClient) -> None:
    # 1. Create study, parameters, outcome, and model version using tunnel demo
    s_res = client.post("/api/v1/studies", json={"name": "Calibration Integrity Study", "rng_seed": 42})
    assert s_res.status_code == 201
    study_id = s_res.json()["id"]

    p1 = client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "water_flow",
            "label": "Water Flow",
            "unit": "L/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10.0, "max": 80.0, "levels": 5},
        },
    )
    assert p1.status_code == 201

    p2 = client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "reduction",
            "label": "Mist Reduction %",
            "unit": "%",
            "kind": "continuous",
            "role": "fixed",
            "spec": {"min": 0.0, "max": 95.0, "value": 20.0},
        },
    )
    assert p2.status_code == 201

    o1 = client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak Pressure",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 8000.0},
        },
    )
    assert o1.status_code == 201

    demo_path = config.REPO_ROOT / "public/demos/tunnel-methane-water.json"
    project = json.loads(demo_path.read_text("utf-8"))

    m_res = client.post(
        f"/api/v1/studies/{study_id}/models",
        json={
            "project": project,
            "parameter_bindings": [
                {"parameter_key": "water_flow", "node_id": "water", "param_key": "flow"},
                {"parameter_key": "reduction", "node_id": "water", "param_key": "reduction"},
            ],
            "outcome_bindings": [
                {"outcome_key": "peak_pressure", "node_id": "mist", "port": "sensor:probe", "reducer": "maxAbs"},
            ],
            "notes": "Initial model with reduction = 20%",
        },
    )
    assert m_res.status_code == 201

    # 2. Attempt calibration with 0 evidence points -> MUST fail with 422 insufficient_evidence (Hard Rule 1)
    cal_empty = client.post(
        f"/api/v1/studies/{study_id}/calibrate",
        json={
            "parameter_key": "reduction",
            "target_outcome": "peak_pressure",
            "initial_guess": 20.0,
            "param_bounds": [0.0, 95.0],
        },
    )
    assert cal_empty.status_code == 422
    assert cal_empty.json()["detail"]["code"] == "insufficient_evidence"

    # 3. Add 3 real physical evidence rows
    for flow_val, meas_p in [(20.0, 4200.0), (40.0, 4200.0), (60.0, 4200.0)]:
        ev_res = client.post(
            f"/api/v1/studies/{study_id}/evidence",
            json={
                "kind": "lab",
                "values": {"water_flow": flow_val},
                "outcomes": {"peak_pressure": meas_p},
                "status": "valid",
            },
        )
        assert ev_res.status_code == 201

    # 4. Run calibration with real evidence -> should converge and reduce RMSE
    cal_ok = client.post(
        f"/api/v1/studies/{study_id}/calibrate",
        json={
            "parameter_key": "reduction",
            "target_outcome": "peak_pressure",
            "initial_guess": 10.0,
            "param_bounds": [0.0, 95.0],
        },
    )
    assert cal_ok.status_code == 200
    body = cal_ok.json()
    assert body["n_evidence_points"] == 3
    assert body["calibrated_rmse"] <= body["prior_rmse"]

    # 5. Apply calibration -> verify new ModelVersion has water.params.reduction == calibrated_value
    #    AND validation_status == 'unvalidated' (Hard Rule 6)
    apply_res = client.post(
        f"/api/v1/studies/{study_id}/calibrate/apply",
        json={
            "parameter_key": "reduction",
            "calibrated_value": body["calibrated_value"],
        },
    )
    assert apply_res.status_code == 201
    new_mv = apply_res.json()
    assert new_mv["version"] == 2
    assert new_mv["validation_status"] == "unvalidated"

    water_node = next(n for n in new_mv["project"]["nodes"] if n["id"] == "water")
    assert abs(water_node["params"]["reduction"] - body["calibrated_value"]) < 1e-6
