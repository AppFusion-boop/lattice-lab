"""Tests for T4-4: Defensible scientific report generator."""

from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from lattice_server.screening.pipeline import run_screening_pipeline


def test_defensible_report_generation_obeys_hard_rule_7(
    client: TestClient, db_conn: sqlite3.Connection
) -> None:
    res_study = client.post(
        "/api/v1/studies",
        json={"name": "Report Generation Study", "domain": "physics", "confidence": 0.95},
    )
    sid = res_study.json()["id"]

    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "velocity",
            "label": "Velocity",
            "unit": "m/s",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1.0, "max": 10.0, "values": [2.0, 8.0]},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/outcomes",
        json={
            "key": "pressure",
            "label": "Pressure",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 5000.0},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={"label": "Max Velocity", "expression": "velocity <= 5.0", "kind": "hard", "rationale": "Safety limit"},
    )
    client.post(f"/api/v1/studies/{sid}/candidate-sets", json={"method": "grid", "settings": {}})
    run_screening_pipeline(conn=db_conn, study_id=sid)

    r_json = client.get(f"/api/v1/studies/{sid}/report")
    assert r_json.status_code == 200
    md = r_json.json()["markdown"]
    assert "Report Generation Study" in md
    assert "Buckingham" in md
    assert "excluded at 95% confidence" in md
    assert "violates constraint" in md

    # Hard Rule 7: statistical exclusion wording must never claim "proved" or "guaranteed" or "impossible"
    lower_md = md.lower()
    assert "proved" not in lower_md
    assert "guaranteed" not in lower_md
    assert "impossible" not in lower_md

    r_md = client.get(f"/api/v1/studies/{sid}/report.md")
    assert r_md.status_code == 200
    assert "text/markdown" in r_md.headers["content-type"]
    assert "# Scientific Screening & Experimental Priority Report" in r_md.text
