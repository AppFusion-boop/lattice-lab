"""Tests for Tabular Evidence Import wizard (Phase 2, P2-3)."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient

from lattice_server import db


def _setup_import_study(client: TestClient) -> str:
    res = client.post(
        "/api/v1/studies",
        json={"name": "Evidence Import Test Study", "domain": "tunnel"},
    )
    assert res.status_code == 201
    study_id = res.json()["id"]

    # Parameter droplet in um
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

    # Parameter flow in L/min
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

    # Outcome peak_pressure in Pa
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


def test_preview_tabular_evidence_guessing_and_units(client: TestClient) -> None:
    study_id = _setup_import_study(client)

    # CSV with units in headers and metadata columns
    csv_content = (
        b"Droplet diameter [mm],Water flow rate [L/min],Peak overpressure [kPa],Pressure_SD [kPa],Notes\n"
        b"0.1,20.0,6.5,0.2,Good trial\n"
        b"0.2,30.0,7.0,0.3,High blast\n"
    )

    files = {"file": ("trials.csv", io.BytesIO(csv_content), "text/csv")}
    res = client.post(f"/api/v1/studies/{study_id}/imports/preview", files=files)
    assert res.status_code == 200
    preview = res.json()

    assert preview["filename"] == "trials.csv"
    assert preview["total_rows"] == 2
    assert len(preview["sample_rows"]) == 2
    assert preview["import_token"].startswith("imp_")

    # Verify column units extracted
    col_units = preview["column_units"]
    assert col_units["Droplet diameter [mm]"] == "mm"
    assert col_units["Water flow rate [L/min]"] == "L/min"
    assert col_units["Peak overpressure [kPa]"] == "kPa"
    assert col_units["Pressure_SD [kPa]"] == "kPa"
    assert col_units["Notes"] == ""

    # Verify guessed mapping
    guessed = preview["guessed_mapping"]
    assert guessed["Droplet diameter [mm]"] == "param:droplet"
    assert guessed["Water flow rate [L/min]"] == "param:flow"
    assert guessed["Peak overpressure [kPa]"] == "outcome:peak_pressure"
    assert guessed["Pressure_SD [kPa]"] == "outcome_sd:peak_pressure"
    assert guessed["Notes"] == "notes"


def test_commit_tabular_evidence_conversions_and_audit(client: TestClient) -> None:
    study_id = _setup_import_study(client)

    # 1. Preview
    csv_content = (
        b"droplet [mm],flow [L/min],peak_pressure [kPa],sd [kPa],notes\n"
        b"0.15,25.0,6.8,0.1,Trial A\n"
        b"0.25,35.0,7.5,0.2,Trial B\n"
    )

    files = {"file": ("data.csv", io.BytesIO(csv_content), "text/csv")}
    preview_res = client.post(f"/api/v1/studies/{study_id}/imports/preview", files=files)
    token = preview_res.json()["import_token"]

    # 2. Commit with mapping
    commit_res = client.post(
        f"/api/v1/studies/{study_id}/imports/commit",
        json={
            "import_token": token,
            "mapping": {
                "droplet [mm]": "param:droplet",
                "flow [L/min]": "param:flow",
                "peak_pressure [kPa]": "outcome:peak_pressure",
                "sd [kPa]": "outcome_sd:peak_pressure",
                "notes": "notes",
            },
            "kind": "lab",
        },
    )
    assert commit_res.status_code == 200
    commit_data = commit_res.json()
    assert commit_data["imported_count"] == 2
    assert commit_data["skipped_count"] == 0
    assert commit_data["errors"] == []

    # 3. Check evidence records in DB
    evi_res = client.get(f"/api/v1/studies/{study_id}/evidence")
    assert evi_res.status_code == 200
    records = evi_res.json()
    assert len(records) == 2

    # Check 0.15 mm was converted to 150 um, and 6.8 kPa was converted to 6800 Pa
    row1 = next(r for r in records if r["notes"] == "Trial A")
    assert abs(row1["values"]["droplet"] - 150.0) < 1e-3
    assert abs(row1["values"]["flow"] - 25.0) < 1e-3
    assert abs(row1["outcomes"]["peak_pressure"]["value"] - 6800.0) < 1e-3
    assert abs(row1["outcomes"]["peak_pressure"]["sd"] - 100.0) < 1e-3
    assert row1["outcomes"]["peak_pressure"]["original_unit"] == "kPa"
    assert abs(row1["outcomes"]["peak_pressure"]["original_value"] - 6.8) < 1e-3

    # 4. Check audit log entry
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM audit_log WHERE study_id = ? AND action = 'import'",
            (study_id,),
        ).fetchone()
        assert row is not None
        assert row["entity"] == "evidence"


def test_semicolon_and_utf8_bom_handling(client: TestClient) -> None:
    study_id = _setup_import_study(client)

    # Semicolon delimited with UTF-8 BOM
    bom = b"\xef\xbb\xbf"
    csv_text = "droplet;flow;peak_pressure;notes\n100.0;15.0;6200.0;European format"
    content = bom + csv_text.encode("utf-8")

    files = {"file": ("data_semicolon.csv", io.BytesIO(content), "text/csv")}
    preview_res = client.post(f"/api/v1/studies/{study_id}/imports/preview", files=files)
    assert preview_res.status_code == 200
    preview = preview_res.json()
    assert preview["total_rows"] == 1
    assert "droplet" in preview["columns"]

    # Commit
    commit_res = client.post(
        f"/api/v1/studies/{study_id}/imports/commit",
        json={
            "import_token": preview["import_token"],
            "mapping": {
                "droplet": "param:droplet",
                "flow": "param:flow",
                "peak_pressure": "outcome:peak_pressure",
                "notes": "notes",
            },
        },
    )
    assert commit_res.status_code == 200
    assert commit_res.json()["imported_count"] == 1


def test_row_errors_and_skip_invalid(client: TestClient) -> None:
    study_id = _setup_import_study(client)

    # Row 1 is valid
    # Row 2 has flow = 999.0 which exceeds max 100.0
    # Row 3 is valid
    csv_content = (
        b"droplet,flow,peak_pressure\n"
        b"100.0,20.0,6000.0\n"
        b"100.0,999.0,6000.0\n"
        b"200.0,30.0,5500.0\n"
    )

    # 1. Preview
    files = {"file": ("errors.csv", io.BytesIO(csv_content), "text/csv")}
    preview_res = client.post(f"/api/v1/studies/{study_id}/imports/preview", files=files)
    token1 = preview_res.json()["import_token"]

    # 2. Commit without skip_invalid -> should raise 422
    commit_res = client.post(
        f"/api/v1/studies/{study_id}/imports/commit",
        json={
            "import_token": token1,
            "mapping": {
                "droplet": "param:droplet",
                "flow": "param:flow",
                "peak_pressure": "outcome:peak_pressure",
            },
            "skip_invalid": False,
        },
    )
    assert commit_res.status_code == 422
    assert "Row 2" in commit_res.json()["detail"]["message"]

    # 3. Preview again
    files = {"file": ("errors.csv", io.BytesIO(csv_content), "text/csv")}
    preview_res = client.post(f"/api/v1/studies/{study_id}/imports/preview", files=files)
    token2 = preview_res.json()["import_token"]

    # 4. Commit with skip_invalid=True -> imports 2, skips 1, returns errors
    commit_res = client.post(
        f"/api/v1/studies/{study_id}/imports/commit",
        json={
            "import_token": token2,
            "mapping": {
                "droplet": "param:droplet",
                "flow": "param:flow",
                "peak_pressure": "outcome:peak_pressure",
            },
            "skip_invalid": True,
        },
    )
    assert commit_res.status_code == 200
    res_data = commit_res.json()
    assert res_data["imported_count"] == 2
    assert res_data["skipped_count"] == 1
    assert len(res_data["errors"]) == 1
    assert res_data["errors"][0]["row"] == 2
