"""Tests for physical unit conversion and compatibility endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from lattice_server.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_convert_pressure_units(client: TestClient) -> None:
    # 1.5 bar -> Pa (150,000 Pa)
    res = client.post(
        "/api/v1/units/convert",
        json={"value": 1.5, "from_unit": "bar", "to_unit": "Pa"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["compatible"] is True
    assert pytest.approx(data["converted_value"], rel=1e-5) == 150000.0

    # 100 kPa -> bar (1.0 bar)
    res = client.post(
        "/api/v1/units/convert",
        json={"value": 100.0, "from_unit": "kPa", "to_unit": "bar"},
    )
    assert res.status_code == 200
    assert pytest.approx(res.json()["converted_value"], rel=1e-5) == 1.0


def test_convert_length_units(client: TestClient) -> None:
    # 250 um -> mm (0.25 mm)
    res = client.post(
        "/api/v1/units/convert",
        json={"value": 250.0, "from_unit": "µm", "to_unit": "mm"},
    )
    assert res.status_code == 200
    assert pytest.approx(res.json()["converted_value"], rel=1e-5) == 0.25


def test_convert_flow_units(client: TestClient) -> None:
    # 45 L/min -> gpm (~11.8877 gpm)
    res = client.post(
        "/api/v1/units/convert",
        json={"value": 45.0, "from_unit": "L/min", "to_unit": "gpm"},
    )
    assert res.status_code == 200
    assert pytest.approx(res.json()["converted_value"], rel=1e-3) == 11.888


def test_convert_temperature_units(client: TestClient) -> None:
    # 25 degC -> K (298.15 K)
    res = client.post(
        "/api/v1/units/convert",
        json={"value": 25.0, "from_unit": "°C", "to_unit": "K"},
    )
    assert res.status_code == 200
    assert pytest.approx(res.json()["converted_value"], rel=1e-4) == 298.15


def test_incompatible_units_returns_flag(client: TestClient) -> None:
    # Cannot convert Pa to L/min
    res = client.post(
        "/api/v1/units/convert",
        json={"value": 100.0, "from_unit": "Pa", "to_unit": "L/min"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["compatible"] is False
    assert "Cannot convert" in data["message"]


def test_compatible_units_endpoint(client: TestClient) -> None:
    res = client.get("/api/v1/units/compatible?unit=Pa")
    assert res.status_code == 200
    data = res.json()
    assert data["dimension"] == "pressure"
    assert "kPa" in data["compatible"]
    assert "bar" in data["compatible"]
    assert "psi" in data["compatible"]

    res_flow = client.get("/api/v1/units/compatible?unit=L/min")
    assert res_flow.status_code == 200
    data_flow = res_flow.json()
    assert "gpm" in data_flow["compatible"]

