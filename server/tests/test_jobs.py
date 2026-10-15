from __future__ import annotations

import sqlite3
import time
from typing import Any

from fastapi.testclient import TestClient

from lattice_server.jobs import JobContext, JobManager


def test_job_success(db_conn: sqlite3.Connection) -> None:
    manager = JobManager(max_workers=1)

    def work(ctx: JobContext) -> dict[str, Any]:
        ctx.progress(0.5, "halfway")
        return {"answer": 42}

    job_id = manager.submit(
        kind="test",
        study_id=None,
        input_data={"foo": "bar"},
        fn=work,
    )

    # Wait for completion
    for _ in range(50):
        job = manager.get_job(job_id)
        if job and job.status == "done":
            break
        time.sleep(0.05)

    assert job is not None
    assert job.status == "done"
    assert job.result == {"answer": 42}
    assert job.progress == 1.0
    assert job.started_at is not None
    assert job.finished_at is not None

    manager.shutdown(wait=True)


def test_job_failure(db_conn: sqlite3.Connection) -> None:
    manager = JobManager(max_workers=1)

    def failing_work(ctx: JobContext) -> None:
        raise RuntimeError("Something exploded")

    job_id = manager.submit(
        kind="test_fail",
        study_id=None,
        input_data={},
        fn=failing_work,
    )

    for _ in range(50):
        job = manager.get_job(job_id)
        if job and job.status == "failed":
            break
        time.sleep(0.05)

    assert job is not None
    assert job.status == "failed"
    assert "Something exploded" in (job.error or "")

    manager.shutdown(wait=True)


def test_job_cancel_running(db_conn: sqlite3.Connection) -> None:
    manager = JobManager(max_workers=1)

    def long_work(ctx: JobContext) -> None:
        for _ in range(50):
            if ctx.is_cancelled():
                return
            time.sleep(0.02)

    job_id = manager.submit(
        kind="test_cancel",
        study_id=None,
        input_data={},
        fn=long_work,
    )

    # Wait until running
    for _ in range(50):
        job = manager.get_job(job_id)
        if job and job.status == "running":
            break
        time.sleep(0.02)

    manager.cancel(job_id)

    # Wait until cancelled
    for _ in range(50):
        job = manager.get_job(job_id)
        if job and job.status == "cancelled":
            break
        time.sleep(0.02)

    assert job is not None
    assert job.status == "cancelled"

    manager.shutdown(wait=True)


def test_job_startup_cleanup(db_conn: sqlite3.Connection) -> None:
    with db_conn:
        db_conn.execute(
            """
            INSERT INTO jobs (id, kind, status, progress, message, input_json, created_at)
            VALUES ('job_stale_1', 'screening', 'running', 0.2, 'processing', '{}', '2026-01-01T00:00:00Z'),
                   ('job_stale_2', 'doe_generate', 'queued', 0.0, '', '{}', '2026-01-01T00:00:00Z')
            """
        )

    manager = JobManager(max_workers=1)
    cleaned = manager.startup_cleanup()
    assert cleaned >= 2

    job1 = manager.get_job("job_stale_1")
    assert job1 is not None
    assert job1.status == "failed"
    assert "interrupted by server restart" in (job1.error or "")

    job2 = manager.get_job("job_stale_2")
    assert job2 is not None
    assert job2.status == "failed"

    manager.shutdown(wait=True)


def test_job_api_endpoints(client: TestClient, db_conn: sqlite3.Connection) -> None:
    with db_conn:
        db_conn.execute(
            """
            INSERT INTO jobs (id, kind, status, progress, message, input_json, created_at)
            VALUES ('job_api_test', 'doe_generate', 'queued', 0.0, 'waiting', '{}', '2026-01-01T00:00:00Z')
            """
        )

    # GET job
    resp = client.get("/api/v1/jobs/job_api_test")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "job_api_test"
    assert data["kind"] == "doe_generate"
    assert data["status"] == "queued"

    # GET 404
    resp404 = client.get("/api/v1/jobs/job_nonexistent")
    assert resp404.status_code == 404

    # Cancel job
    resp_cancel = client.post("/api/v1/jobs/job_api_test/cancel")
    assert resp_cancel.status_code == 200
    assert resp_cancel.json()["status"] == "cancelled"
