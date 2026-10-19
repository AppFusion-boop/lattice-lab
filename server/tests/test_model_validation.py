"""Tests for T3-2: Model validation against evidence, human sign-off, and stale fingerprint invalidation."""

from __future__ import annotations

import json
import sqlite3
from unittest.mock import patch

from fastapi.testclient import TestClient

from lattice_server import config
from lattice_server.engine.bridge import RowResult
from lattice_server.screening.pipeline import run_screening_pipeline


def test_model_validation_human_acceptance_and_stale_invalidation(
    client: TestClient,
    db_conn: sqlite3.Connection,
) -> None:
    # 1. Create study with 1 controlled parameter and 1 outcome
    s_res = client.post("/api/v1/studies", json={"name": "Model Validation Study", "rng_seed": 42})
    assert s_res.status_code == 201
    study_id = s_res.json()["id"]

    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "water_flow",
            "label": "Water Flow",
            "unit": "L/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10.0, "max": 80.0, "values": [10.0, 80.0]},
        },
    )
    client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak Pressure",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 5000.0},
        },
    )

    demo_path = config.REPO_ROOT / "public/demos/tunnel-methane-water.json"
    project = json.loads(demo_path.read_text("utf-8"))

    # Mock engine evaluate so pressure = 10000 - 100 * water_flow
    def fake_evaluate(project, param_bindings, outcome_bindings, rows, **kwargs):
        out = []
        for r in rows:
            flow = float(r["values"].get("water_flow", 45.0))
            p = 10000.0 - 100.0 * flow
            out.append(RowResult(id=r["id"], status="ok", outcomes={"peak_pressure": p}))
        return out

    with patch("lattice_server.engine.bridge.evaluate", side_effect=fake_evaluate):
        m_res = client.post(
            f"/api/v1/studies/{study_id}/models",
            json={
                "project": project,
                "parameter_bindings": [
                    {"parameter_key": "water_flow", "node_id": "water", "param_key": "flow"},
                ],
                "outcome_bindings": [
                    {"outcome_key": "peak_pressure", "node_id": "mist", "port": "sensor:probe", "reducer": "maxAbs"},
                ],
                "notes": "Test validation model",
            },
        )
        assert m_res.status_code == 201
        model_id = m_res.json()["id"]

        # 2. Add 5 valid evidence points matching model predictions within 2%
        for flow_v in [20.0, 30.0, 40.0, 50.0, 60.0]:
            true_p = (10000.0 - 100.0 * flow_v) * 1.01
            ev_res = client.post(
                f"/api/v1/studies/{study_id}/evidence",
                json={
                    "kind": "lab",
                    "values": {"water_flow": flow_v},
                    "outcomes": {"peak_pressure": true_p},
                    "status": "valid",
                },
            )
            assert ev_res.status_code == 201

        # 3. Validate model -> coverage should be 1.0 >= 0.80, eligible_for_acceptance=True,
        #    but status MUST remain 'unvalidated' until human acceptance (Hard Rule 6)
        val_res = client.post(f"/api/v1/studies/{study_id}/models/{model_id}/validate", json={"n_draws": 20})
        assert val_res.status_code == 200
        val_body = val_res.json()
        assert val_body["n_evidence_rows"] == 5
        assert val_body["empirical_coverage_90"] >= 0.80
        assert val_body["eligible_for_acceptance"] is True
        assert val_body["validation_status"] == "unvalidated"

        # 4. Human accepts validation -> status becomes 'validated'
        acc_res = client.post(
            f"/api/v1/models/{model_id}/accept-validation",
            json={"reason": "90% prediction interval covers 100% of 5 bench runs"},
        )
        assert acc_res.status_code == 200
        assert acc_res.json()["validation_status"] == "validated"

        # 5. Generate 2 candidates: water_flow=10 (p=9000 >= 5000 -> fails) and water_flow=80 (p=2000 < 5000 -> passes)
        client.post(f"/api/v1/studies/{study_id}/candidate-sets", json={"method": "grid", "settings": {}})
        run1 = run_screening_pipeline(conn=db_conn, study_id=study_id)
        # With validated model and matching evidence fingerprint, water_flow=10 is excluded!
        assert run1.summary.counts_by_status.get("excluded", 0) == 1
        assert run1.summary.counts_by_status.get("open", 0) == 1

        # 6. Record a 6th evidence point -> evidence_fingerprint changes!
        client.post(
            f"/api/v1/studies/{study_id}/evidence",
            json={
                "kind": "lab",
                "values": {"water_flow": 70.0},
                "outcomes": {"peak_pressure": 3000.0},
                "status": "valid",
            },
        )

        # 7. Re-run screening without re-validating -> stale fingerprint downgrades model to 'unvalidated',
        #    so water_flow=10 is now deprioritised instead of excluded!
        run2 = run_screening_pipeline(conn=db_conn, study_id=study_id)
        assert run2.summary.counts_by_status.get("excluded", 0) == 0
        assert run2.summary.counts_by_status.get("deprioritised", 0) == 1


