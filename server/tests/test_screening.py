"""Tests for Screening Pipeline v1 (§4.5): constraints, overrides, and error flags."""

from __future__ import annotations

import sqlite3
import time

from fastapi.testclient import TestClient

from lattice_server.screening.pipeline import run_screening_pipeline


def test_screening_synthetic_10x10_grid(client: TestClient, db_conn: sqlite3.Connection) -> None:
    """Synthetic study with 2 params and constraint x + y <= 1 on a 10x10 grid.

    x in {0.1..1.0}, y in {0.1..1.0} -> 100 candidates.
    Pairs with x + y <= 1:
      x=0.1: y in 0.1..0.9 (9)
      x=0.2: y in 0.1..0.8 (8)
      ...
      x=0.9: y in 0.1..0.1 (1)
      Total = 45 satisfy, 55 violate.
    """
    # 1. Create study
    res_study = client.post(
        "/api/v1/studies",
        json={"name": "Screening Grid Test", "domain": "physics"},
    )
    assert res_study.status_code == 201
    sid = res_study.json()["id"]

    # 2. Add controlled continuous parameters x and y
    levels_10 = [round(i * 0.1, 1) for i in range(1, 11)]
    for key in ["x", "y"]:
        res_p = client.post(
            f"/api/v1/studies/{sid}/parameters",
            json={
                "key": key,
                "label": key.upper(),
                "unit": "m",
                "kind": "continuous",
                "role": "controlled",
                "spec": {"min": 0.1, "max": 1.0, "values": levels_10},
            },
        )
        assert res_p.status_code == 201

    # 3. Add hard constraint x + y <= 1
    res_c = client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={
            "expression": "x + y <= 1",
            "kind": "hard",
            "rationale": "Sum must not exceed unit length",
        },
    )
    assert res_c.status_code == 201

    # 4. Generate 10x10 grid candidates
    res_gen = client.post(
        f"/api/v1/studies/{sid}/candidate-sets",
        json={"method": "grid", "settings": {}},
    )
    assert res_gen.status_code == 201
    cset = res_gen.json()
    assert cset["count"] == 100

    # 5. Run screening pipeline directly
    screening_run = run_screening_pipeline(conn=db_conn, study_id=sid)

    assert screening_run.summary.total_candidates == 100
    assert screening_run.summary.funnel.total == 100
    # Exactly 55 excluded by x + y <= 1, 45 remaining
    assert screening_run.summary.counts_by_status.get("excluded", 0) == 55
    assert screening_run.summary.counts_by_status.get("open", 0) == 45
    assert screening_run.summary.funnel.after_constraints == 45
    assert screening_run.summary.funnel.after_statistical == 45
    assert screening_run.summary.funnel.after_deprioritised == 45
    assert screening_run.summary.funnel.recommended == 0

    # 6. Verify candidates listing joins latest decisions
    res_open = client.get(f"/api/v1/studies/{sid}/candidates?status=open&limit=100")
    assert res_open.status_code == 200
    assert res_open.json()["total"] == 45
    for item in res_open.json()["items"]:
        assert item["decision"] is not None
        assert item["decision"]["status"] == "open"
        assert item["decision"]["filter"] == "none"

    res_excl = client.get(f"/api/v1/studies/{sid}/candidates?status=excluded&limit=100")
    assert res_excl.status_code == 200
    assert res_excl.json()["total"] == 55
    for item in res_excl.json()["items"]:
        assert item["decision"] is not None
        assert item["decision"]["status"] == "excluded"
        assert item["decision"]["filter"] == "constraint"
        assert "Violates hard constraint" in item["decision"]["reason"]


