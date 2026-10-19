import json

from fastapi.testclient import TestClient

from lattice_server import config


def test_model_version_crud_and_validation(client: TestClient):
    # 1. Create a study
    res = client.post(
        "/api/v1/studies",
        json={
            "name": "Tunnel Water Mist Study",
            "domain": "tunnel",
            "exclusion_threshold": 0.05,
            "confidence": 0.95,
        },
    )
    assert res.status_code == 201
    study_id = res.json()["id"]

    # 2. Add parameters matching the tunnel demo
    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "reduction",
            "label": "Pressure reduction",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 0, "max": 95},
        },
    )
    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "water_flow",
            "label": "Water flow",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1, "max": 100},
        },
    )
    p3 = client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "ambient_temp",
            "label": "Ambient temperature",
            "kind": "continuous",
            "role": "uncertain",
            "spec": {"min": 10, "max": 35},
        },
    )
    assert p3.status_code == 201

    # Add an outcome
    client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak pressure",
            "unit": "Pa",
            "kind": "continuous",
            "criterion": {"operator": "<", "threshold": 10000},
        },
    )

    # 3. Load tunnel demo project
    demo_path = config.REPO_ROOT / "public/demos/tunnel-methane-water.json"
    project = json.loads(demo_path.read_text("utf-8"))

    # 4. Attempt creation with missing binding for ambient_temp (uncertain)
    bad_res = client.post(
        f"/api/v1/studies/{study_id}/models",
        json={
            "project": project,
            "parameter_bindings": [
                {
                    "parameter_key": "reduction",
                    "node_id": "water",
                    "param_key": "reduction",
                    "not_in_model": False,
                },
                {
                    "parameter_key": "water_flow",
                    "node_id": "water",
                    "param_key": "flow",
                    "not_in_model": False,
                },
            ],
            "outcome_bindings": [
                {
                    "outcome_key": "peak_pressure",
                    "node_id": "mist",
                    "port": "sensor:probe",
                    "reducer": "maxAbs",
                }
            ],
            "notes": "Incomplete model",
        },
    )
    assert bad_res.status_code == 422
    assert "missing_parameter_binding" in bad_res.json()["detail"]["code"]

    # 5. Create valid model version marking ambient_temp as not_in_model
    create_res = client.post(
        f"/api/v1/studies/{study_id}/models",
        json={
            "project": project,
            "parameter_bindings": [
                {
                    "parameter_key": "reduction",
                    "node_id": "water",
                    "param_key": "reduction",
                    "not_in_model": False,
                },
                {
                    "parameter_key": "water_flow",
                    "node_id": "water",
                    "param_key": "flow",
                    "not_in_model": False,
                },
                {
                    "parameter_key": "ambient_temp",
                    "not_in_model": True,
                },
            ],
            "outcome_bindings": [
                {
                    "outcome_key": "peak_pressure",
                    "node_id": "mist",
                    "port": "sensor:probe",
                    "reducer": "maxAbs",
                }
            ],
            "notes": "Initial validated flow model",
        },
    )
    assert create_res.status_code == 201
    mv = create_res.json()
    assert mv["version"] == 1
    assert mv["validation_status"] == "unvalidated"
    assert mv["signature"] is not None
    assert "2.2.0" in (mv["engine_version"] or "")
    model_id = mv["id"]

    # 6. Retrieve versions
    list_res = client.get(f"/api/v1/studies/{study_id}/models")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1
    assert list_res.json()[0]["id"] == model_id

    latest_res = client.get(f"/api/v1/studies/{study_id}/models/latest")
    assert latest_res.status_code == 200
    assert latest_res.json()["id"] == model_id

    single_res = client.get(f"/api/v1/models/{model_id}")
    assert single_res.status_code == 200
    assert single_res.json()["id"] == model_id
