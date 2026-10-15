"""Tests for Evidence matching and tested_* screening decisions (Phase 2, P2-2)."""

from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from lattice_server.screening.pipeline import run_screening_pipeline


def _setup_test_study(client: TestClient) -> tuple[str, str]:
    # 1. Create study
    res = client.post(
        "/api/v1/studies",
        json={"name": "Evidence Matching Study", "domain": "tunnel"},
    )
    assert res.status_code == 201
    study_id = res.json()["id"]

    # 2. Add controlled parameter 'droplet' (continuous)
    res = client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "droplet",
            "label": "Droplet size",
            "unit": "um",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 50.0, "max": 200.0, "levels": 4},  # 50, 100, 150, 200
        },
    )
    assert res.status_code == 201

    # 3. Add controlled parameter 'nozzles' (integer)
    res = client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "nozzles",
            "label": "Number of nozzles",
            "unit": "",
            "kind": "integer",
            "role": "controlled",
            "spec": {"min": 1, "max": 2, "step": 1},  # 1, 2
        },
    )
    assert res.status_code == 201

    # 4. Add outcome 'peak_pressure' (< 7000 is pass)
    res = client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak overpressure",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 7000.0},
        },
    )
    assert res.status_code == 201

    # 5. Add hard constraint: nozzles <= 1 (so nozzles == 2 is normally excluded)
    res = client.post(
        f"/api/v1/studies/{study_id}/constraints",
        json={
            "label": "Single nozzle limit",
            "expression": "nozzles <= 1",
            "kind": "hard",
            "rationale": "Testing constraint vs evidence precedence",
        },
    )
    assert res.status_code == 201

    # 6. Generate candidate grid: 4 x 2 = 8 candidates
    res = client.post(
        f"/api/v1/studies/{study_id}/candidate-sets",
        json={"method": "grid"},
    )
    assert res.status_code == 201
    cset_id = res.json()["id"]

    return study_id, cset_id


def test_replicate_majority_logic(client: TestClient, db_conn: sqlite3.Connection) -> None:
    study_id, _ = _setup_test_study(client)

    # Candidate 1: droplet=100.0, nozzles=1
    # Add 3 replicates: 2 pass (< 7000), 1 fail (>= 7000) -> should be tested_pass
    for p_val in [6200.0, 6800.0, 7500.0]:
        res = client.post(
            f"/api/v1/studies/{study_id}/evidence",
            json={
                "kind": "lab",
                "values": {"droplet": 100.0, "nozzles": 1},
                "outcomes": {"peak_pressure": p_val},
                "status": "valid",
            },
        )
        assert res.status_code == 201

    # Candidate 2: droplet=150.0, nozzles=1
    # Add 3 replicates: 1 pass, 2 fail -> should be tested_fail
    for p_val in [6500.0, 7200.0, 8000.0]:
        res = client.post(
            f"/api/v1/studies/{study_id}/evidence",
            json={
                "kind": "lab",
                "values": {"droplet": 150.0, "nozzles": 1},
                "outcomes": {"peak_pressure": p_val},
                "status": "valid",
            },
        )
        assert res.status_code == 201

    # Candidate 3: droplet=50.0, nozzles=1
    # Add 2 replicates: 1 pass, 1 fail (tie) -> strictly not majority -> should be tested_fail
    for p_val in [6500.0, 7500.0]:
        res = client.post(
            f"/api/v1/studies/{study_id}/evidence",
            json={
                "kind": "lab",
                "values": {"droplet": 50.0, "nozzles": 1},
                "outcomes": {"peak_pressure": p_val},
                "status": "valid",
            },
        )
        assert res.status_code == 201

    # Run screening
    run_screening_pipeline(conn=db_conn, study_id=study_id)

    # Get candidates
    cands_res = client.get(f"/api/v1/studies/{study_id}/candidates?limit=20")
    assert cands_res.status_code == 200
    items = cands_res.json()["items"]

    # Locate the 3 candidates by values
    cand_100_1 = next(c for c in items if c["values"]["droplet"] == 100.0 and c["values"]["nozzles"] == 1)
    cand_150_1 = next(c for c in items if c["values"]["droplet"] == 150.0 and c["values"]["nozzles"] == 1)
    cand_50_1 = next(c for c in items if c["values"]["droplet"] == 50.0 and c["values"]["nozzles"] == 1)

    assert cand_100_1["decision"]["status"] == "tested_pass"
    assert cand_100_1["decision"]["filter"] == "evidence_match"
    assert "2/3 replicates passed" in cand_100_1["decision"]["reason"]

    assert cand_150_1["decision"]["status"] == "tested_fail"
    assert cand_150_1["decision"]["filter"] == "evidence_match"
    assert "2/3 replicates failed" in cand_150_1["decision"]["reason"]

    assert cand_50_1["decision"]["status"] == "tested_fail"
    assert cand_50_1["decision"]["filter"] == "evidence_match"
    assert "1/2 replicates failed" in cand_50_1["decision"]["reason"]