def test_override_beats_constraint_and_revoke(client: TestClient, db_conn: sqlite3.Connection) -> None:
    """Override takes precedence over hard constraint exclusion, and revoking restores exclusion."""
    res_study = client.post(
        "/api/v1/studies",
        json={"name": "Override Precedence Test", "domain": "physics"},
    )
    sid = res_study.json()["id"]

    for key in ["x", "y"]:
        client.post(
            f"/api/v1/studies/{sid}/parameters",
            json={
                "key": key,
                "label": key,
                "unit": "m",
                "kind": "continuous",
                "role": "controlled",
                "spec": {"min": 0.1, "max": 1.0, "values": [0.2, 0.9]},
            },
        )

    # 2x2 grid: (0.2, 0.2), (0.2, 0.9), (0.9, 0.2), (0.9, 0.9)
    # With x + y <= 1:
    # (0.2, 0.2) -> 0.4 <= 1 (pass)
    # (0.2, 0.9) -> 1.1 > 1 (fail)
    # (0.9, 0.2) -> 1.1 > 1 (fail)
    # (0.9, 0.9) -> 1.8 > 1 (fail)
    client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={"expression": "x + y <= 1", "kind": "hard", "rationale": "limit"},
    )
    client.post(f"/api/v1/studies/{sid}/candidate-sets", json={"method": "grid", "settings": {}})

    # Get one failing candidate (0.9, 0.9)
    cand_resp = client.get(f"/api/v1/studies/{sid}/candidates?limit=10")
    all_cands = cand_resp.json()["items"]
    cand_fail = next(c for c in all_cands if c["values"]["x"] == 0.9 and c["values"]["y"] == 0.9)

    # Create override: pin it as "recommended"
    res_ovr = client.post(
        f"/api/v1/studies/{sid}/overrides",
        json={
            "values_hash": cand_fail["values_hash"],
            "status": "recommended",
            "reason": "Expert manual exemption for high-yield edge case",
        },
    )
    assert res_ovr.status_code == 201
    ovr_id = res_ovr.json()["id"]

    # Run screening
    run1 = run_screening_pipeline(conn=db_conn, study_id=sid)
    # 4 candidates: 1 pass (open), 2 fail (excluded), 1 override (recommended)
    assert run1.summary.counts_by_status.get("open", 0) == 1
    assert run1.summary.counts_by_status.get("excluded", 0) == 2
    assert run1.summary.counts_by_status.get("recommended", 0) == 1
    assert run1.summary.counts_by_filter.get("override", 0) == 1

    # Revoke override
    res_rev = client.post(f"/api/v1/overrides/{ovr_id}/revoke")
    assert res_rev.status_code == 200
    assert res_rev.json()["revoked_at"] is not None

    # Re-run screening: the candidate is now excluded again
    run2 = run_screening_pipeline(conn=db_conn, study_id=sid)
    assert run2.summary.counts_by_status.get("open", 0) == 1
    assert run2.summary.counts_by_status.get("excluded", 0) == 3
    assert run2.summary.counts_by_status.get("recommended", 0) == 0


def test_constraint_error_open_flag(client: TestClient, db_conn: sqlite3.Connection) -> None:
    """Non-finite expression result marks candidate as open with constraint_error (never silently excluded)."""
    res_study = client.post(
        "/api/v1/studies",
        json={"name": "Constraint Error Test", "domain": "physics"},
    )
    sid = res_study.json()["id"]

    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "x",
            "label": "X",
            "unit": "",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 0.0, "max": 2.0, "values": [0.0, 1.0, 2.0]},
        },
    )

    # 1 / x > 0 produces division by zero for x = 0.0
    client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={"expression": "1 / x > 0", "kind": "hard", "rationale": "positive inverted"},
    )
    client.post(f"/api/v1/studies/{sid}/candidate-sets", json={"method": "grid", "settings": {}})

    run = run_screening_pipeline(conn=db_conn, study_id=sid)
    assert run.summary.total_candidates == 3
    # x=1.0 and x=2.0 satisfy 1/x > 0 -> open
    # x=0.0 causes division by zero -> open with constraint_error
    assert run.summary.counts_by_status.get("open", 0) == 3
    assert run.summary.counts_by_filter.get("constraint_error", 0) == 1
    assert run.summary.counts_by_filter.get("none", 0) == 2

    # Check candidate list
    res_cands = client.get(f"/api/v1/studies/{sid}/candidates?limit=10")
    cands = res_cands.json()["items"]
    cand_zero = next(c for c in cands if c["values"]["x"] == 0.0)
    assert cand_zero["decision"]["status"] == "open"
    assert cand_zero["decision"]["filter"] == "constraint_error"
    assert "calculation error" in cand_zero["decision"]["reason"]


