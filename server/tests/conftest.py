from __future__ import annotations

import sqlite3
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def temp_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[Path, None, None]:
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("LATTICE_DATA_DIR", str(data_dir))
    # Keep every test database empty unless a test opts in to the bundled examples.
    monkeypatch.setenv("LATTICE_SEED_EXAMPLES", "0")

    from lattice_server import config

    monkeypatch.setattr(config, "DATA_DIR", data_dir)
    monkeypatch.setattr(config, "DB_PATH", data_dir / "lattice.sqlite")

    yield data_dir


@pytest.fixture
def client(temp_env: Path) -> Generator[TestClient, None, None]:
    from lattice_server.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db_conn(temp_env: Path) -> Generator[sqlite3.Connection, None, None]:
    from lattice_server import db

    conn = db.connect()
    db.migrate(conn)
    yield conn
    conn.close()