def test_failed_run_evidence_separation(client: TestClient, db_conn: sqlite3.Connection) -> None:
    study_id, _ = _setup_test_study(client)

    # Candidate: droplet=100.0, nozzles=1
    # 1 valid pass + 1 failed_run -> valid is 1/1 pass -> tested_pass, failed_runs counted in details
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {"droplet": 100.0, "nozzles": 1},
            "outcomes": {"peak_pressure": 6000.0},
            "status": "valid",
        },
    )
    assert res.status_code == 201

    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {"droplet": 100.0, "nozzles": 1},
            "outcomes": {"peak_pressure": 0.0},
            "status": "failed_run",
            "status_reason": "Nozzle clogged before blast",
        },
    )
    assert res.status_code == 201

    # Candidate: droplet=200.0, nozzles=1
    # ONLY failed_run -> no valid records -> should NOT be tested_* (falls through to open)
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {"droplet": 200.0, "nozzles": 1},
            "outcomes": {"peak_pressure": 0.0},
            "status": "failed_run",
            "status_reason": "Sensor wire cut",
        },
    )
    assert res.status_code == 201

    # Run screening
    run_screening_pipeline(conn=db_conn, study_id=study_id)

    cands_res = client.get(f"/api/v1/studies/{study_id}/candidates?limit=20")
    items = cands_res.json()["items"]

    cand_100_1 = next(c for c in items if c["values"]["droplet"] == 100.0 and c["values"]["nozzles"] == 1)
    cand_200_1 = next(c for c in items if c["values"]["droplet"] == 200.0 and c["values"]["nozzles"] == 1)

    assert cand_100_1["decision"]["status"] == "tested_pass"
    assert cand_100_1["decision"]["filter"] == "evidence_match"
    assert "1/1 replicates passed" in cand_100_1["decision"]["reason"]

    # cand_200_1 had only failed_run -> not tested_*, passed constraint nozzles<=1 -> status is open
    assert cand_200_1["decision"]["status"] == "open"
    assert cand_200_1["decision"]["filter"] != "evidence_match"


def test_continuous_tolerance_matching(client: TestClient, db_conn: sqlite3.Connection) -> None:
    study_id, _ = _setup_test_study(client)

    # Candidate has droplet=100.0, nozzles=1
    # Record 1: droplet=100.00003 (rel diff 3e-7 < 1e-6) -> should match!
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": {"droplet": 100.00003, "nozzles": 1},
            "outcomes": {"peak_pressure": 6200.0},
            "status": "valid",
        },
    )
    assert res.status_code == 201

    # Run screening
    run_screening_pipeline(conn=db_conn, study_id=study_id)

    cands_res = client.get(f"/api/v1/studies/{study_id}/candidates?limit=20")
    items = cands_res.json()["items"]
    cand_100_1 = next(c for c in items if c["values"]["droplet"] == 100.0 and c["values"]["nozzles"] == 1)

    assert cand_100_1["decision"]["status"] == "tested_pass"
    assert cand_100_1["decision"]["filter"] == "evidence_match"


def test_precedence_over_constraints_and_overrides(client: TestClient, db_conn: sqlite3.Connection) -> None:
    study_id, _ = _setup_test_study(client)

    # Candidate with nozzles=2 violates hard constraint "nozzles <= 1"
    # But real physical test shows it passes!
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "field",
            "values": {"droplet": 100.0, "nozzles": 2},
            "outcomes": {"peak_pressure": 5500.0},
            "status": "valid",
        },
    )
    assert res.status_code == 201

    # Candidate with droplet=50.0, nozzles=2 also has evidence passing
    res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "field",
            "values": {"droplet": 50.0, "nozzles": 2},
            "outcomes": {"peak_pressure": 5500.0},
            "status": "valid",
        },
    )
    assert res.status_code == 201

    # But add a human override on droplet=50.0, nozzles=2 marking it excluded
    cands_pre = client.get(f"/api/v1/studies/{study_id}/candidates?limit=20").json()["items"]
    cand_50_2 = next(c for c in cands_pre if c["values"]["droplet"] == 50.0 and c["values"]["nozzles"] == 2)
    client.post(
        f"/api/v1/studies/{study_id}/overrides",
        json={
            "values_hash": cand_50_2["values_hash"],
            "status": "excluded",
            "reason": "Expert override: nozzle model banned on safety grounds",
        },
    )

    # Run screening
    run_screening_pipeline(conn=db_conn, study_id=study_id)

    cands_res = client.get(f"/api/v1/studies/{study_id}/candidates?limit=20")
    items = cands_res.json()["items"]

    # 1. Evidence beats constraint:
    cand_100_2 = next(c for c in items if c["values"]["droplet"] == 100.0 and c["values"]["nozzles"] == 2)
    assert cand_100_2["decision"]["status"] == "tested_pass"
    assert cand_100_2["decision"]["filter"] == "evidence_match"

    # 2. Override beats evidence:
    cand_50_2_post = next(c for c in items if c["values"]["droplet"] == 50.0 and c["values"]["nozzles"] == 2)
    assert cand_50_2_post["decision"]["status"] == "excluded"
    assert cand_50_2_post["decision"]["filter"] == "override"
