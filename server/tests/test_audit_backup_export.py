"""Tests for audit log querying, database backup, and study ZIP export (Phase 2, P2-5)."""

from __future__ import annotations

import csv
import io
import json
import sqlite3
import zipfile

from fastapi.testclient import TestClient

from lattice_server import config
from lattice_server.repo.backup_export import auto_backup_if_needed
from lattice_server.screening.pipeline import run_screening_pipeline


def _setup_study_with_data(client: TestClient, db_conn: sqlite3.Connection) -> tuple[str, str]:
    # 1. Study
    res = client.post(
        "/api/v1/studies",
        json={"name": "Export Test Study", "domain": "tunnel", "rng_seed": 777},
    )
    assert res.status_code == 201
    study_id = res.json()["id"]

    # 2. Parameters
    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "water_flow",
            "label": "Water Flow",
            "unit": "L/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10.0, "max": 100.0},
        },
    )
    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "nozzles",
            "label": "Nozzle Count",
            "unit": "",
            "kind": "integer",
            "role": "controlled",
            "spec": {"min": 2, "max": 8, "step": 2},
        },
    )

    # 3. Outcomes
    o_res = client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak Pressure",
            "unit": "kPa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 50.0},
        },
    )
    assert o_res.status_code == 201

    # 4. Constraints
    c_res = client.post(
        f"/api/v1/studies/{study_id}/constraints",
        json={
            "label": "Max pump rate",
            "expression": "water_flow * nozzles <= 300",
            "kind": "hard",
            "rationale": "Pump physical limit",
        },
    )
    assert c_res.status_code == 201

    # 5. Source
    s_res = client.post(
        f"/api/v1/studies/{study_id}/sources",
        json={
            "kind": "lab",
            "citation": "Tunnel Lab Run Log #42",
            "notes": "Calibration batch",
        },
    )
    assert s_res.status_code == 201
    source_id = s_res.json()["id"]

    # 6. Generate Candidates
    c_res = client.post(
        f"/api/v1/studies/{study_id}/candidate-sets",
        json={"method": "grid", "settings": {"density": 3}},
    )
    assert c_res.status_code == 201

    # 7. Add Evidence
    e_res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "source_id": source_id,
            "kind": "lab",
            "values": {"water_flow": 20.0, "nozzles": 4},
            "outcomes": {
                "peak_pressure": {"value": 42.0, "sd": 1.5, "n": 3, "unit": "kPa"},
            },
            "status": "valid",
        },
    )
    assert e_res.status_code == 201

    # 8. Run screening pipeline
    run_screening_pipeline(db_conn, study_id)

    return study_id, source_id


def test_audit_log_querying_and_filtering(client: TestClient, db_conn: sqlite3.Connection):
    study_id, _ = _setup_study_with_data(client, db_conn)

    # 1. Full audit list
    res = client.get(f"/api/v1/studies/{study_id}/audit")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] >= 5
    assert len(data["items"]) == data["total"]

    # 2. Filter by entity: parameter
    p_res = client.get(f"/api/v1/studies/{study_id}/audit?entity=parameter")
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert p_data["total"] == 2
    for item in p_data["items"]:
        assert item["entity"] == "parameter"

    # 3. Filter by action: create
    c_res = client.get(f"/api/v1/studies/{study_id}/audit?action=create")
    assert c_res.status_code == 200
    c_data = c_res.json()
    assert c_data["total"] >= 4
    for item in c_data["items"]:
        assert item["action"] == "create"

    # 4. Pagination
    page1 = client.get(f"/api/v1/studies/{study_id}/audit?limit=2&offset=0").json()
    page2 = client.get(f"/api/v1/studies/{study_id}/audit?limit=2&offset=2").json()
    assert len(page1["items"]) == 2
    assert len(page2["items"]) == 2
    p1_ids = {item["id"] for item in page1["items"]}
    p2_ids = {item["id"] for item in page2["items"]}
    assert p1_ids.isdisjoint(p2_ids)

    # 5. Non-existent study 404
    not_found = client.get("/api/v1/studies/study_nonexistent/audit")
    assert not_found.status_code == 404


