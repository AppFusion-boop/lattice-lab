"""Tests for Candidate Import from CSV and Excel with Unit Parsing and Validation."""

import io
import json

import openpyxl
from fastapi.testclient import TestClient

from lattice_server.importers.tabular import convert_unit_value, parse_header_unit


def test_parse_header_unit():
    """Verify header unit extraction from [unit] and (unit) notations."""
    assert parse_header_unit("Molecular Weight [Da]") == ("Molecular Weight", "Da")
    assert parse_header_unit("flow (L/min)") == ("flow", "L/min")
    assert parse_header_unit("droplet") == ("droplet", "")
    assert parse_header_unit("temperature [°C]") == ("temperature", "°C")


def test_unit_conversion_pint():
    """Verify numerical values convert between compatible units."""
    # 1.5 mm to um -> 1500.0
    val_um = convert_unit_value(1.5, "mm", "µm")
    assert abs(val_um - 1500.0) < 1e-6

    # 1 L/min to L/min -> 1.0
    val_same = convert_unit_value(10.0, "L/min", "L/min")
    assert val_same == 10.0


def test_import_candidates_csv_happy_path(client: TestClient):
    """Import drug screen candidate CSV with 10 fabricated compounds."""
    # Create study from drug_screen template (parameters: mw, logp, hbd, hba)
    s_res = client.post("/api/v1/studies/from-template", json={"template": "drug_screen"})
    assert s_res.status_code == 201
    sid = s_res.json()["id"]

    # Fabricated clearly fake test compounds
    csv_content = (
        "Compound ID,Molecular Weight [Da],LogP,Donors,Acceptors\n"
        "TEST-001,350.2,2.4,2,4\n"
        "TEST-002,420.5,3.1,1,5\n"
        "TEST-003,280.1,1.8,3,3\n"
        "TEST-004,490.0,4.2,0,6\n"
        "TEST-005,180.2,0.5,1,2\n"
        "TEST-006,510.4,5.2,2,7\n"
        "TEST-007,315.3,2.9,2,4\n"
        "TEST-008,390.8,3.5,1,3\n"
        "TEST-009,445.6,4.0,2,5\n"
        "TEST-010,260.0,1.2,1,2\n"
    )

    mapping = {
        "Compound ID": "label",
        "Molecular Weight [Da]": "mw",
        "LogP": "logp",
        "Donors": "hbd",
        "Acceptors": "hba",
    }

    res = client.post(
        f"/api/v1/studies/{sid}/candidate-sets/import",
        files={"file": ("compounds.csv", csv_content.encode("utf-8"), "text/csv")},
        data={"mapping": json.dumps(mapping), "skip_invalid": "false"},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["imported_count"] == 10
    assert data["skipped_count"] == 0
    assert data["candidate_set"]["method"] == "imported"

    # Verify candidates were inserted with labels
    c_res = client.get(f"/api/v1/studies/{sid}/candidates?limit=10")
    items = c_res.json()["items"]
    assert len(items) == 10
    assert items[0]["label"] == "TEST-001"
    assert items[0]["values"]["mw"] == 350.2


def test_import_candidates_bom_and_semicolon(client: TestClient):
    """Test importing UTF-8 with BOM and semicolon-delimited CSV."""
    s_res = client.post("/api/v1/studies/from-template", json={"template": "drug_screen"})
    sid = s_res.json()["id"]

    # Semicolon delimited with UTF-8 BOM
    csv_text = (
        "Name;mw;logp;hbd;hba\n"
        "TEST-BOM-1;300;2.0;1;3\n"
        "TEST-BOM-2;400;3.0;2;4\n"
    )
    bom_bytes = b"\xef\xbb\xbf" + csv_text.encode("utf-8")

    mapping = {"Name": "label", "mw": "mw", "logp": "logp", "hbd": "hbd", "hba": "hba"}

    res = client.post(
        f"/api/v1/studies/{sid}/candidate-sets/import",
        files={"file": ("bom_test.csv", bom_bytes, "text/csv")},
        data={"mapping": json.dumps(mapping)},
    )
    assert res.status_code == 201
    assert res.json()["imported_count"] == 2


def test_import_candidates_excel_xlsx(client: TestClient):
    """Test importing candidates from an Excel workbook (.xlsx)."""
    s_res = client.post("/api/v1/studies/from-template", json={"template": "drug_screen"})
    sid = s_res.json()["id"]

    # Create in-memory xlsx
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["ID", "mw", "logp", "hbd", "hba"])
    ws.append(["XLSX-001", 320.0, 2.5, 1, 4])
    ws.append(["XLSX-002", 410.0, 3.2, 2, 5])

    bio = io.BytesIO()
    wb.save(bio)
    xlsx_bytes = bio.getvalue()

    mapping = {"ID": "label", "mw": "mw", "logp": "logp", "hbd": "hbd", "hba": "hba"}

    res = client.post(
        f"/api/v1/studies/{sid}/candidate-sets/import",
        files={"file": ("candidates.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"mapping": json.dumps(mapping)},
    )
    assert res.status_code == 201
    assert res.json()["imported_count"] == 2


def test_import_out_of_range_and_skip_invalid(client: TestClient):
    """Test that out-of-range rows fail all-or-nothing, but skip_invalid=True imports valid rows."""
    s_res = client.post("/api/v1/studies/from-template", json={"template": "drug_screen"})
    sid = s_res.json()["id"]

    # Row 2 has mw=9999 (out of range [100, 900])
    csv_content = (
        "label,mw,logp,hbd,hba\n"
        "GOOD-001,300,2.0,1,3\n"
        "BAD-002,9999,2.0,1,3\n"
        "GOOD-003,400,3.0,2,4\n"
    )

    mapping = {"label": "label", "mw": "mw", "logp": "logp", "hbd": "hbd", "hba": "hba"}

    # 1. All-or-nothing mode -> 422
    res_fail = client.post(
        f"/api/v1/studies/{sid}/candidate-sets/import",
        files={"file": ("data.csv", csv_content.encode("utf-8"), "text/csv")},
        data={"mapping": json.dumps(mapping), "skip_invalid": "false"},
    )
    assert res_fail.status_code == 422
    assert "outside allowed range" in res_fail.json()["detail"]["message"]

    # 2. skip_invalid=true mode -> 201 with 2 imported, 1 skipped
    res_skip = client.post(
        f"/api/v1/studies/{sid}/candidate-sets/import",
        files={"file": ("data.csv", csv_content.encode("utf-8"), "text/csv")},
        data={"mapping": json.dumps(mapping), "skip_invalid": "true"},
    )
    assert res_skip.status_code == 201
    skip_data = res_skip.json()
    assert skip_data["imported_count"] == 2
    assert skip_data["skipped_count"] == 1
    assert len(skip_data["errors"]) == 1
    assert skip_data["errors"][0]["row"] == 2