def test_screening_async_job_and_latest_endpoint(client: TestClient, db_conn: sqlite3.Connection) -> None:
    """Test POST /studies/{id}/screening-runs returns background job, and GET .../latest returns summary."""
    res_study = client.post(
        "/api/v1/studies",
        json={"name": "Async Screening Test", "domain": "chemistry"},
    )
    sid = res_study.json()["id"]

    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "conc",
            "label": "Concentration",
            "unit": "mol/L",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1.0, "max": 5.0, "levels": 5},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={"expression": "conc <= 3.0", "kind": "hard", "rationale": "Safety concentration ceiling"},
    )
    client.post(f"/api/v1/studies/{sid}/candidate-sets", json={"method": "grid", "settings": {}})

    # Start screening run via API
    res_start = client.post(f"/api/v1/studies/{sid}/screening-runs", json={"settings": {}})
    assert res_start.status_code == 202
    job = res_start.json()
    assert job["kind"] == "screening"
    job_id = job["id"]

    # Poll job until done
    for _ in range(50):
        res_job = client.get(f"/api/v1/jobs/{job_id}")
        assert res_job.status_code == 200
        if res_job.json()["status"] == "done":
            break
        time.sleep(0.05)

    assert res_job.json()["status"] == "done"

    # Query latest screening run
    res_latest = client.get(f"/api/v1/studies/{sid}/screening-runs/latest")
    assert res_latest.status_code == 200
    run_data = res_latest.json()
    assert run_data["study_id"] == sid
    assert run_data["summary"]["total_candidates"] == 5
    assert run_data["summary"]["counts_by_status"]["open"] == 3
    assert run_data["summary"]["counts_by_status"]["excluded"] == 2


def test_t1_3_uncertain_hard_constraint_soft_penalty_and_replicates(
    client: TestClient, db_conn: sqlite3.Connection
) -> None:
    res_study = client.post("/api/v1/studies", json={"name": "T1-3 Test", "domain": "physics"})
    sid = res_study.json()["id"]

    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "x",
            "label": "X",
            "unit": "m",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 0.0, "max": 10.0, "values": [2.0, 8.0]},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "u",
            "label": "Uncertain Temp",
            "unit": "K",
            "kind": "continuous",
            "role": "uncertain",
            "spec": {"min": 280.0, "max": 320.0},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/outcomes",
        json={
            "key": "yield",
            "label": "Yield",
            "unit": "%",
            "kind": "continuous",
            "direction": "maximize",
            "criterion": {"op": ">=", "value": 80.0},
        },
    )

    # 1. Hard constraint referencing uncertain parameter 'u' must fail with 422 uncertain_in_hard_constraint
    res_bad = client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={"expression": "x + u <= 300", "kind": "hard", "rationale": "invalid uncertain"},
    )
    assert res_bad.status_code == 422
    assert res_bad.json()["detail"]["code"] == "uncertain_in_hard_constraint"

    # 2. Soft constraint with penalty=4.5
    res_soft = client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={"expression": "x <= 5.0", "kind": "soft", "penalty": 4.5, "rationale": "prefer low x"},
    )
    assert res_soft.status_code == 201

    client.post(f"/api/v1/studies/{sid}/candidate-sets", json={"method": "grid", "settings": {}})

    # Add 2 replicates for x=2.0 (one exact, one within 0.5% span tolerance = 2.02)
    r_ev1 = client.post(
        f"/api/v1/studies/{sid}/evidence",
        json={"kind": "lab", "values": {"x": 2.0}, "outcomes": {"yield": {"value": 85.0}}, "replicate": 1},
    )
    assert r_ev1.status_code == 201
    r_ev2 = client.post(
        f"/api/v1/studies/{sid}/evidence",
        json={"kind": "lab", "values": {"x": 2.02}, "outcomes": {"yield": {"value": 90.0}}, "replicate": 2},
    )
    assert r_ev2.status_code == 201

    run = run_screening_pipeline(conn=db_conn, study_id=sid)
    assert run.summary.total_candidates == 2

    cands = client.get(f"/api/v1/studies/{sid}/candidates?limit=10").json()["items"]
    c2 = next(c for c in cands if c["values"]["x"] == 2.0)
    c8 = next(c for c in cands if c["values"]["x"] == 8.0)

    # x=2.0 matched both replicates (2.0 and 2.02)
    assert c2["decision"]["status"] == "tested_pass"
    assert c2["decision"]["details"]["replicates"] == 2
    assert c2["decision"]["details"]["outcome_means"]["yield"] == 87.5

    # x=8.0 violated soft constraint x <= 5.0 with penalty 4.5
    assert c8["decision"]["status"] == "open"
    assert c8["decision"]["details"]["soft_penalty"] == 4.5