def test_backup_and_auto_backup(client: TestClient, db_conn: sqlite3.Connection):
    study_id, _ = _setup_study_with_data(client, db_conn)

    # 1. Manual backup via API
    res = client.post(f"/api/v1/studies/{study_id}/backup")
    assert res.status_code == 201
    backup_data = res.json()
    assert backup_data["filename"].startswith("lattice-")
    assert backup_data["filename"].endswith(".sqlite")
    assert backup_data["size_bytes"] > 0

    backup_file = config.DATA_DIR / "backups" / backup_data["filename"]
    assert backup_file.exists()

    # 2. Verify backup file contains valid SQLite schema and data
    backup_conn = sqlite3.connect(backup_file)
    try:
        backup_conn.row_factory = sqlite3.Row
        studies = backup_conn.execute("SELECT * FROM studies WHERE id = ?", (study_id,)).fetchall()
        assert len(studies) == 1
        assert studies[0]["name"] == "Export Test Study"

        params = backup_conn.execute("SELECT * FROM parameters WHERE study_id = ?", (study_id,)).fetchall()
        assert len(params) == 2

        evidence = backup_conn.execute("SELECT * FROM evidence WHERE study_id = ?", (study_id,)).fetchall()
        assert len(evidence) == 1
    finally:
        backup_conn.close()

    # 3. auto_backup_if_needed: should return None since backup was just created (< 24h)
    auto_res = auto_backup_if_needed(db_conn)
    assert auto_res is None


def test_study_zip_export(client: TestClient, db_conn: sqlite3.Connection):
    study_id, _ = _setup_study_with_data(client, db_conn)

    # Export ZIP
    res = client.get(f"/api/v1/studies/{study_id}/export.zip")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    assert f'filename="study_{study_id}_export.zip"' in res.headers["content-disposition"]

    # Inspect zip contents in memory
    zf = zipfile.ZipFile(io.BytesIO(res.content))
    namelist = zf.namelist()

    assert "README.txt" in namelist
    assert "study.json" in namelist
    assert "evidence.csv" in namelist
    assert "candidates.csv" in namelist
    assert "audit.csv" in namelist

    # 1. Verify README.txt
    readme = zf.read("README.txt").decode("utf-8")
    assert "Lattice Lab Study Export Archive" in readme
    assert study_id in readme
    assert "Export Test Study" in readme

    # 2. Verify study.json
    study_json = json.loads(zf.read("study.json").decode("utf-8"))
    assert study_json["study"]["id"] == study_id
    assert study_json["study"]["name"] == "Export Test Study"
    assert len(study_json["parameters"]) == 2
    assert len(study_json["outcomes"]) == 1
    assert len(study_json["constraints"]) == 1
    assert len(study_json["sources"]) == 1
    assert study_json["active_candidate_set"] is not None
    assert study_json["latest_screening_run_id"] is not None

    # 3. Verify evidence.csv
    evidence_csv_text = zf.read("evidence.csv").decode("utf-8")
    evidence_reader = list(csv.reader(io.StringIO(evidence_csv_text)))
    assert len(evidence_reader) >= 2  # header + 1 row
    headers = evidence_reader[0]
    assert "id" in headers
    assert "water_flow [L/min]" in headers
    assert "nozzles" in headers
    assert "peak_pressure [kPa]" in headers
    assert "peak_pressure_sd" in headers

    data_row = evidence_reader[1]
    # Check that water_flow value 20.0 and peak_pressure 42.0 are present
    assert "20.0" in data_row or "20" in data_row
    assert "42.0" in data_row or "42" in data_row

    # 4. Verify candidates.csv
    candidates_csv_text = zf.read("candidates.csv").decode("utf-8")
    candidates_reader = list(csv.reader(io.StringIO(candidates_csv_text)))
    assert len(candidates_reader) > 1
    c_headers = candidates_reader[0]
    assert "candidate_id" in c_headers
    assert "screening_status" in c_headers
    assert "screening_filter" in c_headers
    assert "screening_reason" in c_headers

    # Check status values present
    statuses = {row[c_headers.index("screening_status")] for row in candidates_reader[1:]}
    assert "tested_pass" in statuses or "excluded" in statuses or "open" in statuses

    # 5. Verify audit.csv
    audit_csv_text = zf.read("audit.csv").decode("utf-8")
    audit_reader = list(csv.reader(io.StringIO(audit_csv_text)))
    assert len(audit_reader) >= 5
    a_headers = audit_reader[0]
    assert a_headers == ["id", "at", "actor", "action", "entity", "entity_id", "details"]
