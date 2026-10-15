"""End-to-end acceptance tests for Phase 1 (P1-8 acceptance criteria).

Criteria:
1. Create tunnel template -> generate grid -> run screening -> funnel shows constraint exclusions -> list candidates.
2. Create drug template -> import candidates -> run screening -> funnel shows Lipinski constraint exclusions.
"""

from __future__ import annotations

import io
import sqlite3
import time

from fastapi.testclient import TestClient


def test_tunnel_template_screening_acceptance(client: TestClient, db_conn: sqlite3.Connection) -> None:
    # 1. Create study from tunnel_blast template
    res_tmpl = client.post("/api/v1/studies/from-template", json={"template": "tunnel_blast"})
    assert res_tmpl.status_code == 201
    study = res_tmpl.json()
    sid = study["id"]
    assert study["domain"] == "physics"

    # Verify parameters, outcomes, constraints loaded
    res_p = client.get(f"/api/v1/studies/{sid}/parameters")
    assert res_p.status_code == 200
    param_keys = {p["key"] for p in res_p.json()}
    assert "droplet" in param_keys
    assert "flow" in param_keys
    assert "nozzles" in param_keys

    res_c = client.get(f"/api/v1/studies/{sid}/constraints")
    assert res_c.status_code == 200
    assert len(res_c.json()) >= 1
    assert "flow * nozzles <= 600" in res_c.json()[0]["expression"]

    # 2. Generate candidates via Grid DoE
    res_gen = client.post(f"/api/v1/studies/{sid}/candidate-sets", json={"method": "grid", "settings": {}})
    assert res_gen.status_code == 201
    cset = res_gen.json()
    assert cset["count"] > 0
    total_candidates = cset["count"]

    # 3. Run screening pipeline
    res_scr = client.post(f"/api/v1/studies/{sid}/screening-runs", json={"settings": {}})
    assert res_scr.status_code == 202
    job_id = res_scr.json()["id"]

    for _ in range(50):
        res_job = client.get(f"/api/v1/jobs/{job_id}")
        if res_job.json()["status"] == "done":
            break
        time.sleep(0.05)

    assert res_job.json()["status"] == "done"

    # 4. Check funnel and latest screening run
    res_latest = client.get(f"/api/v1/studies/{sid}/screening-runs/latest")
    assert res_latest.status_code == 200
    latest = res_latest.json()

    summary = latest["summary"]
    assert summary["total_candidates"] == total_candidates
    funnel = summary["funnel"]
    assert funnel["total"] == total_candidates

    # Constraint flow * nozzles <= 600 rules out high-flow * high-nozzle combinations
    excluded_count = summary["counts_by_status"].get("excluded", 0)
    open_count = summary["counts_by_status"].get("open", 0)
    assert excluded_count > 0, "Hard constraint should have eliminated high-capacity pump candidates"
    assert open_count > 0, "Viable pump configurations should remain open"
    assert funnel["after_constraints"] == open_count

    # 5. Check paginated candidates
    res_cands = client.get(f"/api/v1/studies/{sid}/candidates?status=excluded&limit=10")
    assert res_cands.status_code == 200
    assert res_cands.json()["total"] == excluded_count
    item = res_cands.json()["items"][0]
    assert item["decision"]["status"] == "excluded"
    assert item["decision"]["filter"] == "constraint"


def test_drug_screen_import_and_screening_acceptance(client: TestClient, db_conn: sqlite3.Connection) -> None:
    # 1. Create study from drug_screen template (Lipinski rules)
    res_tmpl = client.post("/api/v1/studies/from-template", json={"template": "drug_screen"})
    assert res_tmpl.status_code == 201
    study = res_tmpl.json()
    sid = study["id"]
    assert study["domain"] == "pharmacology"

    # 2. Prepare synthetic CSV table of molecules
    # Lipinski rules: mw <= 500, logp <= 5, hbd <= 5, hba <= 10
    csv_data = (
        "label,mw [Da],logp,hbd,hba\n"
        "TEST-PASS-1,350.2,2.4,2,4\n"      # all satisfy
        "TEST-PASS-2,420.5,3.1,1,6\n"      # all satisfy
        "TEST-FAIL-MW,550.0,2.0,2,4\n"     # mw > 500
        "TEST-FAIL-LOGP,300.0,6.2,1,3\n"   # logp > 5
        "TEST-FAIL-HBD,320.0,1.5,6,4\n"    # hbd > 5
        "TEST-FAIL-HBA,450.0,2.1,3,12\n"   # hba > 10
    )

    # 3. Import candidate table
    file_payload = {"file": ("molecules.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    res_import = client.post(
        f"/api/v1/studies/{sid}/candidate-sets/import",
        files=file_payload,
        data={"skip_invalid": "false"},
    )
    assert res_import.status_code == 201
    import_res = res_import.json()
    assert import_res["imported_count"] == 6

    # 4. Run screening pipeline
    res_scr = client.post(f"/api/v1/studies/{sid}/screening-runs", json={"settings": {}})
    assert res_scr.status_code == 202
    job_id = res_scr.json()["id"]

    for _ in range(50):
        res_job = client.get(f"/api/v1/jobs/{job_id}")
        if res_job.json()["status"] == "done":
            break
        time.sleep(0.05)

    assert res_job.json()["status"] == "done"

    # 5. Verify results: 2 pass Lipinski rules, 4 fail Lipinski rules
    res_latest = client.get(f"/api/v1/studies/{sid}/screening-runs/latest")
    assert res_latest.status_code == 200
    summary = res_latest.json()["summary"]
    assert summary["total_candidates"] == 6
    assert summary["counts_by_status"]["open"] == 2
    assert summary["counts_by_status"]["excluded"] == 4
    assert summary["funnel"]["after_constraints"] == 2
