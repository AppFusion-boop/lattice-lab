"""Tests for Run Sheet export and field results re-import (Phase 2, P2-4)."""

from __future__ import annotations

import csv
import io
import sqlite3

from fastapi.testclient import TestClient

from lattice_server import db
from lattice_server.screening.pipeline import run_screening_pipeline


def _setup_run_sheet_study(client: TestClient, db_conn: sqlite3.Connection) -> tuple[str, str]:
    # 1. Study
    res = client.post(
        "/api/v1/studies",
        json={"name": "Run Sheet Field Study", "domain": "tunnel", "rng_seed": 1234},
    )
    assert res.status_code == 201
    study_id = res.json()["id"]

    # 2. Parameters
    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "droplet",
            "label": "Droplet diameter",
            "unit": "um",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 50.0, "max": 150.0, "levels": 3},  # 50, 100, 150
        },
    )
    client.post(
        f"/api/v1/studies/{study_id}/parameters",
        json={
            "key": "flow",
            "label": "Flow rate",
            "unit": "L/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10.0, "max": 20.0, "levels": 2},  # 10, 20
        },
    )

    # 3. Outcome
    client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak pressure",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 7500.0},
        },
    )

    # 4. Generate candidate grid (3 x 2 = 6 candidates)
    res_cset = client.post(
        f"/api/v1/studies/{study_id}/candidate-sets",
        json={"method": "grid"},
    )
    assert res_cset.status_code == 201
    cset_id = res_cset.json()["id"]

    # 5. Run screening so candidates have open status
    run_screening_pipeline(conn=db_conn, study_id=study_id)

    return study_id, cset_id


def test_create_and_download_run_sheet_csv(client: TestClient, db_conn: sqlite3.Connection) -> None:
    study_id, _ = _setup_run_sheet_study(client, db_conn)

    # 1. Create Run Sheet (3 replicates per candidate, 6 candidates -> 18 runs)
    res = client.post(
        f"/api/v1/studies/{study_id}/run-sheets",
        json={"replicates": 3, "candidate_status": "open", "seed": 9999},
    )
    assert res.status_code == 201
    rs = res.json()
    assert rs["id"].startswith("rs_")
    assert rs["count"] == 18
    rs_id = rs["id"]

    # 2. Download CSV
    res_csv = client.get(f"/api/v1/run-sheets/{rs_id}.csv")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.headers["content-type"]
    assert f'filename="run_sheet_{rs_id}.csv"' in res_csv.headers["content-disposition"]

    csv_text = res_csv.text
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)

    header = rows[0]
    assert header == [
        "run_order",
        "run_id",
        "candidate_id",
        "replicate",
        "droplet [um]",
        "flow [L/min]",
        "peak_pressure [Pa]",
        "status",
        "notes",
    ]

    data_rows = rows[1:]
    assert len(data_rows) == 18

    # Verify run orders are 1..18
    run_orders = [int(r[0]) for r in data_rows]
    assert run_orders == list(range(1, 19))

    # Verify outcome columns, status, and notes are blank
    for r in data_rows:
        assert r[6] == ""  # peak_pressure
        assert r[7] == ""  # status
        assert r[8] == ""  # notes


def test_run_sheet_results_round_trip(client: TestClient, db_conn: sqlite3.Connection) -> None:
    study_id, _ = _setup_run_sheet_study(client, db_conn)

    # 1. Create run sheet
    rs_res = client.post(
        f"/api/v1/studies/{study_id}/run-sheets",
        json={"replicates": 2, "candidate_status": "open", "seed": 42},
    )
    rs_id = rs_res.json()["id"]

    # 2. Download generated CSV
    csv_text = client.get(f"/api/v1/run-sheets/{rs_id}.csv").text
    rows = list(csv.reader(io.StringIO(csv_text)))
    header = rows[0]
    data_rows = rows[1:]

    # 3. Simulate field technician:
    # Fill row 1: valid run, outcome 6400 Pa
    data_rows[0][6] = "6400.0"
    data_rows[0][7] = "valid"
    data_rows[0][8] = "Clean trial"

    # Fill row 2: unit conversion in header test or outcome in kPa: 7.1 kPa = 7100 Pa
    # Let's say technician changes header to [kPa] or leaves Pa and enters 7100
    data_rows[1][6] = "7100.0"
    data_rows[1][7] = "valid"
    data_rows[1][8] = "Nominal test"

    # Fill row 3: failed_run with notes explaining apparatus failure
    data_rows[2][6] = "0.0"
    data_rows[2][7] = "failed_run"
    data_rows[2][8] = "Igniter failed to fire"

    # Leave all remaining rows (rows 4..12) blank (not tested yet)

    # Convert back to CSV bytes
    out_buf = io.StringIO()
    writer = csv.writer(out_buf)
    writer.writerow(header)
    writer.writerows(data_rows)
    filled_csv_bytes = out_buf.getvalue().encode("utf-8")

    # 4. Re-import filled CSV
    files = {"file": ("filled_run_sheet.csv", io.BytesIO(filled_csv_bytes), "text/csv")}
    import_res = client.post(f"/api/v1/run-sheets/{rs_id}/results", files=files)
    assert import_res.status_code == 200
    res_data = import_res.json()

    assert res_data["imported_count"] == 3
    assert res_data["skipped_count"] == 9  # 12 total - 3 filled = 9 skipped
    assert res_data["errors"] == []

    # 5. Verify evidence records created in database
    evi_res = client.get(f"/api/v1/studies/{study_id}/evidence")
    assert evi_res.status_code == 200
    evidence_records = evi_res.json()
    assert len(evidence_records) == 3

    for evi in evidence_records:
        assert evi["run_sheet_id"] == rs_id
        assert evi["kind"] == "field"
        assert evi["candidate_id"] is not None
        assert evi["replicate"] in (1, 2)

    # Check the failed_run record
    failed_evi = next(e for e in evidence_records if e["status"] == "failed_run")
    assert failed_evi["status_reason"] == "Igniter failed to fire"

    # Check audit log
    with db.connect() as conn:
        audit_rows = conn.execute(
            "SELECT * FROM audit_log WHERE study_id = ? AND entity = 'run_sheet' ORDER BY id ASC",
            (study_id,),
        ).fetchall()
        actions = [r["action"] for r in audit_rows]
        assert "create" in actions
        assert "import_results" in actions


def test_split_plot_hardware_changeover_run_sheet(client: TestClient, db_conn: sqlite3.Connection) -> None:
    study_id, _ = _setup_run_sheet_study(client, db_conn)

    # 6 candidates (droplet in {50, 100, 150} x flow in {10, 20}), 3 replicates -> 18 runs.
    # If flow is hard-to-change (2 levels: 10 and 20), split-plot grouping must produce exactly 2 hardware changeovers!
    res = client.post(
        f"/api/v1/studies/{study_id}/run-sheets",
        json={
            "replicates": 3,
            "candidate_status": "open",
            "seed": 42,
            "hard_to_change_keys": ["flow"],
        },
    )
    assert res.status_code == 201
    rs = res.json()
    assert rs["count"] == 18
    assert len(rs["rows"]) == 18
    assert rs["hardware_changeovers"] == 2
    assert rs["saved_changeovers"] > 0

    # Verify all 9 runs in block 1 have the same flow value, and all 9 runs in block 2 have the other flow value
    flows_block1 = {r["values"]["flow"] for r in rs["rows"][:9]}
    flows_block2 = {r["values"]["flow"] for r in rs["rows"][9:]}
    assert len(flows_block1) == 1
    assert len(flows_block2) == 1
    assert flows_block1 != flows_block2

