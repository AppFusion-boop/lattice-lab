"""First-run example studies: idempotent, insert-only, internally consistent."""

from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from lattice_server import examples
from lattice_server.screening.pipeline import compute_evidence_fingerprint

TABLES = [
    "studies",
    "parameters",
    "outcomes",
    "constraints",
    "model_versions",
    "candidate_sets",
    "candidates",
    "screening_runs",
    "decisions",
    "evidence",
    "analyses",
    "jobs",
    "audit_log",
]


@pytest.fixture
def enable_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LATTICE_SEED_EXAMPLES", "1")


def _scalar(conn: sqlite3.Connection, sql: str, sid: str) -> int:
    return conn.execute(sql, (sid,)).fetchone()[0]


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}


def test_bundle_lists_five_distinct_studies():
    ids = examples.example_study_ids()
    assert len(ids) == 5
    assert len(set(ids)) == 5


def test_seeding_is_disabled_by_default_in_tests(db_conn: sqlite3.Connection):
    assert examples.seed_example_studies(db_conn) == []
    assert _counts(db_conn)["studies"] == 0


def test_seeds_fresh_database(db_conn: sqlite3.Connection, enable_seed: None):
    created = examples.seed_example_studies(db_conn)
    assert created == examples.example_study_ids()

    studies = db_conn.execute("SELECT * FROM studies").fetchall()
    assert len(studies) == 5
    for s in studies:
        assert s["archived"] == 0
        # Hard rule 1: examples must say they are illustrative in the UI.
        assert "Example values — replace with your own." in s["description"]
        assert 0 < s["exclusion_threshold"] < 1


def test_seeding_twice_changes_nothing(db_conn: sqlite3.Connection, enable_seed: None):
    examples.seed_example_studies(db_conn)
    before = _counts(db_conn)
    assert examples.seed_example_studies(db_conn) == []
    assert _counts(db_conn) == before


def test_seeded_examples_are_complete_and_fresh(db_conn: sqlite3.Connection, enable_seed: None):
    examples.seed_example_studies(db_conn)
    for sid in examples.example_study_ids():
        q = _scalar
        assert q(db_conn, "SELECT COUNT(*) FROM parameters WHERE study_id = ?", sid) > 0
        assert q(db_conn, "SELECT COUNT(*) FROM outcomes WHERE study_id = ?", sid) > 0
        assert q(db_conn, "SELECT COUNT(*) FROM model_versions WHERE study_id = ?", sid) > 0
        assert (
            q(db_conn, "SELECT COUNT(*) FROM candidate_sets WHERE study_id = ? AND active = 1", sid)
            == 1
        )
        assert q(db_conn, "SELECT COUNT(*) FROM screening_runs WHERE study_id = ?", sid) == 1

        run = db_conn.execute("SELECT * FROM screening_runs WHERE study_id = ?", (sid,)).fetchone()
        # A first-time user must not open an example that shows a "stale" warning.
        assert run["evidence_fingerprint"] == compute_evidence_fingerprint(db_conn, sid)
        cand_count = db_conn.execute(
            "SELECT COUNT(*) FROM candidates WHERE candidate_set_id = ?", (run["candidate_set_id"],)
        ).fetchone()[0]
        dec_count = db_conn.execute(
            "SELECT COUNT(*) FROM decisions WHERE screening_run_id = ?", (run["id"],)
        ).fetchone()[0]
        assert dec_count == cand_count > 0


def test_seeded_decisions_obey_exclusion_rules(db_conn: sqlite3.Connection, enable_seed: None):
    """Hard rules 5 and 6: explainable decisions; unvalidated models only deprioritise."""
    examples.seed_example_studies(db_conn)
    rows = db_conn.execute(
        """
        SELECT d.status, d.filter, d.reason, d.details_json, mv.validation_status
        FROM decisions d
        JOIN screening_runs r ON r.id = d.screening_run_id
        LEFT JOIN model_versions mv ON mv.id = r.model_version_id
        """
    ).fetchall()
    assert rows
    for r in rows:
        json.loads(r["details_json"])
        if r["status"] in ("excluded", "deprioritised"):
            assert r["filter"].strip()
            assert r["reason"].strip()
        if r["status"] == "excluded" and r["filter"] != "constraint":
            assert r["validation_status"] == "validated", "unvalidated model must not exclude"


