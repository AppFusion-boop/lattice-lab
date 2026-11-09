"""Tests for Custom Exact Test Cases Suite API and Runner."""

from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient


def test_test_case_crud_and_lifecycle(client: TestClient, db_conn: sqlite3.Connection):
    # 1. Create a study
    res_study = client.post(
        "/api/v1/studies",
        json={
            "name": "Friction Benchmark Study",
            "domain": "materials",
            "exclusion_threshold": 0.05,
            "confidence": 0.95,
        },
    )
    assert res_study.status_code == 201
    study_id = res_study.json()["id"]

    # 2. Add parameters
    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "contact_load",
            "label": "Contact Normal Load",
            "unit": "mN",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10.0, "max": 200.0},
        },
    )
    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "speed",
            "label": "Sliding Speed",
            "unit": "mm/s",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1.0, "max": 20.0},
        },
    )

    # 3. Add outcome
    client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "wear_depth",
            "label": "Final Wear Scar Depth",
            "unit": "um",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<=", "value": 5.0},
        },
    )

    # 4. Check initial empty summary
    res_summary = client.get(f"/api/v1/studies/{study_id}/test-cases/summary")
    assert res_summary.status_code == 200
    assert res_summary.json()["total_count"] == 0

    # 5. Create a custom test case
    res_tc = client.post(
        f"/api/v1/studies/{study_id}/test-cases",
        json={
            "name": "Severe Corner Load Case",
            "description": "Evaluate severe 180 mN load at 15 mm/s speed",
            "category": "corner_case",
            "parameters": {
                "contact_load": 180.0,
                "speed": 15.0,
            },
            "expected_outcomes": {
                "wear_depth": {"op": "<=", "value": 4.5},
            },
        },
    )
    assert res_tc.status_code == 201
    tc = res_tc.json()
    tc_id = tc["id"]
    assert tc["name"] == "Severe Corner Load Case"
    assert tc["category"] == "corner_case"
    assert tc["last_run_status"] == "untested"
    assert tc["parameters"]["contact_load"] == 180.0

    # 6. List test cases
    res_list = client.get(f"/api/v1/studies/{study_id}/test-cases")
    assert res_list.status_code == 200
    assert len(res_list.json()) == 1

    # 7. Update test case
    res_up = client.put(
        f"/api/v1/studies/{study_id}/test-cases/{tc_id}",
        json={"name": "Extreme Corner Case (Updated)"},
    )
    assert res_up.status_code == 200
    assert res_up.json()["name"] == "Extreme Corner Case (Updated)"

    # 8. Check summary has 1 untested test
    res_summary2 = client.get(f"/api/v1/studies/{study_id}/test-cases/summary")
    assert res_summary2.json()["total_count"] == 1
    assert res_summary2.json()["untested_count"] == 1

    # 9. Delete test case
    res_del = client.delete(f"/api/v1/studies/{study_id}/test-cases/{tc_id}")
    assert res_del.status_code == 204

    # Confirm deletion
    res_list2 = client.get(f"/api/v1/studies/{study_id}/test-cases")
    assert len(res_list2.json()) == 0


def test_test_case_runner_and_assertions(client: TestClient, db_conn: sqlite3.Connection):
    # Create study
    res_study = client.post(
        "/api/v1/studies",
        json={"name": "Microchannel Benchmark", "domain": "physics"},
    )
    study_id = res_study.json()["id"]

    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "flow_rate",
            "label": "Coolant Flow Rate",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10.0, "max": 100.0},
        },
    )
    client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "delta_temp",
            "label": "Thermal Drop",
            "kind": "continuous",
            "direction": "maximize",
            "criterion": {"op": ">=", "value": 15.0},
        },
    )

    # Save a model version with formula node
    model_payload = {
        "project": {
            "version": 3,
            "name": "Cooling Flow",
            "duration": 1,
            "sampleRate": 100,
            "nodes": [
                {
                    "id": "n_rate",
                    "kind": "formula",
                    "label": "Rate",
                    "position": {"x": 0, "y": 0},
                    "params": {"expression": "a * 0.4", "a": 50.0, "b": 0.0},
                }
            ],
            "edges": [],
            "tools": [],
        },
        "parameter_bindings": [
            {"parameter_key": "flow_rate", "node_id": "n_rate", "param_key": "a"}
        ],
        "outcome_bindings": [
            {"outcome_key": "delta_temp", "node_id": "n_rate", "port": "result", "reducer": "value"}
        ],
        "notes": "Thermal formula model",
    }
    res_model = client.post(f"/api/v1/studies/{study_id}/models", json=model_payload)
    assert res_model.status_code == 201

    # Test Case 1: Pass case (flow_rate = 50 -> delta_temp = 20 >= 15)
    res_tc1 = client.post(
        f"/api/v1/studies/{study_id}/test-cases",
        json={
            "name": "Standard Flow Rate",
            "category": "nominal",
            "parameters": {"flow_rate": 50.0},
            "expected_outcomes": {"delta_temp": {"op": ">=", "value": 18.0}},
        },
    )
    tc1_id = res_tc1.json()["id"]

    # Test Case 2: Fail case (flow_rate = 20 -> delta_temp = 8 < 15, expected >= 15)
    res_tc2 = client.post(
        f"/api/v1/studies/{study_id}/test-cases",
        json={
            "name": "Low Flow Stress Case",
            "category": "boundary",
            "parameters": {"flow_rate": 20.0},
            "expected_outcomes": {"delta_temp": {"op": ">=", "value": 15.0}},
        },
    )
    tc2_id = res_tc2.json()["id"]

    # Run single test 1
    run1 = client.post(f"/api/v1/studies/{study_id}/test-cases/{tc1_id}/run")
    assert run1.status_code == 200
    res1_data = run1.json()
    assert res1_data["status"] == "passed"
    assert res1_data["outcomes"]["delta_temp"] == 20.0
    assert res1_data["assertions"][0]["passed"] is True

    # Run single test 2
    run2 = client.post(f"/api/v1/studies/{study_id}/test-cases/{tc2_id}/run")
    assert run2.status_code == 200
    res2_data = run2.json()
    assert res2_data["status"] == "failed"
    assert res2_data["outcomes"]["delta_temp"] == 8.0
    assert res2_data["assertions"][0]["passed"] is False

    # Run All Test Cases (Suite)
    run_all = client.post(f"/api/v1/studies/{study_id}/test-cases/run-all")
    assert run_all.status_code == 200
    suite = run_all.json()
    assert suite["total_count"] == 2
    assert suite["passed_count"] == 1
    assert suite["failed_count"] == 1
    assert suite["duration_ms"] > 0

    # Verify Summary
    summary = client.get(f"/api/v1/studies/{study_id}/test-cases/summary").json()
    assert summary["total_count"] == 2
    assert summary["passed_count"] == 1
    assert summary["failed_count"] == 1
    assert summary["pass_rate_pct"] == 50.0
    assert summary["last_run_at"] is not None
