"""Tests for Scientific Research Paper Export System (PE-6)."""

from __future__ import annotations

import io
import sqlite3
import zipfile

from fastapi.testclient import TestClient

from lattice_server.screening.pipeline import run_screening_pipeline


def test_paper_generation_obeys_hard_rule_7(
    client: TestClient, db_conn: sqlite3.Connection
) -> None:
    """Verifies that generated scientific paper strictly adheres to Hard Rule 7."""
    res_study = client.post(
        "/api/v1/studies",
        json={"name": "Microfluidic Droplet Screening", "domain": "microfluidics", "confidence": 0.95},
    )
    assert res_study.status_code in (200, 201)
    sid = res_study.json()["id"]

    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "flow_rate",
            "label": "Flow Rate",
            "unit": "ul/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10.0, "max": 100.0, "values": [20.0, 50.0, 80.0]},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "viscosity",
            "label": "Continuous Phase Viscosity",
            "unit": "mPa.s",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1.0, "max": 10.0, "values": [1.5, 5.0]},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/outcomes",
        json={
            "key": "droplet_diameter",
            "label": "Droplet Diameter",
            "unit": "um",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 50.0},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={"label": "Max Pressure Limit", "expression": "flow_rate <= 70.0", "kind": "hard", "rationale": "Channel delamination threshold"},
    )
    client.post(f"/api/v1/studies/{sid}/candidate-sets", json={"method": "grid", "settings": {}})
    run_screening_pipeline(conn=db_conn, study_id=sid)

    # 1. Test GET /paper
    res_paper = client.get(f"/api/v1/studies/{sid}/paper")
    assert res_paper.status_code == 200
    data = res_paper.json()

    assert "Microfluidic Droplet Screening" in data["title"]
    assert len(data["sections"]) == 6
    assert data["master_seed"] > 0
    assert "references.bib" not in data["bibtex"]  # BibTeX itself contains entries
    assert "buckingham" in data["bibtex"].lower()

    # Verify Hard Rule 7: statistical exclusion wording must never claim "proved" or "guaranteed" or "impossible"
    latex_lower = data["latex"].lower()
    assert "proved" not in latex_lower
    assert "impossible" not in latex_lower
    assert "guaranteed" not in latex_lower
    assert r"excluded at 95\%" in latex_lower or "excluded at 95%" in latex_lower

    md_lower = data["markdown"].lower()
    assert "proved" not in md_lower
    assert "impossible" not in md_lower
    assert "excluded at 95%" in md_lower


def test_paper_bibtex_and_customization(
    client: TestClient, db_conn: sqlite3.Connection
) -> None:
    """Verifies author metadata customization and BibTeX provenance serialization."""
    res_study = client.post(
        "/api/v1/studies",
        json={"name": "Acoustic Levitation Study", "domain": "acoustics", "confidence": 0.90},
    )
    sid = res_study.json()["id"]

    # Add a literature source
    client.post(
        f"/api/v1/studies/{sid}/sources",
        json={
            "kind": "literature",
            "citation": "Rayleigh, Lord. (1902). On the pressure of vibrations. Phil. Mag.",
            "doi": "10.1080/14786440209462769",
            "notes": "Classical radiation pressure formula",
        },
    )

    # Preview with custom author
    req_body = {
        "title": "Acoustic Radiation Trapping Under Conformal Bounds",
        "authors": [
            {
                "name": "Prof. Elena Rostova",
                "affiliation": "Institute for Wave Physics",
                "email": "rostova@wave.ac.uk",
                "orcid": "0000-0003-9876-5432",
                "is_corresponding": True,
            }
        ],
        "template": "revtex",
        "column_layout": "twocolumn",
        "include_figures": True,
        "abstract_override": "Custom author abstract on acoustic levitation stability manifolds.",
        "section_overrides": {
            "intro": "In this investigation of {{study_name}}, a cohort of {{n_candidates}} configurations was analyzed at {{confidence}} confidence (see {{fig:funnel}}).",
        },
    }
    res_prev = client.post(f"/api/v1/studies/{sid}/paper/preview", json=req_body)
    assert res_prev.status_code == 200
    pdata = res_prev.json()
    assert pdata["title"] == "Acoustic Radiation Trapping Under Conformal Bounds"
    assert pdata["abstract"] == "Custom author abstract on acoustic levitation stability manifolds."
    assert "Elena Rostova" in pdata["latex"]
    assert "Rayleigh" in pdata["bibtex"]

    # Verify dynamic token expansion in author section override
    intro_sec = next(s for s in pdata["sections"] if s["id"] == "intro")
    assert "90%" in intro_sec["content_markdown"]
    assert "Figure 1" in intro_sec["content_markdown"]
    assert r"90\%" in intro_sec["content_latex"] or "90%" in intro_sec["content_latex"]
    assert r"\ref{fig:funnel}" in intro_sec["content_latex"]


