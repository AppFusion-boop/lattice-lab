"""Screening pipeline implementation (§4.5)."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

import numpy as np

from lattice_server.expr.evaluate import CompiledExpression, compile_expression
from lattice_server.ids import compute_values_hash, new_id
from lattice_server.repo import candidates as candidates_repo
from lattice_server.repo import constraints as constraints_repo
from lattice_server.repo import models as models_repo
from lattice_server.repo import outcomes as outcomes_repo
from lattice_server.repo import overrides as overrides_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import screening as screening_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    ConstraintResponse,
    ModelVersionResponse,
    OutcomeCriterion,
    OutcomeResponse,
    OverrideResponse,
    ParameterResponse,
    ScreeningFunnel,
    ScreeningRunResponse,
    ScreeningSummary,
)
from lattice_server.stats.montecarlo import run_monte_carlo_screening


def compute_evidence_fingerprint(conn: sqlite3.Connection, study_id: str) -> str:
    """Compute evidence fingerprint (SHA-256 of count, max created_at, ids) for valid evidence."""
    row = conn.execute(
        """
        SELECT COUNT(*) AS cnt, MAX(created_at) AS max_created, GROUP_CONCAT(id) AS id_list
        FROM evidence
        WHERE study_id = ? AND status = 'valid' AND retracted_at IS NULL
        """,
        (study_id,),
    ).fetchone()
    if not row or row["cnt"] == 0:
        return "none"
    payload = f"{row['cnt']}:{row['max_created'] or ''}:{row['id_list'] or ''}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def outcome_satisfies_criterion(criterion: OutcomeCriterion, val: float) -> bool:
    """Evaluate whether numerical outcome value satisfies outcome criterion."""
    op = criterion.op
    if op == "<":
        return criterion.value is not None and val < criterion.value
    if op == "<=":
        return criterion.value is not None and val <= criterion.value
    if op == ">":
        return criterion.value is not None and val > criterion.value
    if op == ">=":
        return criterion.value is not None and val >= criterion.value
    if op == "between":
        return (
            criterion.low is not None
            and criterion.high is not None
            and criterion.low <= val <= criterion.high
        )
    if op == "equals":
        return criterion.value is not None and bool(np.isclose(val, criterion.value, rtol=1e-7, atol=1e-9))
    return True


def evaluate_evidence_record_success(
    outcomes_dict: dict[str, Any],
    outcome_defs: list[OutcomeResponse],
) -> bool:
    """Check if an evidence record's outcomes meet all defined outcome criteria."""
    for o in outcome_defs:
        if o.criterion is None:
            continue
        out_entry = outcomes_dict.get(o.key)
        if out_entry is None:
            return False
        if isinstance(out_entry, dict):
            val = out_entry.get("value")
        elif isinstance(out_entry, (int, float)):
            val = float(out_entry)
        else:
            return False
        if val is None or not np.isfinite(val):
            return False
        if not outcome_satisfies_criterion(o.criterion, float(val)):
            return False
    return True


def matches_candidate(
    cand_id: str,
    cand_hash: str,
    cand_values: dict[str, Any],
    evi: dict[str, Any],
    controlled_params: list[ParameterResponse],
) -> bool:
    """Check whether an evidence record matches a candidate."""
    if evi["candidate_id"] and evi["candidate_id"] == cand_id:
        return True
    if evi["values_hash"] == cand_hash:
        return True

    evi_values = evi["values"]
    for p in controlled_params:
        if p.key not in cand_values or p.key not in evi_values:
            return False
        c_val = cand_values[p.key]
        e_val = evi_values[p.key]

        if p.kind == "continuous":
            if not np.isclose(float(c_val), float(e_val), rtol=1e-6, atol=1e-9):
                return False
        elif p.kind == "integer":
            if int(c_val) != int(e_val):
                return False
        else:
            if str(c_val) != str(e_val):
                return False
    return True


@dataclass
class FilterVerdict:
    status: Literal["open", "excluded", "deprioritised", "recommended", "tested_pass", "tested_fail"]
    filter: str
    p_hat: float | None = None
    p_upper: float | None = None
    reason: str = ""
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class CandidateBatch:
    ids: list[str]
    indices: list[int]
    values_hashes: list[str]
    values_by_key: dict[str, np.ndarray]
    raw_values: list[dict[str, Any]]


