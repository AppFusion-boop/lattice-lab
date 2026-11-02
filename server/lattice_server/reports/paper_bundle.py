"""Publication ZIP archive builder (PE-4).

Bundles manuscript, BibTeX citations, figures (vector PDF/SVG and 300 DPI PNG),
tables, Makefile, and supplementary DoE CSV datasets into a single self-contained ZIP archive.
"""

from __future__ import annotations

import csv
import io
import json
import sqlite3
import zipfile

from lattice_server.repo import (
    candidates as candidates_repo,
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
from lattice_server.reports.figures import generate_all_paper_figures
from lattice_server.reports.latex import build_paper_manuscript
from lattice_server.reports.paper_models import PaperCustomizationRequest
from lattice_server.reports.tables import (
    generate_funnel_table,
    generate_outcomes_table,
    generate_parameters_table,
    generate_recommended_table,
)


def generate_paper_zip_bundle(
    conn: sqlite3.Connection,
    study_id: str,
    req: PaperCustomizationRequest | None = None,
) -> bytes:
    """Builds a complete, self-contained scientific publication ZIP archive."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ValueError(f"Study '{study_id}' not found")

    paper = build_paper_manuscript(conn, study_id, req)
    params = parameters_repo.list_parameters(conn, study_id)
    outcomes = outcomes_repo.list_outcomes(conn, study_id)
    latest_run = screening_repo.get_latest_screening_run(conn, study_id)
    active_cset = candidates_repo.get_active_candidate_set(conn, study_id)

    # Top recommended candidates for Table 4
    recommended_candidates = []
    if active_cset and latest_run:
        paged = candidates_repo.list_candidates_paginated(
            conn=conn, study_id=study_id, status_filter="recommended", offset=0, limit=20
        )
        recommended_candidates = paged.items
        if not recommended_candidates:
            paged_open = candidates_repo.list_candidates_paginated(
                conn=conn, study_id=study_id, status_filter="open", offset=0, limit=20
            )
            recommended_candidates = paged_open.items

    # Render publication figures
    figures_data = generate_all_paper_figures(conn, study_id)

    # Tables strings
    tab1_tex = generate_parameters_table(params)
    tab2_tex = generate_outcomes_table(outcomes)
    tab3_tex = generate_funnel_table(study, latest_run)
    tab4_tex = generate_recommended_table(recommended_candidates, params)

    # Supplementary CSV: candidates with decision data
    cand_csv_buf = io.StringIO()
    cand_writer = csv.writer(cand_csv_buf)
    cand_headers = ["candidate_id", "idx"]
    for p in params:
        cand_headers.append(f"{p.key}" + (f" [{p.unit}]" if p.unit else ""))
    cand_headers.extend(["screening_status", "screening_filter", "p_hat", "p_upper", "reason"])
    cand_writer.writerow(cand_headers)

    if active_cset:
        cands = conn.execute(
            "SELECT id, idx, values_json FROM candidates WHERE candidate_set_id = ? ORDER BY idx ASC LIMIT 5000",
            (active_cset.id,),
        ).fetchall()

        decisions_by_cand = {}
        if latest_run:
            dec_rows = conn.execute(
                "SELECT candidate_id, status, filter, p_hat, p_upper, reason FROM decisions WHERE screening_run_id = ?",
                (latest_run.id,),
            ).fetchall()
            decisions_by_cand = {d["candidate_id"]: d for d in dec_rows}

        for c in cands:
            c_vals = json.loads(c["values_json"]) if c["values_json"] else {}
            dec = decisions_by_cand.get(c["id"])
            row_items = [c["id"], c["idx"] if c["idx"] is not None else ""]
            for p in params:
                row_items.append(c_vals.get(p.key, ""))

            if dec:
                row_items.extend([
                    dec["status"],
                    dec["filter"],
                    f"{dec['p_hat']:.4f}" if dec["p_hat"] is not None else "",
                    f"{dec['p_upper']:.4f}" if dec["p_upper"] is not None else "",
                    dec["reason"],
                ])
            else:
                row_items.extend(["open", "none", "", "", "No screening run"])
            cand_writer.writerow(row_items)

    candidates_csv_bytes = cand_csv_buf.getvalue().encode("utf-8")

    # README documentation
    readme_content = f"""# Scientific Research Paper Package
========================================================================
Study Name: {study.name}
Study ID:   {study.id}
Domain:     {study.domain}
Date:       {paper.generated_at}
Generator:  Lattice Lab 2.2.0 (Defensible Scientific Publication Engine)
Master Seed:{study.rng_seed}
========================================================================

## Package Structure
- `main.tex`: Master LaTeX manuscript (ready for Overleaf or local pdflatex).
- `references.bib`: BibTeX citations compiled from study provenance sources.
- `paper.md`: Pandoc-compatible markdown with YAML frontmatter.
- `figures/`: Vector (PDF & SVG) and high-resolution raster (300 DPI PNG) figures:
  * `fig1_funnel`: Candidate screening and statistical exclusion funnel.
  * `fig2_phase_space`: Parameter space feasibility and screening boundaries.
  * `fig3_sensitivity`: Global parameter sensitivity (Sobol indices).
  * `fig4_pareto`: Multi-objective Pareto optimal trade-off frontier.
- `tables/`: Formatted LaTeX booktabs tables (Parameters, Outcomes, Funnel, Recommended Batch).
- `supplementary/`:
  * `all_candidates.csv`: Complete design space candidate decisions and bounds.
  * `study_schema.json`: Complete study configuration for reproducibility.
- `Makefile` & `compile.sh`: One-click local compilation scripts.

## Compiling Locally
To compile the manuscript with pdflatex and bibtex:
```bash
make
# Or manually:
pdflatex main && bibtex main && pdflatex main && pdflatex main
```

## Overleaf Import
Simply upload this `.zip` file directly to Overleaf (New Project -> Upload Project)
and select pdfLaTeX as the compiler engine.
"""

    makefile_content = """# Makefile for compiling scientific manuscript
NAME=main

all: $(NAME).pdf

$(NAME).pdf: $(NAME).tex references.bib
	pdflatex $(NAME).tex
	bibtex $(NAME)
	pdflatex $(NAME).tex
	pdflatex $(NAME).tex

clean:
	rm -f *.aux *.bbl *.blg *.log *.out *.toc *.synctex.gz

distclean: clean
	rm -f $(NAME).pdf

.PHONY: all clean distclean
"""

    compile_sh_content = """#!/usr/bin/env bash
set -e
echo "Compiling scientific research paper..."
pdflatex -interaction=nonstopmode main.tex
bibtex main
pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex
echo "Compilation complete! Output: main.pdf"
"""

    study_schema_json = json.dumps(study.model_dump(), indent=2).encode("utf-8")

    # Construct in-memory ZIP
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.md", readme_content.encode("utf-8"))
        zf.writestr("Makefile", makefile_content.encode("utf-8"))
        zf.writestr("compile.sh", compile_sh_content.encode("utf-8"))
        zf.writestr("main.tex", paper.latex.encode("utf-8"))
        zf.writestr("references.bib", paper.bibtex.encode("utf-8"))
        zf.writestr("paper.md", paper.markdown.encode("utf-8"))

        # Figures
        for fig_name, formats in figures_data.items():
            for fmt_ext, data_bytes in formats.items():
                zf.writestr(f"figures/{fig_name}.{fmt_ext}", data_bytes)

        # Tables
        zf.writestr("tables/tab1_parameters.tex", tab1_tex.encode("utf-8"))
        zf.writestr("tables/tab2_outcomes.tex", tab2_tex.encode("utf-8"))
        zf.writestr("tables/tab3_funnel.tex", tab3_tex.encode("utf-8"))
        zf.writestr("tables/tab4_recommended.tex", tab4_tex.encode("utf-8"))

        # Supplementary
        zf.writestr("supplementary/study_schema.json", study_schema_json)
        zf.writestr("supplementary/all_candidates.csv", candidates_csv_bytes)

    return zip_buf.getvalue()
