"""Repository for Test Cases operations."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from lattice_server.audit import write_audit
from lattice_server.ids import new_id
from lattice_server.schemas import (
    TestCaseCreate,
    TestCaseResponse,
    TestCaseUpdate,
    TestSuiteSummaryResponse,
)


def _row_to_test_case(row: sqlite3.Row) -> TestCaseResponse:
    params = json.loads(row["parameters_json"]) if row["parameters_json"] else {}
    expected = json.loads(row["expected_outcomes_json"]) if row["expected_outcomes_json"] else {}
    outputs = json.loads(row["last_run_outputs_json"]) if row["last_run_outputs_json"] else {}
    return TestCaseResponse(
        id=row["id"],
        study_id=row["study_id"],
        name=row["name"],
        description=row["description"],
        category=row["category"],
        parameters=params,
        expected_outcomes=expected,
        last_run_status=row["last_run_status"],
        last_run_at=row["last_run_at"],
        last_run_outputs=outputs,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_test_cases(conn: sqlite3.Connection, study_id: str) -> list[TestCaseResponse]:
    rows = conn.execute(
        "SELECT * FROM test_cases WHERE study_id = ? ORDER BY created_at ASC",
        (study_id,),
    ).fetchall()
    return [_row_to_test_case(r) for r in rows]


def get_test_case(conn: sqlite3.Connection, test_case_id: str) -> TestCaseResponse | None:
    row = conn.execute(
        "SELECT * FROM test_cases WHERE id = ?",
        (test_case_id,),
    ).fetchone()
    if not row:
        return None
    return _row_to_test_case(row)


def create_test_case(
    conn: sqlite3.Connection,
    study_id: str,
    payload: TestCaseCreate,
    actor: str = "local-user",
) -> TestCaseResponse:
    tc_id = new_id("tc")
    now = datetime.now(UTC).isoformat()
    params_json = json.dumps(payload.parameters, separators=(",", ":"), sort_keys=True)
    expected_json = json.dumps(payload.expected_outcomes, separators=(",", ":"), sort_keys=True)

    conn.execute(
        """
        INSERT INTO test_cases (
            id, study_id, name, description, category,
            parameters_json, expected_outcomes_json,
            last_run_status, last_run_at, last_run_outputs_json,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'untested', NULL, '{}', ?, ?)
        """,
        (
            tc_id,
            study_id,
            payload.name,
            payload.description,
            payload.category,
            params_json,
            expected_json,
            now,
            now,
        ),
    )

    write_audit(
        conn=conn,
        action="create_test_case",
        entity="test_case",
        entity_id=tc_id,
        study_id=study_id,
        details={
            "name": payload.name,
            "category": payload.category,
            "parameter_keys": list(payload.parameters.keys()),
        },
        actor=actor,
    )

    return get_test_case(conn, tc_id)  # type: ignore[return-value]


def update_test_case(
    conn: sqlite3.Connection,
    test_case_id: str,
    payload: TestCaseUpdate,
    actor: str = "local-user",
) -> TestCaseResponse | None:
    existing = get_test_case(conn, test_case_id)
    if not existing:
        return None

    now = datetime.now(UTC).isoformat()
    name = payload.name if payload.name is not None else existing.name
    description = payload.description if payload.description is not None else existing.description
    category = payload.category if payload.category is not None else existing.category

    # If parameters or assertions changed, reset status to 'untested'
    params_changed = payload.parameters is not None
    assertions_changed = payload.expected_outcomes is not None
    params = payload.parameters if payload.parameters is not None else existing.parameters
    expected = payload.expected_outcomes if payload.expected_outcomes is not None else existing.expected_outcomes

    status = "untested" if (params_changed or assertions_changed) else existing.last_run_status
    last_run_at = None if (params_changed or assertions_changed) else existing.last_run_at
    outputs = {} if (params_changed or assertions_changed) else existing.last_run_outputs

    params_json = json.dumps(params, separators=(",", ":"), sort_keys=True)
    expected_json = json.dumps(expected, separators=(",", ":"), sort_keys=True)
    outputs_json = json.dumps(outputs, separators=(",", ":"), sort_keys=True)

    conn.execute(
        """
        UPDATE test_cases SET
            name = ?,
            description = ?,
            category = ?,
            parameters_json = ?,
            expected_outcomes_json = ?,
            last_run_status = ?,
            last_run_at = ?,
            last_run_outputs_json = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            name,
            description,
            category,
            params_json,
            expected_json,
            status,
            last_run_at,
            outputs_json,
            now,
            test_case_id,
        ),
    )

    write_audit(
        conn=conn,
        action="update_test_case",
        entity="test_case",
        entity_id=test_case_id,
        study_id=existing.study_id,
        details={
            "name": name,
            "category": category,
            "reset_status": params_changed or assertions_changed,
        },
        actor=actor,
    )

    return get_test_case(conn, test_case_id)


