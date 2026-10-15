"""Repository for screening runs and decisions."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from lattice_server.audit import write_audit
from lattice_server.schemas import (
    ScreeningFunnel,
    ScreeningRunResponse,
    ScreeningSummary,
)


def _row_to_screening_run(row: sqlite3.Row) -> ScreeningRunResponse:
    raw_summary = json.loads(row["summary_json"])
    funnel_data = raw_summary.get("funnel", {})
    funnel = ScreeningFunnel(
        total=funnel_data.get("total", 0),
        after_constraints=funnel_data.get("after_constraints", 0),
        after_statistical=funnel_data.get("after_statistical", 0),
        after_deprioritised=funnel_data.get("after_deprioritised", 0),
        recommended=funnel_data.get("recommended", 0),
    )
    summary = ScreeningSummary(
        total_candidates=raw_summary.get("total_candidates", 0),
        funnel=funnel,
        counts_by_status=raw_summary.get("counts_by_status", {}),
        counts_by_filter=raw_summary.get("counts_by_filter", {}),
        expected_false_exclusions_bound=raw_summary.get("expected_false_exclusions_bound", 0.0),
    )

    return ScreeningRunResponse(
        id=row["id"],
        study_id=row["study_id"],
        candidate_set_id=row["candidate_set_id"],
        model_version_id=row["model_version_id"],
        evidence_fingerprint=row["evidence_fingerprint"],
        settings=json.loads(row["settings_json"]) if row["settings_json"] else {},
        summary=summary,
        job_id=row["job_id"],
        created_at=row["created_at"],
    )


def get_screening_run(conn: sqlite3.Connection, run_id: str) -> ScreeningRunResponse | None:
    row = conn.execute("SELECT * FROM screening_runs WHERE id = ?", (run_id,)).fetchone()
    if not row:
        return None
    return _row_to_screening_run(row)


def get_latest_screening_run(conn: sqlite3.Connection, study_id: str) -> ScreeningRunResponse | None:
    row = conn.execute(
        "SELECT * FROM screening_runs WHERE study_id = ? ORDER BY created_at DESC LIMIT 1",
        (study_id,),
    ).fetchone()
    if not row:
        return None
    return _row_to_screening_run(row)


def list_screening_runs(conn: sqlite3.Connection, study_id: str) -> list[ScreeningRunResponse]:
    rows = conn.execute(
        "SELECT * FROM screening_runs WHERE study_id = ? ORDER BY created_at DESC",
        (study_id,),
    ).fetchall()
    return [_row_to_screening_run(r) for r in rows]


def save_screening_run(
    conn: sqlite3.Connection,
    run_id: str,
    study_id: str,
    candidate_set_id: str,
    model_version_id: str | None,
    evidence_fingerprint: str,
    settings: dict[str, Any],
    summary: ScreeningSummary,
    job_id: str | None,
    created_at: str,
    decision_rows: list[tuple[str, str, str, str, float | None, float | None, str, str]],
    actor: str = "local-user",
) -> ScreeningRunResponse:
    settings_json = json.dumps(settings, separators=(",", ":"), sort_keys=True)
    summary_json = json.dumps(summary.model_dump(), separators=(",", ":"), sort_keys=True)

    with conn:
        conn.execute(
            """
            INSERT INTO screening_runs (
                id, study_id, candidate_set_id, model_version_id,
                evidence_fingerprint, settings_json, summary_json, job_id, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                study_id,
                candidate_set_id,
                model_version_id,
                evidence_fingerprint,
                settings_json,
                summary_json,
                job_id,
                created_at,
            ),
        )

        conn.executemany(
            """
            INSERT INTO decisions (
                screening_run_id, candidate_id, status, filter,
                p_hat, p_upper, reason, details_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            decision_rows,
        )

        write_audit(
            conn=conn,
            action="create",
            entity="screening_run",
            entity_id=run_id,
            study_id=study_id,
            details={
                "candidate_set_id": candidate_set_id,
                "total_candidates": summary.total_candidates,
                "counts_by_status": summary.counts_by_status,
            },
            actor=actor,
        )

    row = conn.execute("SELECT * FROM screening_runs WHERE id = ?", (run_id,)).fetchone()
    return _row_to_screening_run(row)