@dataclass
class ScreeningContext:
    study_id: str
    active_overrides: dict[str, OverrideResponse]
    controlled_params: list[ParameterResponse]
    outcomes: list[OutcomeResponse]
    evidence_records: list[dict[str, Any]]
    evidence_by_cand_id: dict[str, list[dict[str, Any]]]
    evidence_by_hash: dict[str, list[dict[str, Any]]]
    hard_constraints: list[tuple[ConstraintResponse, CompiledExpression]]
    soft_constraints: list[tuple[ConstraintResponse, CompiledExpression]]
    active_model: ModelVersionResponse | None = None
    uncertain_params: list[ParameterResponse] = field(default_factory=list)
    rng_seed: int = 42
    exclusion_threshold: float = 0.05
    confidence: float = 0.95
    mc_draws: int = 10


FilterFn = Callable[[ScreeningContext, CandidateBatch, list[FilterVerdict | None]], None]


def override_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 1: Override exists (not revoked) -> status from override, filter = 'override'."""
    for i, v_hash in enumerate(batch.values_hashes):
        if verdicts[i] is not None:
            continue
        if v_hash in ctx.active_overrides:
            ovr = ctx.active_overrides[v_hash]
            verdicts[i] = FilterVerdict(
                status=ovr.status,
                filter="override",
                reason=ovr.reason,
            )


def evidence_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 2: Tested: valid evidence exists whose controlled values match candidate.

    (continuous: relative tolerance 1e-6; integer/categorical: exact)
    -> tested_pass if majority of replicates succeed, else tested_fail.
    filter = 'evidence_match'
    """
    if not ctx.evidence_records:
        return

    has_continuous = any(p.kind == "continuous" for p in ctx.controlled_params)

    for i in range(len(batch.ids)):
        if verdicts[i] is not None:
            continue

        c_id = batch.ids[i]
        c_hash = batch.values_hashes[i]
        c_vals = batch.raw_values[i]

        matching: list[dict[str, Any]] = []

        # 1. Check candidate_id index
        if c_id in ctx.evidence_by_cand_id:
            matching.extend(ctx.evidence_by_cand_id[c_id])

        # 2. Check values_hash index
        if c_hash in ctx.evidence_by_hash:
            for r in ctx.evidence_by_hash[c_hash]:
                if r not in matching:
                    matching.append(r)

        # 3. If no match yet and continuous parameters exist, check tolerance match
        if not matching and has_continuous:
            for r in ctx.evidence_records:
                if matches_candidate(c_id, c_hash, c_vals, r, ctx.controlled_params) and r not in matching:
                    matching.append(r)

        if not matching:
            continue

        valid_recs = [r for r in matching if r["status"] == "valid"]
        failed_runs = [r for r in matching if r["status"] == "failed_run"]
        outliers = [r for r in matching if r["status"] == "outlier"]

        if not valid_recs:
            # Only failed runs or outliers: do not decide pass/fail
            continue

        passes = sum(1 for r in valid_recs if r["is_success"])
        n_valid = len(valid_recs)
        majority_pass = passes > (n_valid / 2)

        status_str: Literal["tested_pass", "tested_fail"] = (
            "tested_pass" if majority_pass else "tested_fail"
        )
        reason_str = (
            f"Tested: {passes}/{n_valid} replicates passed outcome criteria"
            if majority_pass
            else f"Tested: {n_valid - passes}/{n_valid} replicates failed outcome criteria"
        )

        details = {
            "replicates": n_valid,
            "passes": passes,
            "fails": n_valid - passes,
            "failed_runs": len(failed_runs),
            "outliers": len(outliers),
            "evidence_ids": [r["id"] for r in valid_recs],
        }
        if failed_runs:
            details["failed_run_ids"] = [r["id"] for r in failed_runs]

        verdicts[i] = FilterVerdict(
            status=status_str,
            filter="evidence_match",
            reason=reason_str,
            details=details,
        )


