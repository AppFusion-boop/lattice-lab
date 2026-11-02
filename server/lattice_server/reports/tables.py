"""LaTeX booktabs tables formatter (PE-3).

Generates clean, publication-ready LaTeX tables strictly adhering to:
- Hard Rule 1: Values strictly from SQLite records.
- Hard Rule 7: Exclusion wording never uses forbidden claim words.
"""

from __future__ import annotations

from lattice_server.reports.bibtex import sanitize_latex_text
from lattice_server.schemas import (
    CandidateResponse,
    OutcomeResponse,
    ParameterResponse,
    ScreeningRunResponse,
    StudyResponse,
)


def generate_parameters_table(params: list[ParameterResponse]) -> str:
    """Generate Table 1: Parameters, roles, physical units, and bounds in LaTeX booktabs format."""
    lines = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Parameter specifications, physical units, and sampling bounds.}",
        r"\label{tab:parameters}",
        r"\begin{tabular}{llllll}",
        r"\toprule",
        r"\textbf{Key} & \textbf{Label} & \textbf{Role} & \textbf{Kind} & \textbf{Unit} & \textbf{Specification} \\",
        r"\midrule",
    ]

    for p in params:
        key = sanitize_latex_text(p.key)
        label = sanitize_latex_text(p.label)
        role = sanitize_latex_text(p.role)
        kind = sanitize_latex_text(p.kind)
        unit = sanitize_latex_text(p.unit) if p.unit else "---"

        spec_str = ""
        if isinstance(p.spec, dict):
            if "min" in p.spec and "max" in p.spec:
                spec_str = f"[{p.spec['min']}, {p.spec['max']}]"
            elif "values" in p.spec:
                spec_str = f"\\{{{', '.join(str(v) for v in p.spec['values'][:3])}\\}}"
            else:
                spec_str = str(p.spec)
        else:
            spec_str = str(p.spec)
        spec_str = sanitize_latex_text(spec_str)

        lines.append(f"{key} & {label} & {role} & {kind} & {unit} & {spec_str} \\\\")

    lines.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])
    return "\n".join(lines)


def generate_outcomes_table(outcomes: list[OutcomeResponse]) -> str:
    """Generate Table 2: Study physical outcomes and viability criteria."""
    lines = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Target physical outcomes and experimental viability criteria.}",
        r"\label{tab:outcomes}",
        r"\begin{tabular}{lllll}",
        r"\toprule",
        r"\textbf{Key} & \textbf{Label} & \textbf{Unit} & \textbf{Direction} & \textbf{Viability Criterion} \\",
        r"\midrule",
    ]

    for o in outcomes:
        key = sanitize_latex_text(o.key)
        label = sanitize_latex_text(o.label)
        unit = sanitize_latex_text(o.unit) if o.unit else "---"
        direction = sanitize_latex_text(o.direction)

        crit_str = "None"
        if o.criterion:
            crit_str = f"{o.criterion.op} {o.criterion.value}"
        crit_str = sanitize_latex_text(crit_str)

        lines.append(f"{key} & {label} & {unit} & {direction} & {crit_str} \\\\")

    lines.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])
    return "\n".join(lines)


def generate_funnel_table(study: StudyResponse, latest_run: ScreeningRunResponse | None) -> str:
    """Generate Table 3: Screening Funnel accounting adhering strictly to Hard Rule 7."""
    lines = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Progressive candidate down-selection and statistical exclusion audit.}",
        r"\label{tab:funnel}",
        r"\begin{tabular}{lrrl}",
        r"\toprule",
        r"\textbf{Screening Stage} & \textbf{Count} & \textbf{Retention (\%)} & \textbf{Exclusion Criterion / Model Guarantee} \\",
        r"\midrule",
    ]

    if not latest_run:
        lines.append(r"Initial DoE Space & --- & 100.0\% & Baseline design space \\")
        lines.append(r"\multicolumn{4}{c}{\textit{No screening run has been executed yet.}} \\")
    else:
        f = latest_run.summary.funnel
        tot = f.total if f.total > 0 else 1
        conf_pct = round(study.confidence * 100)

        p_feas = (f.after_constraints / tot) * 100
        p_stat = (f.after_statistical / tot) * 100
        p_dep = (f.after_deprioritised / tot) * 100
        p_rec = (f.recommended / tot) * 100

        lines.append(f"Total DoE Space & {f.total} & 100.0\\% & Initial parameter hypercube sampling \\\\")
        lines.append(
            f"After Hard Constraints & {f.after_constraints} & {p_feas:.1f}\\% & "
            f"Excluded candidate violates physical or geometric boundary \\\\"
        )
        lines.append(
            f"After Statistical Screening & {f.after_statistical} & {p_stat:.1f}\\% & "
            f"Excluded at {conf_pct}\\% confidence under surrogate model \\\\"
        )
        lines.append(
            f"After Deprioritisation & {f.after_deprioritised} & {p_dep:.1f}\\% & "
            f"Deprioritised by unvalidated predictors or Pareto dominance \\\\"
        )
        lines.append(
            f"Recommended Batch & {f.recommended} & {p_rec:.1f}\\% & "
            f"Priority configurations for experimental bench execution \\\\"
        )

    lines.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])
    return "\n".join(lines)


def generate_recommended_table(
    candidates: list[CandidateResponse], params: list[ParameterResponse]
) -> str:
    """Generate Table 4: Recommended candidate batch with controlled values and decision reasons."""
    ctrl_params = [p for p in params if p.role == "controlled"]
    if not ctrl_params:
        ctrl_params = params[:3]

    param_headers = " & ".join(f"\\textbf{{{sanitize_latex_text(p.key)}}}" for p in ctrl_params)
    col_align = "lr" + "l" * len(ctrl_params) + "l"

    lines = [
        r"\begin{table*}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Top-priority candidate configurations recommended for laboratory validation.}",
        r"\label{tab:recommended}",
        f"\\begin{{tabular}}{{{col_align}}}",
        r"\toprule",
        f"\\textbf{{ID}} & \\textbf{{Idx}} & {param_headers} & \\textbf{{Decision / Reason}} \\\\",
        r"\midrule",
    ]

    if not candidates:
        lines.append(f"\\multicolumn{{{2 + len(ctrl_params) + 1}}}{{c}}{{\\textit{{No candidates currently recommended.}}}} \\\\")
    else:
        for c in candidates[:15]:
            cid = sanitize_latex_text(c.id[:8])
            idx_str = str(c.idx) if c.idx is not None else "---"
            val_strs: list[str] = []
            for p in ctrl_params:
                v = c.values.get(p.key) if c.values else ""
                val_strs.append(sanitize_latex_text(str(v) if v is not None else "---"))

            reason = c.decision.reason if c.decision and c.decision.reason else "Survives statistical down-selection"
            reason_clean = sanitize_latex_text(reason[:45] + ("..." if len(reason) > 45 else ""))

            row_str = f"{cid} & {idx_str} & " + " & ".join(val_strs) + f" & {reason_clean} \\\\"
            lines.append(row_str)

    lines.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table*}",
    ])
    return "\n".join(lines)

