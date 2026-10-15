"""Unit and integration tests for Evidence store and Sources (Phase 2, P2-1)."""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from lattice_server import db


def _create_test_study(client: TestClient) -> str:
    res = client.post(
        "/api/v1/studies",
        json={"name": "Evidence Test Study", "domain": "tunnel"},
    )
    assert res.status_code == 201
    study_id = res.json()["id"]

    # Controlled parameter 'droplet' in um
    res = client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "droplet",
            "label": "Droplet diameter",
            "unit": "um",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10.0, "max": 1000.0},
        },
    )
    assert res.status_code == 201

    # Controlled parameter 'flow' in L/min
    res = client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "flow",
            "label": "Water flow rate",
            "unit": "L/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1.0, "max": 100.0},
        },
    )
    assert res.status_code == 201

    # Outcome 'peak_pressure' in Pa
    res = client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak overpressure",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 8000.0},
        },
    )
    assert res.status_code == 201

    return study_id


def test_sources_crud(client: TestClient) -> None:
    study_id = _create_test_study(client)

    # List empty sources
    res = client.get(f"/api/v1/studies/{study_id}/sources")
    assert res.status_code == 200
    assert res.json() == []

    # Create source
    res = client.post(
        f"/api/v1/studies/{study_id}/sources",
        json={
            "kind": "literature",
            "citation": "Smith et al. 2024 JFM",
            "doi": "10.1000/182",
            "notes": "Field trial data",
        },
    )
    assert res.status_code == 201
    src = res.json()
    assert src["id"].startswith("src_")
    assert src["citation"] == "Smith et al. 2024 JFM"
    assert src["doi"] == "10.1000/182"
    source_id = src["id"]

    # Get single source
    res = client.get(f"/api/v1/sources/{source_id}")
    assert res.status_code == 200
    assert res.json()["id"] == source_id

    # List sources
    res = client.get(f"/api/v1/studies/{study_id}/sources")
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_evidence_unit_conversion_and_validation(client: TestClient) -> None:
    study_id = _create_test_study(client)

    # 1. Missing controlled parameter -> 422
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {"droplet": 100.0},  # missing 'flow'
            "outcomes": {"peak_pressure": 6500.0},
            "status": "valid",
        },
    )
    assert res.status_code == 422
    assert "Missing required controlled parameter" in res.json()["detail"]["message"]

    # 2. Non-valid status requires status_reason -> 422
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {"droplet": 100.0, "flow": 50.0},
            "outcomes": {"peak_pressure": 6500.0},
            "status": "failed_run",
            # missing status_reason
        },
    )
    assert res.status_code == 422

    # 3. Successful creation with unit conversions
    # Parameter 'droplet': provide 0.5 mm -> should convert to 500 um
    # Outcome 'peak_pressure': provide 7.2 kPa -> should convert to 7200 Pa
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {
                "droplet": {"value": 0.5, "unit": "mm"},
                "flow": 25.0,
            },
            "outcomes": {
                "peak_pressure": {
                    "value": 7.2,
                    "unit": "kPa",
                    "sd": 0.1,
                }
            },
            "status": "valid",
            "notes": "Run with fine mist",
        },
    )
    assert res.status_code == 201
    evi = res.json()
    assert evi["id"].startswith("evi_")
    assert pytest.approx(evi["values"]["droplet"], rel=1e-5) == 500.0
    assert pytest.approx(evi["values"]["flow"], rel=1e-5) == 25.0

    out = evi["outcomes"]["peak_pressure"]
    assert pytest.approx(out["value"], rel=1e-5) == 7200.0
    assert out["original_value"] == 7.2
    assert out["original_unit"] == "kPa"
    assert pytest.approx(out["sd"], rel=1e-5) == 100.0

    # 4. Dimension mismatch -> 422
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {"droplet": 100.0, "flow": 50.0},
            "outcomes": {
                "peak_pressure": {"value": 5.0, "unit": "kg"}  # mass vs pressure
            },
            "status": "valid",
        },
    )
    assert res.status_code == 422
    assert "Cannot convert" in res.json()["detail"]["message"]


def test_evidence_retract_and_immutability(client: TestClient) -> None:
    study_id = _create_test_study(client)

    # Create evidence
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "field",
            "values": {"droplet": 200.0, "flow": 30.0},
            "outcomes": {"peak_pressure": 5000.0},
            "status": "valid",
        },
    )
    assert res.status_code == 201
    evi_id = res.json()["id"]

    # Test SQLite immutability trigger directly on the DB:
    # 1. DELETE trigger
    with pytest.raises(sqlite3.DatabaseError, match="evidence is immutable"), db.connect() as conn:
        conn.execute("DELETE FROM evidence WHERE id = ?", (evi_id,))

    # 2. UPDATE values_json trigger
    with pytest.raises(sqlite3.DatabaseError, match="evidence is immutable"), db.connect() as conn:
        conn.execute("UPDATE evidence SET values_json = '{}' WHERE id = ?", (evi_id,))

    # Retract via API
    res = client.post(
        f"/api/v1/evidence/{evi_id}/retract",
        json={"reason": "Sensor calibration drift detected"},
    )
    assert res.status_code == 200
    retracted = res.json()
    assert retracted["retracted_at"] is not None
    assert retracted["retraction_reason"] == "Sensor calibration drift detected"

    # Second retraction attempt -> 409 conflict
    res = client.post(
        f"/api/v1/evidence/{evi_id}/retract",
        json={"reason": "Another reason"},
    )
    assert res.status_code == 409