def constraint_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Steps 3 & 4: Evaluate hard and soft constraints vectorized.

    Step 3: Hard constraint violated -> excluded, filter = 'constraint'.
    Step 4: Constraint error (expression non-finite) -> open with flag 'constraint_error'.
    Soft constraints do not exclude; penalty stored in details.soft_penalty.
    """
    n = len(batch.ids)
    if n == 0:
        return

    hard_errors: list[list[str]] = [[] for _ in range(n)]
    hard_violations: list[list[str]] = [[] for _ in range(n)]
    soft_penalties: list[float] = [0.0 for _ in range(n)]

    # Evaluate hard constraints
    for constraint, compiled_expr in ctx.hard_constraints:
        values, finite_mask = compiled_expr.evaluate_vec(batch.values_by_key, n=n)
        for i in range(n):
            if not finite_mask[i]:
                hard_errors[i].append(constraint.expression)
            elif values[i] <= 0:
                reason = constraint.rationale if constraint.rationale else constraint.expression
                hard_violations[i].append(f"{constraint.expression} ({reason})")

    # Evaluate soft constraints
    for _constraint, compiled_expr in ctx.soft_constraints:
        values, finite_mask = compiled_expr.evaluate_vec(batch.values_by_key, n=n)
        for i in range(n):
            if not finite_mask[i] or values[i] <= 0:
                soft_penalties[i] += 1.0

    for i in range(n):
        if verdicts[i] is not None:
            continue

        # Step 4 check: Constraint error (expression non-finite for this candidate)
        # Takes precedence over exclusion so scientists are alerted and candidates are not silently lost.
        if hard_errors[i]:
            details: dict[str, Any] = {
                "flags": ["constraint_error"],
                "error_expressions": hard_errors[i],
            }
            if soft_penalties[i] > 0:
                details["soft_penalty"] = soft_penalties[i]
            verdicts[i] = FilterVerdict(
                status="open",
                filter="constraint_error",
                reason=f"Constraint calculation error in: {', '.join(hard_errors[i])}",
                details=details,
            )
        elif hard_violations[i]:
            # Step 3: Hard constraint violated
            details = {}
            if soft_penalties[i] > 0:
                details["soft_penalty"] = soft_penalties[i]
            verdicts[i] = FilterVerdict(
                status="excluded",
                filter="constraint",
                reason=f"Violates hard constraint: {'; '.join(hard_violations[i])}",
                details=details,
            )
        elif soft_penalties[i] > 0:
            # Passed hard constraints but incurred soft penalty
            pass


def fallback_open_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 8: Any remaining candidates are marked open."""
    # Re-evaluate soft penalties if needed or pass through
    # For efficiency we compute soft penalties if any soft constraints exist
    n = len(batch.ids)
    soft_penalties: list[float] = [0.0 for _ in range(n)]
    for _constraint, compiled_expr in ctx.soft_constraints:
        values, finite_mask = compiled_expr.evaluate_vec(batch.values_by_key, n=n)
        for i in range(n):
            if not finite_mask[i] or values[i] <= 0:
                soft_penalties[i] += 1.0

    for i in range(n):
        if verdicts[i] is None:
            details: dict[str, Any] = {}
            if soft_penalties[i] > 0:
                details["soft_penalty"] = soft_penalties[i]
            verdicts[i] = FilterVerdict(
                status="open",
                filter="none",
                reason="Passed all active constraints",
                details=details,
            )


def model_simulation_filter(
    ctx: ScreeningContext,
    batch: CandidateBatch,
    verdicts: list[FilterVerdict | None],
) -> None:
    """Step 5: Active Flow Model simulation screening (§4.5 step 5)."""
    if not ctx.active_model:
        return

    unresolved_cands = []
    unresolved_indices = []
    for i in range(len(batch.ids)):
        if verdicts[i] is None:
            unresolved_cands.append(
                {
                    "id": batch.ids[i],
                    "idx": batch.indices[i],
                    "values": batch.raw_values[i],
                }
            )
            unresolved_indices.append(i)

    if not unresolved_cands:
        return

    sim_results = run_monte_carlo_screening(
        model=ctx.active_model,
        candidates=unresolved_cands,
        uncertain_params=ctx.uncertain_params,
        outcomes=ctx.outcomes,
        rng_seed=ctx.rng_seed,
        exclusion_threshold=ctx.exclusion_threshold,
        confidence=ctx.confidence,
        mc_draws=ctx.mc_draws,
    )

    for i in unresolved_indices:
        cand_id = batch.ids[i]
        res = sim_results.get(cand_id)
        if res:
            verdicts[i] = FilterVerdict(
                status=res.status,
                filter="model",
                p_hat=res.p_hat,
                p_upper=res.p_upper,
                reason=res.reason,
                details=res.details,
            )


