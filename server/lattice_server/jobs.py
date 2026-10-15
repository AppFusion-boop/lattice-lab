"""Background job runner using ThreadPoolExecutor."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from lattice_server import db
from lattice_server.ids import new_id
from lattice_server.schemas import JobResponse


class JobCancelledError(Exception):
    """Raised when a job is cancelled by the user."""


class JobContext:
    def __init__(self, job_id: str, cancel_event: threading.Event) -> None:
        self.job_id = job_id
        self._cancel_event = cancel_event

    def progress(self, fraction: float, message: str = "") -> None:
        clamped = max(0.0, min(1.0, float(fraction)))
        conn = db.connect()
        try:
            with conn:
                conn.execute(
                    "UPDATE jobs SET progress = ?, message = ? WHERE id = ?",
                    (clamped, message, self.job_id),
                )
        finally:
            conn.close()

    def is_cancelled(self) -> bool:
        return self._cancel_event.is_set()


def _row_to_job(row: sqlite3.Row) -> JobResponse:
    return JobResponse(
        id=row["id"],
        study_id=row["study_id"],
        kind=row["kind"],
        status=row["status"],
        progress=row["progress"],
        message=row["message"],
        input=json.loads(row["input_json"]) if row["input_json"] else None,
        result=json.loads(row["result_json"]) if row["result_json"] else None,
        error=row["error"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


class JobManager:
    def __init__(self, max_workers: int = 2) -> None:
        self.max_workers = max_workers
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self._active_contexts: dict[str, JobContext] = {}
        self._lock = threading.Lock()

    def startup(self) -> int:
        if self.executor._shutdown:
            self.executor = ThreadPoolExecutor(max_workers=self.max_workers)
        return self.startup_cleanup()

    def startup_cleanup(self, conn: sqlite3.Connection | None = None) -> int:
        """Mark lingering queued or running jobs as failed on server restart."""
        c = conn or db.connect()
        own_conn = conn is None
        try:
            with c:
                now = datetime.now(UTC).isoformat()
                cursor = c.execute(
                    """
                    UPDATE jobs
                    SET status = 'failed',
                        error = 'interrupted by server restart',
                        finished_at = ?
                    WHERE status IN ('queued', 'running')
                    """,
                    (now,),
                )
                return cursor.rowcount
        finally:
            if own_conn:
                c.close()

    def submit(
        self,
        kind: str,
        study_id: str | None,
        input_data: Any,
        fn: Callable[[JobContext], Any],
        job_id: str | None = None,
    ) -> str:
        jid = job_id or new_id("job")
        now = datetime.now(UTC).isoformat()
        input_json = json.dumps(input_data or {}, separators=(",", ":"), sort_keys=True)

        conn = db.connect()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO jobs (id, study_id, kind, status, progress, message, input_json, created_at)
                    VALUES (?, ?, ?, 'queued', 0, '', ?, ?)
                    """,
                    (jid, study_id, kind, input_json, now),
                )
        finally:
            conn.close()

        cancel_event = threading.Event()
        ctx = JobContext(job_id=jid, cancel_event=cancel_event)
        with self._lock:
            self._active_contexts[jid] = ctx

        self.executor.submit(self._worker_run, jid, ctx, fn)
        return jid

    def _worker_run(
        self,
        job_id: str,
        ctx: JobContext,
        fn: Callable[[JobContext], Any],
    ) -> None:
        conn = db.connect()
        try:
            now = datetime.now(UTC).isoformat()
            with conn:
                conn.execute(
                    "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?",
                    (now, job_id),
                )

            if ctx.is_cancelled():
                self._mark_terminal(conn, job_id, "cancelled", error="Cancelled by user")
                return

            result = fn(ctx)

            if ctx.is_cancelled():
                self._mark_terminal(conn, job_id, "cancelled", error="Cancelled by user")
            else:
                self._mark_terminal(conn, job_id, "done", result=result, progress=1.0)

        except Exception as exc:  # noqa: BLE001
            self._mark_terminal(conn, job_id, "failed", error=str(exc))
        finally:
            conn.close()
            with self._lock:
                self._active_contexts.pop(job_id, None)

    def _mark_terminal(
        self,
        conn: sqlite3.Connection,
        job_id: str,
        status: str,
        result: Any | None = None,
        error: str | None = None,
        progress: float | None = None,
    ) -> None:
        now = datetime.now(UTC).isoformat()
        res_json = json.dumps(result, separators=(",", ":"), sort_keys=True) if result is not None else None
        with conn:
            if progress is not None:
                conn.execute(
                    """
                    UPDATE jobs
                    SET status = ?, result_json = ?, error = ?, progress = ?, finished_at = ?
                    WHERE id = ?
                    """,
                    (status, res_json, error, progress, now, job_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE jobs
                    SET status = ?, result_json = ?, error = ?, finished_at = ?
                    WHERE id = ?
                    """,
                    (status, res_json, error, now, job_id),
                )

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            ctx = self._active_contexts.get(job_id)
            if ctx:
                ctx._cancel_event.set()

        conn = db.connect()
        try:
            with conn:
                row = conn.execute("SELECT status FROM jobs WHERE id = ?", (job_id,)).fetchone()
                if not row:
                    return False
                if row["status"] == "queued":
                    now = datetime.now(UTC).isoformat()
                    conn.execute(
                        "UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ?",
                        (now, job_id),
                    )
                return True
        finally:
            conn.close()

    def get_job(self, job_id: str, conn: sqlite3.Connection | None = None) -> JobResponse | None:
        c = conn or db.connect()
        own_conn = conn is None
        try:
            row = c.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                return None
            return _row_to_job(row)
        finally:
            if own_conn:
                c.close()

    def shutdown(self, wait: bool = False) -> None:
        self.executor.shutdown(wait=wait, cancel_futures=True)


# Singleton JobManager instance
job_manager = JobManager(max_workers=2)