def delete_test_case(
    conn: sqlite3.Connection,
    test_case_id: str,
    actor: str = "local-user",
) -> bool:
    existing = get_test_case(conn, test_case_id)
    if not existing:
        return False

    conn.execute("DELETE FROM test_cases WHERE id = ?", (test_case_id,))

    write_audit(
        conn=conn,
        action="delete_test_case",
        entity="test_case",
        entity_id=test_case_id,
        study_id=existing.study_id,
        details={"name": existing.name},
        actor=actor,
    )
    return True


def update_test_case_run_result(
    conn: sqlite3.Connection,
    test_case_id: str,
    status: str,
    outputs: dict[str, Any],
) -> None:
    now = datetime.now(UTC).isoformat()
    outputs_json = json.dumps(outputs, separators=(",", ":"), sort_keys=True)
    conn.execute(
        """
        UPDATE test_cases SET
            last_run_status = ?,
            last_run_at = ?,
            last_run_outputs_json = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (status, now, outputs_json, now, test_case_id),
    )


def record_test_suite_run(
    conn: sqlite3.Connection,
    study_id: str,
    model_version_id: str | None,
    total: int,
    passed: int,
    failed: int,
    duration_ms: float,
    results: list[dict[str, Any]],
) -> str:
    run_id = new_id("tcr")
    now = datetime.now(UTC).isoformat()
    results_json = json.dumps(results, separators=(",", ":"), sort_keys=True)

    conn.execute(
        """
        INSERT INTO test_case_runs (
            id, study_id, model_version_id, total_count, passed_count,
            failed_count, duration_ms, results_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            study_id,
            model_version_id,
            total,
            passed,
            failed,
            duration_ms,
            results_json,
            now,
        ),
    )

    write_audit(
        conn=conn,
        action="run_test_suite",
        entity="test_case_run",
        entity_id=run_id,
        study_id=study_id,
        details={
            "total": total,
            "passed": passed,
            "failed": failed,
            "duration_ms": duration_ms,
        },
    )

    return run_id


def get_test_suite_summary(conn: sqlite3.Connection, study_id: str) -> TestSuiteSummaryResponse:
    test_cases = list_test_cases(conn, study_id)
    total = len(test_cases)
    if total == 0:
        return TestSuiteSummaryResponse(
            total_count=0,
            passed_count=0,
            failed_count=0,
            untested_count=0,
            error_count=0,
            pass_rate_pct=0.0,
            last_run_at=None,
        )

    passed = sum(1 for tc in test_cases if tc.last_run_status == "passed")
    failed = sum(1 for tc in test_cases if tc.last_run_status == "failed")
    error = sum(1 for tc in test_cases if tc.last_run_status == "error")
    untested = sum(1 for tc in test_cases if tc.last_run_status == "untested")

    tested_count = passed + failed + error
    pass_rate = round((passed / tested_count * 100.0), 1) if tested_count > 0 else 0.0

    last_runs = [tc.last_run_at for tc in test_cases if tc.last_run_at]
    last_run_at = max(last_runs) if last_runs else None

    return TestSuiteSummaryResponse(
        total_count=total,
        passed_count=passed,
        failed_count=failed,
        untested_count=untested,
        error_count=error,
        pass_rate_pct=pass_rate,
        last_run_at=last_run_at,
    )