# Ordered list of screening filters matching §4.5
PIPELINE_FILTERS: list[FilterFn] = [
    override_filter,          # Step 1: Override
    evidence_filter,          # Step 2: Tested evidence match
    constraint_filter,        # Steps 3 & 4: Hard/soft constraints + errors
    model_simulation_filter,  # Step 5: Active Flow Model simulation
    fallback_open_filter,     # Step 8: Open fallback
]


def run_screening_pipeline(
    conn: sqlite3.Connection,
    study_id: str,
    candidate_set_id: str | None = None,
    settings: dict[str, Any] | None = None,
    job_id: str | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
    is_cancelled_callback: Callable[[], bool] | None = None,
    batch_size: int = 50_000,
    actor: str = "local-user",
) -> ScreeningRunResponse:
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ValueError(f"Study '{study_id}' not found")

    cset = (
        candidates_repo.get_candidate_set(conn, candidate_set_id)
        if candidate_set_id
        else candidates_repo.get_active_candidate_set(conn, study_id)
    )
    if not cset:
        raise ValueError("No active candidate set found for study")

    settings = settings or {}

    # Compile constraints
    params = parameters_repo.list_parameters(conn, study_id)
    controlled_params = [p for p in params if p.role == "controlled"]
    controlled_keys = {p.key for p in controlled_params}
    param_keys = {p.key for p in params}

    all_constraints = constraints_repo.list_constraints(conn, study_id)
    enabled_constraints = [c for c in all_constraints if c.enabled]

    hard_compiled: list[tuple[ConstraintResponse, CompiledExpression]] = []
    soft_compiled: list[tuple[ConstraintResponse, CompiledExpression]] = []

    for c in enabled_constraints:
        compiled = compile_expression(c.expression, variables=param_keys, strict=False)
        if c.kind == "hard":
            hard_compiled.append((c, compiled))
        else:
            soft_compiled.append((c, compiled))

    # Load active overrides
    overrides_map = overrides_repo.get_active_overrides_map(conn, study_id)

    # Load study outcomes and non-retracted evidence for tested_* matching
    study_outcomes = outcomes_repo.list_outcomes(conn, study_id)

    evidence_rows = conn.execute(
        """
        SELECT id, candidate_id, values_json, outcomes_json, status, replicate
        FROM evidence
        WHERE study_id = ? AND retracted_at IS NULL
        """,
        (study_id,),
    ).fetchall()

    evidence_records: list[dict[str, Any]] = []
    evidence_by_cand_id: dict[str, list[dict[str, Any]]] = {}
    evidence_by_hash: dict[str, list[dict[str, Any]]] = {}

    for er in evidence_rows:
        val_dict = json.loads(er["values_json"]) if er["values_json"] else {}
        out_dict = json.loads(er["outcomes_json"]) if er["outcomes_json"] else {}
        val_hash = compute_values_hash(val_dict, controlled_keys)
        is_succ = evaluate_evidence_record_success(out_dict, study_outcomes)

        rec = {
            "id": er["id"],
            "candidate_id": er["candidate_id"],
            "values": val_dict,
            "values_hash": val_hash,
            "outcomes": out_dict,
            "status": er["status"],
            "replicate": er["replicate"],
            "is_success": is_succ,
        }
        evidence_records.append(rec)

        if er["candidate_id"]:
            evidence_by_cand_id.setdefault(er["candidate_id"], []).append(rec)
        evidence_by_hash.setdefault(val_hash, []).append(rec)

    active_model = models_repo.get_latest_model_version(conn, study_id)
    uncertain_params = [p for p in params if p.role == "uncertain"]
    has_valid_model = bool(
        active_model
        and active_model.project
        and active_model.parameter_bindings
        and active_model.outcome_bindings
        and settings.get("simulate_model", True)
    )

    ctx = ScreeningContext(
        study_id=study_id,
        active_overrides=overrides_map,
        controlled_params=controlled_params,
        outcomes=study_outcomes,
        evidence_records=evidence_records,
        evidence_by_cand_id=evidence_by_cand_id,
        evidence_by_hash=evidence_by_hash,
        hard_constraints=hard_compiled,
        soft_constraints=soft_compiled,
        active_model=active_model if has_valid_model else None,
        uncertain_params=uncertain_params,
        rng_seed=study.rng_seed,
        exclusion_threshold=study.exclusion_threshold,
        confidence=study.confidence,
        mc_draws=int(settings.get("mc_draws", 5)),
    )

    total_candidates = cset.count
    decision_rows: list[tuple[str, str, str, str, float | None, float | None, str, str]] = []

    run_id = new_id("run")
    now = datetime.now(UTC).isoformat()
    fingerprint = compute_evidence_fingerprint(conn, study_id)

    # Stream candidates in chunks of batch_size
    cursor = conn.execute(
        "SELECT id, idx, values_json, values_hash FROM candidates WHERE candidate_set_id = ? ORDER BY idx ASC",
        (cset.id,),
    )

    processed_count = 0

    while True:
        if is_cancelled_callback and is_cancelled_callback():
            raise RuntimeError("Screening run was cancelled by user")

        rows = cursor.fetchmany(batch_size)
        if not rows:
            break

        batch_ids = [r["id"] for r in rows]
        batch_indices = [r["idx"] for r in rows]
        batch_hashes = [r["values_hash"] for r in rows]
        batch_values = [json.loads(r["values_json"]) for r in rows]

        # Vectorize numeric columns
        values_by_key: dict[str, np.ndarray] = {}
        for p in params:
            col_vals = []
            for v_dict in batch_values:
                val = v_dict.get(p.key, 0.0)
                if isinstance(val, (int, float)):
                    col_vals.append(float(val))
                else:
                    col_vals.append(np.nan)
            values_by_key[p.key] = np.array(col_vals, dtype=np.float64)

        batch = CandidateBatch(
            ids=batch_ids,
            indices=batch_indices,
            values_hashes=batch_hashes,
            values_by_key=values_by_key,
            raw_values=batch_values,
        )

        verdicts: list[FilterVerdict | None] = [None] * len(batch_ids)

        # Apply filters in order
        for filter_fn in PIPELINE_FILTERS:
            filter_fn(ctx, batch, verdicts)

        for i, verdict in enumerate(verdicts):
            assert verdict is not None
            details_str = json.dumps(verdict.details, separators=(",", ":"), sort_keys=True)
            decision_rows.append(
                (
                    run_id,
                    batch_ids[i],
                    verdict.status,
                    verdict.filter,
                    verdict.p_hat,
                    verdict.p_upper,
                    verdict.reason,
                    details_str,
                )
            )

        processed_count += len(rows)
        if progress_callback and total_candidates > 0:
            frac = min(0.99, processed_count / total_candidates)
            progress_callback(frac, f"Evaluated {processed_count}/{total_candidates} candidates")

    # Compute summary counts
    status_counts = Counter(d[2] for d in decision_rows)
    filter_counts = Counter(d[3] for d in decision_rows)

    excluded_by_constraints = filter_counts.get("constraint", 0)
    after_constraints = max(0, total_candidates - excluded_by_constraints)
    excluded_statistical = (
        status_counts.get("tested_fail", 0)
        + sum(1 for d in decision_rows if d[2] == "excluded" and d[3] in ("model", "evidence"))
    )
    after_statistical = max(0, after_constraints - excluded_statistical)
    deprioritised = status_counts.get("deprioritised", 0)
    after_deprioritised = max(0, after_statistical - deprioritised)
    recommended = status_counts.get("recommended", 0)

    funnel = ScreeningFunnel(
        total=total_candidates,
        after_constraints=after_constraints,
        after_statistical=after_statistical,
        after_deprioritised=after_deprioritised,
        recommended=recommended,
    )

    summary = ScreeningSummary(
        total_candidates=total_candidates,
        funnel=funnel,
        counts_by_status=dict(status_counts),
        counts_by_filter=dict(filter_counts),
        expected_false_exclusions_bound=0.0,
    )

    # Persist in DB
    result = screening_repo.save_screening_run(
        conn=conn,
        run_id=run_id,
        study_id=study_id,
        candidate_set_id=cset.id,
        model_version_id=ctx.active_model.id if ctx.active_model else None,
        evidence_fingerprint=fingerprint,
        settings=settings,
        summary=summary,
        job_id=job_id,
        created_at=now,
        decision_rows=decision_rows,
        actor=actor,
    )

    if progress_callback:
        progress_callback(1.0, f"Completed screening for {total_candidates} candidates")

    return result
