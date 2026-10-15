from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from lattice_server import db


def test_health_endpoint(client: TestClient):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "db_path" in data
    assert "engine_ok" in data


def test_migration_creates_all_tables():
    conn = db.connect()
    try:
        assert db.get_current_version(conn) == 0
        version = db.migrate(conn)
        assert version == 1

        tables = [
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
            ).fetchall()
        ]
        expected_tables = [
            "analyses",
            "audit_log",
            "candidate_sets",
            "candidates",
            "constraints",
            "decisions",
            "evidence",
            "jobs",
            "model_versions",
            "outcomes",
            "overrides",
            "parameters",
            "run_sheets",
            "schema_version",
            "screening_runs",
            "sources",
            "studies",
        ]
        for t in expected_tables:
            assert t in tables, f"Expected table {t} to be created by migration"

        assert db.get_current_version(conn) == 1
    finally:
        conn.close()


def test_evidence_immutability(db_conn: sqlite3.Connection):
    conn = db_conn
    # Create prerequisite study
    conn.execute(
        """
        INSERT INTO studies (id, name, rng_seed, created_at, updated_at)
        VALUES ('s1', 'Study 1', 42, '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z');
        """
    )
    # Insert evidence record
    conn.execute(
        """
        INSERT INTO evidence (
            id, study_id, kind, values_json, outcomes_json, status, created_at
        ) VALUES (
            'e1', 's1', 'field', '{"x": 1}', '{"y": 2}', 'valid', '2026-10-15T00:00:00Z'
        );
        """
    )
    conn.commit()

    # 1. Evidence delete must raise abort
    with pytest.raises(sqlite3.DatabaseError, match="evidence is immutable"):
        conn.execute("DELETE FROM evidence WHERE id = 'e1';")

    # 2. Evidence update of values_json must raise abort
    with pytest.raises(sqlite3.DatabaseError, match="evidence is immutable; create a superseding record"):
        conn.execute("UPDATE evidence SET values_json = '{\"x\": 2}' WHERE id = 'e1';")

    # 3. Retraction update succeeds once
    conn.execute(
        """
        UPDATE evidence
        SET retracted_at = '2026-10-15T01:00:00Z', retraction_reason = 'Sensor was faulty'
        WHERE id = 'e1';
        """
    )
    conn.commit()

    # 4. A second retraction update must raise abort
    with pytest.raises(sqlite3.DatabaseError, match="evidence is immutable; create a superseding record"):
        conn.execute(
            """
            UPDATE evidence
            SET retraction_reason = 'Changed my mind'
            WHERE id = 'e1';
            """
        )


def test_audit_log_append_only(db_conn: sqlite3.Connection):
    conn = db_conn
    conn.execute(
        """
        INSERT INTO audit_log (study_id, at, actor, action, entity, entity_id)
        VALUES ('s1', '2026-10-15T00:00:00Z', 'local-user', 'create', 'study', 's1');
        """
    )
    conn.commit()

    # Audit update must fail
    with pytest.raises(sqlite3.DatabaseError, match="audit log is append-only"):
        conn.execute("UPDATE audit_log SET actor = 'other' WHERE entity_id = 's1';")

    # Audit delete must fail
    with pytest.raises(sqlite3.DatabaseError, match="audit log is append-only"):
        conn.execute("DELETE FROM audit_log WHERE entity_id = 's1';")