def test_evidence_supersede_chain(client: TestClient) -> None:
    study_id = _create_test_study(client)

    # Initial evidence
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {"droplet": 150.0, "flow": 20.0},
            "outcomes": {"peak_pressure": 6200.0},
            "status": "valid",
        },
    )
    assert res.status_code == 201
    old_id = res.json()["id"]

    # Supersede with corrected value
    res = client.post(
        f"/api/v1/evidence/{old_id}/supersede",
        json={
            "kind": "lab",
            "values": {"droplet": 150.0, "flow": 20.0},
            "outcomes": {"peak_pressure": 6150.0},
            "status": "valid",
            "notes": "Recalculated with baseline subtraction",
        },
    )
    assert res.status_code == 201
    new_evi = res.json()
    new_id = new_evi["id"]
    assert new_id != old_id
    assert new_evi["supersedes_id"] == old_id
    assert new_evi["retracted_at"] is None

    # Check old record is retracted with superseding reference
    res = client.get(f"/api/v1/evidence/{old_id}")
    assert res.status_code == 200
    old_evi = res.json()
    assert old_evi["retracted_at"] is not None
    assert f"superseded by {new_id}" in old_evi["retraction_reason"]

    # Cannot supersede already retracted evidence
    res = client.post(
        f"/api/v1/evidence/{old_id}/supersede",
        json={
            "kind": "lab",
            "values": {"droplet": 150.0, "flow": 20.0},
            "outcomes": {"peak_pressure": 6100.0},
            "status": "valid",
        },
    )
    assert res.status_code == 409


def test_evidence_listing_and_filters(client: TestClient) -> None:
    study_id = _create_test_study(client)

    # Create source
    src_res = client.post(
        f"/api/v1/studies/{study_id}/sources",
        json={"kind": "lab", "citation": "Lab notebook 1"},
    )
    source_id = src_res.json()["id"]

    # Create 3 records:
    # 1. valid lab evidence with source
    res1 = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "source_id": source_id,
            "values": {"droplet": 100.0, "flow": 10.0},
            "outcomes": {"peak_pressure": 6000.0},
            "status": "valid",
        },
    )
    id1 = res1.json()["id"]

    # 2. field outlier evidence
    res2 = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "field",
            "values": {"droplet": 200.0, "flow": 20.0},
            "outcomes": {"peak_pressure": 9000.0},
            "status": "outlier",
            "status_reason": "Gauge disconnected during blast",
        },
    )
    id2 = res2.json()["id"]

    # 3. simulation record that we will retract
    res3 = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "simulation",
            "values": {"droplet": 300.0, "flow": 30.0},
            "outcomes": {"peak_pressure": 4000.0},
            "status": "valid",
        },
    )
    id3 = res3.json()["id"]
    client.post(f"/api/v1/evidence/{id3}/retract", json={"reason": "Faulty mesh"})

    # By default, retracted evidence is excluded -> only 2 records
    res = client.get(f"/api/v1/studies/{study_id}/evidence")
    assert res.status_code == 200
    ids = [e["id"] for e in res.json()]
    assert id1 in ids
    assert id2 in ids
    assert id3 not in ids

    # include_retracted=true shows all 3
    res = client.get(f"/api/v1/studies/{study_id}/evidence?include_retracted=true")
    assert res.status_code == 200
    ids = [e["id"] for e in res.json()]
    assert len(ids) == 3
    assert id3 in ids

    # Filter by kind=lab
    res = client.get(f"/api/v1/studies/{study_id}/evidence?kind=lab")
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["id"] == id1

    # Filter by status=outlier
    res = client.get(f"/api/v1/studies/{study_id}/evidence?status=outlier")
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["id"] == id2

    # Filter by source_id
    res = client.get(f"/api/v1/studies/{study_id}/evidence?source_id={source_id}")
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["id"] == id1


def test_evidence_audit_trail(client: TestClient) -> None:
    study_id = _create_test_study(client)

    # Create evidence
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {"droplet": 100.0, "flow": 10.0},
            "outcomes": {"peak_pressure": 6000.0},
            "status": "valid",
        },
    )
    evi_id = res.json()["id"]

    # Retract it
    client.post(f"/api/v1/evidence/{evi_id}/retract", json={"reason": "Audit test"})

    # Check audit log directly
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM audit_log WHERE study_id = ? AND entity = 'evidence' ORDER BY id ASC",
            (study_id,),
        ).fetchall()
        actions = [r["action"] for r in rows]
        assert "create" in actions
        assert "retract" in actions