def test_unit_conversion_and_incompatible_units_rejection(client: TestClient) -> None:
    s_res = client.post("/api/v1/studies", json={"name": "Unit Conversion Study", "rng_seed": 42})
    study_id = s_res.json()["id"]

    # Parameter in mm (0.1 mm = 100 um)
    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "droplet_mm",
            "label": "Droplet Size",
            "unit": "mm",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 0.05, "max": 0.15},
        },
    )
    client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak Pressure",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 5000.0},
        },
    )

    demo_path = config.REPO_ROOT / "public/demos/tunnel-methane-water.json"
    project = json.loads(demo_path.read_text("utf-8"))

    # 1. Binding mm parameter to s (seconds) field must be rejected with 422 incompatible_units
    bad_res = client.post(
        f"/api/v1/studies/{study_id}/models",
        json={
            "project": project,
            "parameter_bindings": [
                {
                    "parameter_key": "droplet_mm",
                    "node_id": "water",
                    "param_key": "droplet",
                    "param_unit": "mm",
                    "field_unit": "s",
                }
            ],
            "outcome_bindings": [
                {"outcome_key": "peak_pressure", "node_id": "mist", "port": "sensor:probe", "reducer": "maxAbs"}
            ],
            "notes": "Incompatible units",
        },
    )
    assert bad_res.status_code == 422
    assert bad_res.json()["detail"]["code"] == "incompatible_units"

    # 2. Binding mm parameter (nominal = 0.1 mm) to um field converts 0.1 mm -> 100.0 um in bridge.evaluate
    captured_rows: list[dict] = []

    def fake_chunk(_cmd, _header, chunk_rows, _timeout, _cancelled=None):
        captured_rows.extend(chunk_rows)
        return [RowResult(id=r["id"], status="ok", outcomes={"peak_pressure": 3200.0}) for r in chunk_rows]

    with patch("lattice_server.engine.bridge._run_single_chunk", side_effect=fake_chunk):
        ok_res = client.post(
            f"/api/v1/studies/{study_id}/models",
            json={
                "project": project,
                "parameter_bindings": [
                    {
                        "parameter_key": "droplet_mm",
                        "node_id": "water",
                        "param_key": "droplet",
                        "param_unit": "mm",
                        "field_unit": "um",
                    }
                ],
                "outcome_bindings": [
                    {"outcome_key": "peak_pressure", "node_id": "mist", "port": "sensor:probe", "reducer": "maxAbs"}
                ],
                "notes": "Compatible units mm -> um",
            },
        )
        assert ok_res.status_code == 201
        assert len(captured_rows) == 1
        # 0.1 mm converted to 100.0 um!
        assert abs(float(captured_rows[0]["values"]["droplet_mm"]) - 100.0) < 1e-6

