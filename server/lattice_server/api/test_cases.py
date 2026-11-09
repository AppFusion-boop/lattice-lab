"""API router for Custom Exact Test Cases in studies and 3D Flow simulations."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

import numpy as np
from fastapi import APIRouter, status

from lattice_server.api.models import _calculate_nominal_values
from lattice_server.audit import write_audit
from lattice_server.db import DbConn
from lattice_server.engine import bridge
from lattice_server.errors import ApiHttpError
from lattice_server.repo import models as models_repo
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.repo import test_cases as test_cases_repo
from lattice_server.schemas import (
    AssertionVerdict,
    OutcomeCriterion,
    TestCaseCreate,
    TestCaseResponse,
    TestCaseRunResult,
    TestCaseUpdate,
    TestSuiteRunResponse,
    TestSuiteSummaryResponse,
)

router = APIRouter(tags=["test-cases"])


def _evaluate_assertion(
    actual: float,
    op: str,
    target: float | None = None,
    low: float | None = None,
    high: float | None = None,
    tolerance_pct: float | None = None,
) -> tuple[bool, str, float | None, str | None]:
    """Evaluate whether actual value meets the criterion.

    Returns: (passed, expected_str, delta, message)
    """
    if op == "<":
        passed = target is not None and actual < target
        expected_str = f"< {target}"
        delta = actual - target if target is not None else None
        msg = None if passed else f"Exceeds upper limit {target} by {abs(delta):.3g}"
        return passed, expected_str, delta, msg

    if op == "<=":
        passed = target is not None and actual <= target
        expected_str = f"<= {target}"
        delta = actual - target if target is not None else None
        msg = None if passed else f"Exceeds maximum allowable {target} by {abs(delta):.3g}"
        return passed, expected_str, delta, msg

    if op == ">":
        passed = target is not None and actual > target
        expected_str = f"> {target}"
        delta = actual - target if target is not None else None
        msg = None if passed else f"Below minimum limit {target} by {abs(delta):.3g}"
        return passed, expected_str, delta, msg

    if op == ">=":
        passed = target is not None and actual >= target
        expected_str = f">= {target}"
        delta = actual - target if target is not None else None
        msg = None if passed else f"Fails target threshold {target} by {abs(delta):.3g}"
        return passed, expected_str, delta, msg

    if op == "between" and low is not None and high is not None:
        passed = low <= actual <= high
        expected_str = f"[{low}, {high}]"
        delta = actual - ((low + high) / 2.0)
        msg = None if passed else f"Value {actual:.3g} outside interval [{low}, {high}]"
        return passed, expected_str, delta, msg

    if op in ("==", "equals"):
        tol = (tolerance_pct or 2.0) / 100.0
        if target is not None:
            allowed_diff = abs(target * tol) if target != 0 else 1e-6
            delta = actual - target
            passed = abs(delta) <= allowed_diff
            expected_str = f"{target} ± {tolerance_pct or 2.0}%"
            msg = None if passed else f"Differs from target {target} by {abs(delta):.3g}"
            return passed, expected_str, delta, msg

    return True, f"{op} {target or ''}", None, None


def _run_single_test_case(
    conn: Any,
    study_id: str,
    test_case: TestCaseResponse,
    latest_model: Any,
    study_params: list[Any],
    study_outcomes: list[Any],
) -> TestCaseRunResult:
    """Execute a single test case through the simulation engine."""
    now = datetime.now(UTC).isoformat()

    if not latest_model:
        result = TestCaseRunResult(
            test_case_id=test_case.id,
            status="error",
            duration_ms=0.0,
            outcomes={},
            assertions=[],
            error_message="No simulation model version found for this study. Please save a flow model version first.",
            executed_at=now,
        )
        test_cases_repo.update_test_case_run_result(
            conn=conn,
            test_case_id=test_case.id,
            status="error",
            outputs=result.model_dump(),
        )
        return result

    # 1. Parameter resolution: merge defaults + test case explicit parameters
    nominal_vals = _calculate_nominal_values(study_params)
    effective_params: dict[str, Any] = {**nominal_vals, **test_case.parameters}

    # Validate numeric types
    for p in study_params:
        if p.key in effective_params:
            val = effective_params[p.key]
            if p.kind in ("continuous", "integer") and isinstance(val, (int, float, str)):
                try:
                    effective_params[p.key] = float(val) if p.kind == "continuous" else round(float(val))
                except (ValueError, TypeError):
                    pass

    # 2. Build active bindings for engine
    param_bindings = [
        {
            "parameterKey": pb.parameter_key,
            "nodeId": pb.node_id,
            "paramKey": pb.param_key,
            "paramUnit": pb.param_unit,
            "fieldUnit": pb.field_unit,
        }
        for pb in latest_model.parameter_bindings
        if not pb.not_in_model and pb.node_id and pb.param_key
    ]
    outcome_bindings = [
        {
            "outcomeKey": ob.outcome_key,
            "nodeId": ob.node_id,
            "port": ob.port,
            "reducer": ob.reducer,
            "threshold": ob.threshold if ob.threshold is not None else 0.0,
        }
        for ob in latest_model.outcome_bindings
    ]

    # 3. Invoke engine bridge
    t0 = time.perf_counter()
    try:
        results = bridge.evaluate(
            project=latest_model.project,
            param_bindings=param_bindings,
            outcome_bindings=outcome_bindings,
            rows=[{"id": test_case.id, "values": effective_params}],
        )
    except Exception as exc:  # noqa: BLE001
        duration_ms = (time.perf_counter() - t0) * 1000.0
        result = TestCaseRunResult(
            test_case_id=test_case.id,
            status="error",
            duration_ms=round(duration_ms, 2),
            outcomes={},
            assertions=[],
            error_message=f"Simulation execution error: {exc}",
            executed_at=now,
        )
        test_cases_repo.update_test_case_run_result(
            conn=conn,
            test_case_id=test_case.id,
            status="error",
            outputs=result.model_dump(),
        )
        return result

    duration_ms = (time.perf_counter() - t0) * 1000.0

    if not results or results[0].status == "error":
        err_msg = results[0].message if results else "Engine produced no output"
        result = TestCaseRunResult(
            test_case_id=test_case.id,
            status="error",
            duration_ms=round(duration_ms, 2),
            outcomes={},
            assertions=[],
            error_message=err_msg,
            executed_at=now,
        )
        test_cases_repo.update_test_case_run_result(
            conn=conn,
            test_case_id=test_case.id,
            status="error",
            outputs=result.model_dump(),
        )
        return result

    raw_outcomes = results[0].outcomes or {}
    clean_outcomes: dict[str, float] = {}
    for k, v in raw_outcomes.items():
        if isinstance(v, (int, float)) and np.isfinite(v):
            clean_outcomes[k] = round(float(v), 4)

    # 4. Evaluate assertions
    verdicts: list[AssertionVerdict] = []
    has_failure = False

    outcome_map = {o.key: o for o in study_outcomes}

    # Evaluate explicit test case assertions
    for o_key, assertion in test_case.expected_outcomes.items():
        o_def = outcome_map.get(o_key)
        label = o_def.label if o_def else o_key
        unit = o_def.unit if o_def else ""

        actual = clean_outcomes.get(o_key)
        if actual is None:
            verdicts.append(
                AssertionVerdict(
                    outcome_key=o_key,
                    label=label,
                    unit=unit,
                    actual=0.0,
                    expected=str(assertion),
                    passed=False,
                    message=f"Outcome '{o_key}' was not produced by simulation",
                )
            )
            has_failure = True
            continue

        if isinstance(assertion, dict):
            op = assertion.get("op", ">=")
            val = assertion.get("value")
            low = assertion.get("low")
            high = assertion.get("high")
            tol = assertion.get("tolerance_pct")
            passed, expected_str, delta, msg = _evaluate_assertion(actual, op, val, low, high, tol)
        elif isinstance(assertion, (int, float)):
            passed, expected_str, delta, msg = _evaluate_assertion(actual, "==", float(assertion), tolerance_pct=2.0)
        else:
            passed, expected_str, delta, msg = True, str(assertion), None, None

        if not passed:
            has_failure = True

        verdicts.append(
            AssertionVerdict(
                outcome_key=o_key,
                label=label,
                unit=unit,
                actual=actual,
                expected=expected_str,
                passed=passed,
                delta=round(delta, 4) if delta is not None else None,
                message=msg,
            )
        )

    # If an outcome has no explicit test assertion, fallback to study outcome criterion
    for o in study_outcomes:
        if o.key not in test_case.expected_outcomes and o.criterion and o.key in clean_outcomes:
            crit: OutcomeCriterion = o.criterion
            actual = clean_outcomes[o.key]
            passed, expected_str, delta, msg = _evaluate_assertion(
                actual=actual,
                op=crit.op,
                target=crit.value,
                low=crit.low,
                high=crit.high,
            )
            if not passed:
                has_failure = True
            verdicts.append(
                AssertionVerdict(
                    outcome_key=o.key,
                    label=o.label,
                    unit=o.unit,
                    actual=actual,
                    expected=f"{expected_str} (study target)",
                    passed=passed,
                    delta=round(delta, 4) if delta is not None else None,
                    message=msg,
                )
            )

    test_status = "failed" if has_failure else "passed"

    run_result = TestCaseRunResult(
        test_case_id=test_case.id,
        status=test_status,
        duration_ms=round(duration_ms, 2),
        outcomes=clean_outcomes,
        assertions=verdicts,
        error_message=None,
        executed_at=now,
    )

    test_cases_repo.update_test_case_run_result(
        conn=conn,
        test_case_id=test_case.id,
        status=test_status,
        outputs=run_result.model_dump(),
    )

    return run_result


@router.get(
    "/studies/{study_id}/test-cases",
    response_model=list[TestCaseResponse],
)
def list_test_cases(study_id: str, conn: DbConn) -> list[TestCaseResponse]:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return test_cases_repo.list_test_cases(conn, study_id)


@router.get(
    "/studies/{study_id}/test-cases/summary",
    response_model=TestSuiteSummaryResponse,
)
def get_test_suite_summary(study_id: str, conn: DbConn) -> TestSuiteSummaryResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return test_cases_repo.get_test_suite_summary(conn, study_id)


@router.post(
    "/studies/{study_id}/test-cases",
    response_model=TestCaseResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_test_case(
    study_id: str,
    payload: TestCaseCreate,
    conn: DbConn,
) -> TestCaseResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    return test_cases_repo.create_test_case(conn, study_id, payload)


@router.get(
    "/studies/{study_id}/test-cases/{test_case_id}",
    response_model=TestCaseResponse,
)
def get_test_case(
    study_id: str,
    test_case_id: str,
    conn: DbConn,
) -> TestCaseResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )
    tc = test_cases_repo.get_test_case(conn, test_case_id)
    if not tc or tc.study_id != study_id:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Test case '{test_case_id}' not found in study '{study_id}'",
        )
    return tc


@router.put(
    "/studies/{study_id}/test-cases/{test_case_id}",
    response_model=TestCaseResponse,
)
def update_test_case(
    study_id: str,
    test_case_id: str,
    payload: TestCaseUpdate,
    conn: DbConn,
) -> TestCaseResponse:
    existing = test_cases_repo.get_test_case(conn, test_case_id)
    if not existing or existing.study_id != study_id:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Test case '{test_case_id}' not found in study '{study_id}'",
        )
    updated = test_cases_repo.update_test_case(conn, test_case_id, payload)
    if not updated:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Test case '{test_case_id}' could not be updated",
        )
    return updated


@router.delete(
    "/studies/{study_id}/test-cases/{test_case_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_test_case(
    study_id: str,
    test_case_id: str,
    conn: DbConn,
) -> None:
    existing = test_cases_repo.get_test_case(conn, test_case_id)
    if not existing or existing.study_id != study_id:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Test case '{test_case_id}' not found in study '{study_id}'",
        )
    test_cases_repo.delete_test_case(conn, test_case_id)


@router.post(
    "/studies/{study_id}/test-cases/{test_case_id}/run",
    response_model=TestCaseRunResult,
)
def run_test_case(
    study_id: str,
    test_case_id: str,
    conn: DbConn,
) -> TestCaseRunResult:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    tc = test_cases_repo.get_test_case(conn, test_case_id)
    if not tc or tc.study_id != study_id:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Test case '{test_case_id}' not found in study '{study_id}'",
        )

    latest_model = models_repo.get_latest_model_version(conn, study_id)
    study_params = parameters_repo.list_parameters(conn, study_id)
    study_outcomes = outcomes_repo.list_outcomes(conn, study_id)

    res = _run_single_test_case(
        conn=conn,
        study_id=study_id,
        test_case=tc,
        latest_model=latest_model,
        study_params=study_params,
        study_outcomes=study_outcomes,
    )

    write_audit(
        conn=conn,
        action="run_test_case",
        entity="test_case",
        entity_id=test_case_id,
        study_id=study_id,
        details={
            "status": res.status,
            "duration_ms": res.duration_ms,
            "assertions_count": len(res.assertions),
            "model_version": latest_model.version if latest_model else None,
        },
    )

    return res


@router.post(
    "/studies/{study_id}/test-cases/run-all",
    response_model=TestSuiteRunResponse,
)
def run_all_test_cases(
    study_id: str,
    conn: DbConn,
) -> TestSuiteRunResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ApiHttpError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"Study '{study_id}' not found",
        )

    test_cases = test_cases_repo.list_test_cases(conn, study_id)
    latest_model = models_repo.get_latest_model_version(conn, study_id)
    study_params = parameters_repo.list_parameters(conn, study_id)
    study_outcomes = outcomes_repo.list_outcomes(conn, study_id)

    t0 = time.perf_counter()
    results: list[TestCaseRunResult] = []
    passed_count = 0
    failed_count = 0

    for tc in test_cases:
        r = _run_single_test_case(
            conn=conn,
            study_id=study_id,
            test_case=tc,
            latest_model=latest_model,
            study_params=study_params,
            study_outcomes=study_outcomes,
        )
        results.append(r)
        if r.status == "passed":
            passed_count += 1
        elif r.status in ("failed", "error"):
            failed_count += 1

    total_duration_ms = (time.perf_counter() - t0) * 1000.0

    test_cases_repo.record_test_suite_run(
        conn=conn,
        study_id=study_id,
        model_version_id=latest_model.id if latest_model else None,
        total=len(test_cases),
        passed=passed_count,
        failed=failed_count,
        duration_ms=round(total_duration_ms, 2),
        results=[r.model_dump() for r in results],
    )

    return TestSuiteRunResponse(
        study_id=study_id,
        model_version_id=latest_model.id if latest_model else None,
        total_count=len(test_cases),
        passed_count=passed_count,
        failed_count=failed_count,
        duration_ms=round(total_duration_ms, 2),
        results=results,
        created_at=datetime.now(UTC).isoformat(),
    )