def test_seeded_evidence_is_labelled_and_immutable(db_conn: sqlite3.Connection, enable_seed: None):
    examples.seed_example_studies(db_conn)
    rows = db_conn.execute("SELECT id, notes FROM evidence").fetchall()
    assert rows
    for r in rows:
        assert "illustrative" in r["notes"].lower()
    with pytest.raises(sqlite3.DatabaseError, match="evidence is immutable"):
        db_conn.execute("DELETE FROM evidence WHERE id = ?", (rows[0]["id"],))


def test_seeded_evidence_lies_within_declared_parameter_ranges(
    db_conn: sqlite3.Connection, enable_seed: None
):
    """Guards against shipping stray test records (e.g. a stress-test row with ratio = 1e10)."""
    examples.seed_example_studies(db_conn)
    checked = 0
    for ev in db_conn.execute("SELECT study_id, values_json FROM evidence").fetchall():
        values = json.loads(ev["values_json"])
        for p in db_conn.execute(
            "SELECT key, spec_json FROM parameters WHERE study_id = ?", (ev["study_id"],)
        ):
            spec = json.loads(p["spec_json"])
            if p["key"] in values and "min" in spec and "max" in spec:
                assert spec["min"] <= values[p["key"]] <= spec["max"], (ev["study_id"], p["key"])
                checked += 1
    assert checked > 0
    assert (
        db_conn.execute(
            "SELECT COUNT(*) FROM evidence WHERE notes LIKE '%BENCH-RUN%'"
        ).fetchone()[0]
        == 0
    )


def test_does_not_touch_existing_studies(db_conn: sqlite3.Connection, enable_seed: None):
    """A database that already has an example (e.g. the developer DB) keeps its own version."""
    existing = examples.example_study_ids()[0]
    db_conn.execute(
        "INSERT INTO studies (id, name, description, rng_seed, created_at, updated_at) "
        "VALUES (?, 'My own edit', 'mine', 7, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        (existing,),
    )
    db_conn.commit()

    created = examples.seed_example_studies(db_conn)
    assert existing not in created
    assert len(created) == 4

    row = db_conn.execute("SELECT name, description FROM studies WHERE id = ?", (existing,)).fetchone()
    assert (row["name"], row["description"]) == ("My own edit", "mine")
    # No misleading "seeded" audit entry, and no stray child rows for the existing study.
    assert (
        db_conn.execute(
            "SELECT COUNT(*) FROM audit_log WHERE entity_id = ? AND action = 'example_seeded'",
            (existing,),
        ).fetchone()[0]
        == 0
    )
    assert (
        db_conn.execute(
            "SELECT COUNT(*) FROM parameters WHERE study_id = ?", (existing,)
        ).fetchone()[0]
        == 0
    )


def test_archived_example_stays_archived(db_conn: sqlite3.Connection, enable_seed: None):
    examples.seed_example_studies(db_conn)
    sid = examples.example_study_ids()[0]
    db_conn.execute("UPDATE studies SET archived = 1 WHERE id = ?", (sid,))
    db_conn.commit()

    assert examples.seed_example_studies(db_conn) == []
    assert db_conn.execute("SELECT archived FROM studies WHERE id = ?", (sid,)).fetchone()[0] == 1


def test_failure_rolls_back_completely(
    db_conn: sqlite3.Connection, enable_seed: None, tmp_path, monkeypatch: pytest.MonkeyPatch
):
    good = examples.SEED_FILE.read_text(encoding="utf-8")
    bad = good + "\nINSERT INTO no_such_table VALUES (1);\n"
    bad_file = tmp_path / "bad.sql"
    bad_file.write_text(bad, encoding="utf-8")
    monkeypatch.setattr(examples, "SEED_FILE", bad_file)

    with pytest.raises(sqlite3.Error):
        examples.seed_example_studies(db_conn)
    assert _counts(db_conn) == dict.fromkeys(TABLES, 0)


def test_app_startup_seeds_and_api_serves_examples(enable_seed: None):
    from lattice_server.main import app

    with TestClient(app) as client:
        resp = client.get("/api/v1/studies")
        assert resp.status_code == 200
        studies = resp.json()
        assert {s["id"] for s in studies} == set(examples.example_study_ids())

        for s in studies:
            sid = s["id"]
            for path in ("parameters", "outcomes", "constraints", "evidence"):
                r = client.get(f"/api/v1/studies/{sid}/{path}")
                assert r.status_code == 200, (sid, path, r.text)
            latest = client.get(f"/api/v1/studies/{sid}/screening-runs/latest")
            assert latest.status_code == 200, (sid, latest.text)
            assert latest.json()["summary"]["total_candidates"] > 0

    # A second start (new lifespan) must not duplicate anything.
    with TestClient(app) as client:
        assert len(client.get("/api/v1/studies").json()) == 5