def test_paper_figures_and_zip_bundle(
    client: TestClient, db_conn: sqlite3.Connection
) -> None:
    """Verifies that vector/raster figures and full publication ZIP bundle compile without corruption."""
    res_study = client.post(
        "/api/v1/studies",
        json={"name": "Photonic Crystal Optimization", "domain": "optics", "confidence": 0.95},
    )
    sid = res_study.json()["id"]

    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "lattice_constant",
            "label": "Lattice Constant (a)",
            "unit": "nm",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 200.0, "max": 600.0, "values": [300.0, 450.0]},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/outcomes",
        json={
            "key": "bandgap_width",
            "label": "Photonic Bandgap Width",
            "unit": "eV",
            "kind": "continuous",
            "direction": "maximize",
            "criterion": {"op": ">", "value": 0.25},
        },
    )
    client.post(f"/api/v1/studies/{sid}/candidate-sets", json={"method": "grid", "settings": {}})
    run_screening_pipeline(conn=db_conn, study_id=sid)

    # Test individual figure endpoints
    for fig_name in ("funnel", "phase_space", "sensitivity", "pareto"):
        res_png = client.get(f"/api/v1/studies/{sid}/paper/figures/{fig_name}.png")
        assert res_png.status_code == 200
        assert "image/png" in res_png.headers["content-type"]
        assert len(res_png.content) > 1000

        res_svg = client.get(f"/api/v1/studies/{sid}/paper/figures/{fig_name}.svg")
        assert res_svg.status_code == 200
        assert "image/svg+xml" in res_svg.headers["content-type"]
        assert len(res_svg.content) > 1000

    # Test single LaTeX file download
    res_tex = client.get(f"/api/v1/studies/{sid}/paper.tex")
    assert res_tex.status_code == 200
    assert "text/x-tex" in res_tex.headers["content-type"]
    assert "Photonic Crystal Optimization" in res_tex.text

    # Test full publication ZIP package
    res_zip = client.get(f"/api/v1/studies/{sid}/paper.zip")
    assert res_zip.status_code == 200
    assert "application/zip" in res_zip.headers["content-type"]
    assert f'filename="paper_photonic_crystal_optimization_{sid[:8]}_bundle.zip"' in res_zip.headers["content-disposition"]

    # Verify ZIP file structure and readability
    zip_bytes = io.BytesIO(res_zip.content)
    with zipfile.ZipFile(zip_bytes, "r") as zf:
        namelist = zf.namelist()
        assert "main.tex" in namelist
        assert "references.bib" in namelist
        assert "paper.md" in namelist
        assert "README.md" in namelist
        assert "Makefile" in namelist
        assert "compile.sh" in namelist
        assert "tables/tab1_parameters.tex" in namelist
        assert "tables/tab2_outcomes.tex" in namelist
        assert "tables/tab3_funnel.tex" in namelist
        assert "tables/tab4_recommended.tex" in namelist
        assert "figures/fig1_funnel.png" in namelist
        assert "figures/fig1_funnel.pdf" in namelist
        assert "figures/fig2_phase_space.png" in namelist
        assert "supplementary/study_schema.json" in namelist
        assert "supplementary/all_candidates.csv" in namelist

        # Inspect main.tex from inside ZIP
        tex_content = zf.read("main.tex").decode("utf-8")
        assert "Photonic Crystal Optimization" in tex_content
        assert r"\documentclass" in tex_content
        assert r"\bibliography{references}" in tex_content


def test_paper_not_found_and_invalid_formats(client: TestClient) -> None:
    """Verifies proper 404 and 400 error codes for missing studies and invalid formats."""
    res_404 = client.get("/api/v1/studies/nonexistent_study_id/paper")
    assert res_404.status_code == 404

    # Create temporary study
    res_s = client.post("/api/v1/studies", json={"name": "Temp Study", "domain": "physics"})
    sid = res_s.json()["id"]

    res_fig_400 = client.get(f"/api/v1/studies/{sid}/paper/figures/funnel.exe")
    assert res_fig_400.status_code == 400

    res_fig_404 = client.get(f"/api/v1/studies/{sid}/paper/figures/nonexistent_fig.png")
    assert res_fig_404.status_code == 404


def test_unvalidated_model_rule_6_disclosure(client: TestClient) -> None:
    """Verifies Hard Rule 6: Unvalidated model versions are disclosed as deprioritising only."""
    res_s = client.post("/api/v1/studies", json={"name": "Unvalidated Model Study", "domain": "physics"})
    sid = res_s.json()["id"]

    # Register an unvalidated model
    res_m = client.post(
        f"/api/v1/studies/{sid}/models",
        json={
            "project": {"nodes": [], "edges": []},
            "parameter_bindings": [],
            "outcome_bindings": [],
            "notes": "Preliminary unvalidated physics model",
        },
    )
    assert res_m.status_code == 201

    res = client.get(f"/api/v1/studies/{sid}/paper")
    assert res.status_code == 200
    data = res.json()
    disc_sec = next(s for s in data["sections"] if s["id"] == "discussion")
    assert "Hard Rule 6" in disc_sec["content_markdown"] or "deprioritised" in disc_sec["content_markdown"]


