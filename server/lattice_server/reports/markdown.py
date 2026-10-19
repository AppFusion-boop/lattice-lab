"""Defensible scientific report generator in Markdown format (P6-1, T4-4).

Strictly adheres to Hard Rule 7:
- Statistical exclusions are stated as 'excluded at X% confidence under model M given evidence D'.
- Never uses 'proved', 'guaranteed', or 'impossible' for statistical screening (reserved only for hard constraints).
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from typing import Any

from lattice_server.repo import (
    candidates as candidates_repo,
)
from lattice_server.repo import (
    constraints as constraints_repo,
)
from lattice_server.repo import (
    evidence as evidence_repo,
)
from lattice_server.repo import (
    models as models_repo,
)
from lattice_server.repo import (
    outcomes as outcomes_repo,
)
from lattice_server.repo import (
    parameters as parameters_repo,
)
from lattice_server.repo import (
    screening as screening_repo,
)
from lattice_server.repo import (
    studies as studies_repo,
)
from lattice_server.stats.dimensional import compute_buckingham_pi


def generate_study_report(conn: sqlite3.Connection, study_id: str) -> dict[str, Any]:
    """Generate a reproducible scientific study report from SQLite records."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ValueError(f"Study '{study_id}' not found")

    params = parameters_repo.list_parameters(conn, study_id)
    outcomes = outcomes_repo.list_outcomes(conn, study_id)
    constraints = constraints_repo.list_constraints(conn, study_id)
    models = models_repo.get_model_versions(conn, study_id)
    latest_model = models[0] if models else None
    latest_run = screening_repo.get_latest_screening_run(conn, study_id)
    evidence_list = evidence_repo.list_evidence(conn, study_id, include_retracted=False, limit=1000)
    valid_evi = [e for e in evidence_list if e.status == "valid"]
    active_cset = candidates_repo.get_active_candidate_set(conn, study_id)

    now = datetime.now(UTC).isoformat()
    conf_pct = round(study.confidence * 100)
    delta = round(1.0 - study.confidence, 4)

    lines: list[str] = []
    lines.append(f"# Scientific Screening & Experimental Priority Report: {study.name}")
    lines.append("")
    lines.append(f"- **Study ID:** `{study.id}`")
    lines.append(f"- **Domain:** `{study.domain}`")
    lines.append(f"- **Generated At:** `{now}`")
    lines.append(f"- **Deterministic Master RNG Seed:** `{study.rng_seed}`")
    lines.append("")

    # Section 1: Study Definition & Statistical Guarantee
    lines.append("## 1. Study Definition & Statistical Guarantee")
    if study.description:
        lines.append(study.description)
        lines.append("")
    lines.append(
        f"- **Exclusion Threshold ($\\tau$):** `{study.exclusion_threshold}` "
        f"(candidates with success probability $p < {study.exclusion_threshold}$ are targeted for exclusion)"
    )
    lines.append(
        f"- **Confidence Level ($1 - \\delta$):** `{conf_pct}%` ($\\delta = {delta}$)"
    )
    if latest_run:
        lines.append(
            f"- **Expected False-Exclusions Bound:** `{latest_run.summary.expected_false_exclusions_bound}` "
            f"across `{latest_run.summary.funnel.after_constraints}` constraint-feasible candidates"
        )
        lines.append(f"- **Evidence Fingerprint:** `{latest_run.evidence_fingerprint}`")
    lines.append("")

    # Section 2: Parameter Space & Buckingham Pi Dimensionless Groups
    lines.append("## 2. Parameter Space & Dimensional Reduction")
    lines.append("| Key | Label | Role | Kind | Unit | Specification |")
    lines.append("|---|---|---|---|---|---|")
    for p in params:
        lines.append(
            f"| `{p.key}` | {p.label} | `{p.role}` | `{p.kind}` | `{p.unit or '-'}` | `{p.spec}` |"
        )
    lines.append("")

    dim_res = compute_buckingham_pi(params, outcomes)
    lines.append("### Buckingham $\\Pi$ Dimensional Analysis")
    lines.append(f"- {dim_res.reduction_summary}")
    for pg in dim_res.pi_groups:
        lines.append(f"  - **{pg.name}:** `{pg.expression}`")
    lines.append("")

    # Section 3: Outcomes & Constraints
    lines.append("## 3. Outcomes & Constraints")
    lines.append("### Study Outcomes")
    lines.append("| Key | Label | Unit | Direction | Viability Criterion |")
    lines.append("|---|---|---|---|---|")
    for o in outcomes:
        crit_str = (
            f"{o.criterion.op} {o.criterion.value}"
            if o.criterion
            else "None"
        )
        lines.append(f"| `{o.key}` | {o.label} | `{o.unit or '-'}` | `{o.direction}` | `{crit_str}` |")
    lines.append("")

    lines.append("### Hard & Soft Constraints")
    if not constraints:
        lines.append("_No constraints configured._")
    else:
        lines.append("| Label | Kind | Expression | Penalty | Rationale |")
        lines.append("|---|---|---|---|---|")
        for c in constraints:
            pen = str(c.penalty) if c.kind == "soft" and c.penalty is not None else "—"
            lines.append(
                f"| {c.label} | `{c.kind}` | `{c.expression}` | {pen} | {c.rationale or '—'} |"
            )
    lines.append("")

    # Section 4: Model Versions & Validation Audit
    lines.append("## 4. Model Versions & Validation Audit")
    if not latest_model:
        lines.append("_No simulation model linked to this study._")
    else:
        lines.append(f"- **Active Model Version:** `v{latest_model.version}` (`{latest_model.id}`)")
        lines.append(f"- **Engine Version:** `{latest_model.engine_version}`")
        lines.append(f"- **Cryptographic Signature (SHA-256):** `{latest_model.signature}`")
        lines.append(f"- **Validation Status:** `{latest_model.validation_status}`")
        if latest_model.validation_json:
            vj = latest_model.validation_json
            lines.append(
                f"- **Empirical 90% Interval Coverage:** `{vj.get('empirical_coverage_90', 'N/A')}` "
                f"across `{vj.get('n_evidence_rows', 0)}` physical evidence rows"
            )
            if vj.get("accepted_by"):
                lines.append(
                    f"- **Human Validation Sign-Off:** Accepted by `{vj.get('accepted_by')}` "
                    f"at `{vj.get('accepted_at')}` — Reason: _{vj.get('acceptance_reason', '')}_"
                )
    lines.append("")

    # Section 5: Screening Funnel & Explainable Exclusion Breakdown (Hard Rule 7)
    lines.append("## 5. Screening Funnel & Exclusion Breakdown")
    if not latest_run:
        lines.append("_No screening run has been executed yet._")
    else:
        f = latest_run.summary.funnel
        model_label = f"model v{latest_model.version}" if latest_model else "empirical evidence model"
        fp_short = latest_run.evidence_fingerprint[:12] if latest_run.evidence_fingerprint else "none"
        lines.append(f"- **Total Candidate Space:** `{f.total}`")
        lines.append(
            f"- **After Hard Constraints:** `{f.after_constraints}` "
            f"(`{f.total - f.after_constraints}` excluded because candidate violates constraint)"
        )
        lines.append(
            f"- **After Statistical Screening:** `{f.after_statistical}` "
            f"(`{f.after_constraints - f.after_statistical}` excluded at {conf_pct}% confidence "
            f"under {model_label} given evidence `{fp_short}`)"
        )
        lines.append(
            f"- **After Unvalidated / Dominance Deprioritisation:** `{f.after_deprioritised}` "
            f"(`{f.after_statistical - f.after_deprioritised}` deprioritised)"
        )
        lines.append(f"- **Recommended Priority Experiments:** `{f.recommended}`")
        lines.append("")
        lines.append("### Counts by Filter")
        for flt, cnt in sorted(latest_run.summary.counts_by_filter.items()):
            lines.append(f"- `{flt}`: `{cnt}` candidates")
    lines.append("")

    # Section 6: Empirical Evidence Summary
    lines.append("## 6. Physical Evidence Summary")
    lines.append(
        f"- **Total Non-Retracted Evidence Rows:** `{len(evidence_list)}` "
        f"(`{len(valid_evi)}` valid measurements)"
    )
    lines.append("")

    # Section 7: Recommended Next Batch & Open Candidates
    lines.append("## 7. Priority Candidates for Experimental Execution")
    if active_cset and latest_run:
        paged = candidates_repo.list_candidates_paginated(
            conn=conn,
            study_id=study_id,
            status_filter="recommended",
            offset=0,
            limit=15,
        )
        if paged.total == 0:
            paged = candidates_repo.list_candidates_paginated(
                conn=conn,
                study_id=study_id,
                status_filter="open",
                offset=0,
                limit=15,
            )
        if paged.items:
            lines.append("| Candidate # | Controlled Values | Status | Filter | Reason |")
            lines.append("|---|---|---|---|---|")
            for c in paged.items:
                st = c.decision.status if c.decision else "open"
                flt = c.decision.filter if c.decision else "none"
                rsn = c.decision.reason if c.decision else "—"
                lines.append(f"| `#{c.idx}` | `{c.values}` | `{st}` | `{flt}` | {rsn} |")
        else:
            lines.append("_No open or recommended candidates remaining._")
    else:
        lines.append("_Generate candidates and run screening to populate priority list._")
    lines.append("")

    # Section 8: Auto-Generated Methodological Limitations
    lines.append("## 8. Methodological Limitations & Assumptions")
    limitations: list[str] = []
    if not latest_model:
        limitations.append(
            "No physics or mechanistic Flow Model is currently linked; screening relies solely on algebraic constraints and empirical evidence."
        )
    elif latest_model.validation_status != "validated":
        limitations.append(
            f"Active Flow Model (v{latest_model.version}) is currently unvalidated against physical evidence; per Hard Rule 6, model predictions only deprioritise candidates and never exclude them."
        )
    if len(valid_evi) < 8:
        limitations.append(
            f"Small empirical sample size (n = {len(valid_evi)} valid evidence rows < 8 required for split-conformal Gaussian Process surrogate fitting)."
        )
    if len([o for o in outcomes if o.criterion is not None]) > 1:
        limitations.append(
            "Multi-outcome success probabilities evaluate joint satisfaction across draws; surrogate predictions evaluate marginal outcome criteria conservatively via minimum bound."
        )
    limitations.append(
        f"Statistical exclusions carry a per-candidate one-sided type-I error bound of delta = {delta} ({conf_pct}% confidence) conditioned on the specified uncertain parameter distributions."
    )
    for lim in limitations:
        lines.append(f"- {lim}")
    lines.append("")

    markdown_text = "\n".join(lines)
    return {
        "study_id": study.id,
        "generated_at": now,
        "markdown": markdown_text,
    }
