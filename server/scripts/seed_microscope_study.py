#!/usr/bin/env python3
"""Seed an end-to-end Transmissive Optical Microscope Study into the database.

This study demonstrates:
1. Microfluidic emulsion & drug-delivery microcapsule quality-by-design screening.
2. Direct coupling between physical specimen parameters and the Digital Transmissive Microscope node.
3. Multi-objective screening: Beer-Lambert light transmittance, optical density, Abbe diffraction resolution, and Michelson edge contrast under focal stage drift.
4. Ground-truth benchmark evidence records from calibrated reference slides.
5. Automated Monte Carlo screening, constraint classification, and Pareto ranking.
"""

from __future__ import annotations

import math

from fastapi.testclient import TestClient

from lattice_server import db
from lattice_server.main import app
from lattice_server.screening.pipeline import run_screening_pipeline


def _build_microscope_project() -> dict:
    """Build a complete v3 Flow Project with formula inputs, transmissiveMicroscope, microscopeDisplay, and Oscilloscope."""
    nodes = [
        {
            "id": "n_diam",
            "kind": "formula",
            "label": "Feature Diam (µm)",
            "position": {"x": 60, "y": 80},
            "params": {"expression": "a", "a": 28.0, "b": 0.0, "unit": "µm"},
        },
        {
            "id": "n_frac",
            "kind": "formula",
            "label": "Volume Fraction (%)",
            "position": {"x": 60, "y": 200},
            "params": {"expression": "a", "a": 18.0, "b": 0.0, "unit": "%"},
        },
        {
            "id": "n_thick",
            "kind": "formula",
            "label": "Specimen Thickness (µm)",
            "position": {"x": 60, "y": 320},
            "params": {"expression": "a", "a": 50.0, "b": 0.0, "unit": "µm"},
        },
        {
            "id": "n_conc",
            "kind": "formula",
            "label": "Dye Concentration (mol/m³)",
            "position": {"x": 60, "y": 440},
            "params": {"expression": "a", "a": 10.0, "b": 0.0, "unit": ""},
        },
        {
            "id": "n_focus",
            "kind": "formula",
            "label": "Focus Offset Δz (µm)",
            "position": {"x": 60, "y": 560},
            "params": {"expression": "a", "a": 0.0, "b": 0.0, "unit": "µm"},
        },
        {
            "id": "n_microscope",
            "kind": "transmissiveMicroscope",
            "label": "Transmissive Microscope",
            "position": {"x": 420, "y": 180},
            "params": {
                "sourceMode": "Coupled Physical Inputs",
                "illuminationMode": "Brightfield",
                "magnification": 40.0,
                "numericalAperture": 0.65,
                "wavelengthNm": 550.0,
                "focusOffsetUm": 0.0,
                "immersionIndex": 1.0,
                "exposure": 1.0,
                "gridN": 80.0,
                "matrixThicknessUm": 50.0,
                "matrixAttenInvUm": 0.003,
                "featureAttenInvUm": 0.045,
                "matrixRefractiveIndex": 1.333,
                "featureRefractiveIndex": 1.48,
                "featureDiameterUm": 28.0,
                "featureVolumeFractionPct": 18.0,
                "molarAbsorptivityM2Mol": 85.0,
                "reticleFrequencyLpMm": 40.0,
                "seed": 42.0,
            },
        },
        {
            "id": "n_display",
            "kind": "microscopeDisplay",
            "label": "Micrograph Viewport",
            "position": {"x": 860, "y": 100},
            "params": {},
        },
        {
            "id": "n_scope",
            "kind": "scope",
            "label": "Centerline Scan Profile",
            "position": {"x": 860, "y": 280},
            "params": {},
        },
    ]

    edges = [
        {"id": "e_diam", "source": "n_diam", "sourceHandle": "result", "target": "n_microscope", "targetHandle": "featureDiameter"},
        {"id": "e_frac", "source": "n_frac", "sourceHandle": "result", "target": "n_microscope", "targetHandle": "volumeFraction"},
        {"id": "e_thick", "source": "n_thick", "sourceHandle": "result", "target": "n_microscope", "targetHandle": "thickness"},
        {"id": "e_conc", "source": "n_conc", "sourceHandle": "result", "target": "n_microscope", "targetHandle": "concentration"},
        {"id": "e_focus", "source": "n_focus", "sourceHandle": "result", "target": "n_microscope", "targetHandle": "focusOffset"},
        {"id": "e_view", "source": "n_microscope", "sourceHandle": "micrograph", "target": "n_display", "targetHandle": "micrograph"},
        {"id": "e_scan", "source": "n_microscope", "sourceHandle": "lineProfile", "target": "n_scope", "targetHandle": "ch1"},
    ]

    return {
        "version": 3,
        "name": "Microcapsule Transmissive Optical Analysis",
        "duration": 5.0,
        "sampleRate": 50.0,
        "nodes": nodes,
        "edges": edges,
        "tools": [],
    }


def main() -> str:
    client = TestClient(app)
    conn = db.connect()

    study_name = "Microfluidic Emulsion & Microcapsule Quality (Transmissive Microscopy)"

    existing = conn.execute(
        "SELECT id, name FROM studies WHERE name = ?;", (study_name,)
    ).fetchone()

    if existing:
        study_id = str(existing["id"])
        print(f"Updating existing Microscope study: {study_id}")
    else:
        study_res = client.post(
            "/api/v1/studies",
            json={
                "name": study_name,
                "description": (
                    "Analytical quality-by-design screen for drug-delivery microcapsules using digital transmissive microscopy. "
                    "Simulates Beer–Lambert optical transmission, optical density, Abbe diffraction resolution limit, "
                    "and Michelson boundary contrast under optical stage defocus drift."
                ),
                "domain": "optical_microscopy",
                "exclusion_threshold": 0.05,
                "confidence": 0.95,
                "rng_seed": 424242,
                "budget": 6000.0,
            },
        )
        assert study_res.status_code in (200, 201), f"Failed creating study: {study_res.text}"
        study_id = study_res.json()["id"]
        print(f"Created Microscope study: {study_id}")

        # Parameters
        params = [
            {"key": "feature_diameter_um", "label": "Microcapsule Mean Diameter", "unit": "µm", "role": "controlled", "kind": "continuous", "spec": {"min": 12.0, "max": 65.0}},
            {"key": "volume_fraction_pct", "label": "Dispersed Volume Fraction", "unit": "%", "role": "controlled", "kind": "continuous", "spec": {"min": 5.0, "max": 40.0}},
            {"key": "specimen_thickness_um", "label": "Flow Cell / Slide Depth", "unit": "µm", "role": "controlled", "kind": "continuous", "spec": {"min": 25.0, "max": 140.0}},
            {"key": "chromophore_conc_mol_m3", "label": "Chromophore Dye Concentration", "unit": "", "role": "controlled", "kind": "continuous", "spec": {"min": 0.0, "max": 50.0}},
            {"key": "focus_drift_um", "label": "Microscope Z-Stage Thermal Drift", "unit": "µm", "role": "uncertain", "kind": "continuous", "spec": {"min": -15.0, "max": 15.0, "distribution": {"type": "normal", "mean": 0.0, "sd": 3.0}}},
            {"key": "objective_mag", "label": "Objective Magnification", "unit": "×", "role": "fixed", "kind": "continuous", "spec": {"min": 10.0, "max": 100.0, "value": 40.0}},
        ]
        for p in params:
            r = client.post(f"/api/v1/studies/{study_id}/parameters", json=p)
            assert r.status_code in (200, 201), f"Failed adding parameter {p['key']}: {r.text}"

        # Cost expression
        client.patch(
            f"/api/v1/studies/{study_id}",
            json={"cost_expression": "120 + 2.5 * specimen_thickness_um + 8.0 * chromophore_conc_mol_m3"},
        )

        # Outcomes
        outcomes = [
            {
                "key": "transmittance_pct",
                "label": "Mean Light Transmittance",
                "unit": "%",
                "kind": "continuous",
                "direction": "maximize",
                "criterion": {"op": ">=", "value": 35.0},
            },
            {
                "key": "optical_density",
                "label": "Mean Optical Density",
                "unit": "OD",
                "kind": "continuous",
                "direction": "minimize",
                "criterion": {"op": "<=", "value": 0.48},
            },
            {
                "key": "michelson_contrast",
                "label": "Michelson Feature Contrast",
                "unit": "1",
                "kind": "continuous",
                "direction": "maximize",
                "criterion": {"op": ">=", "value": 0.45},
            },
            {
                "key": "abbe_resolution_um",
                "label": "Abbe Diffraction Resolution Limit",
                "unit": "µm",
                "kind": "continuous",
                "direction": "minimize",
                "criterion": {"op": "<=", "value": 0.55},
            },
        ]
        for oc in outcomes:
            r = client.post(f"/api/v1/studies/{study_id}/outcomes", json=oc)
            assert r.status_code in (200, 201), f"Failed adding outcome {oc['key']}: {r.text}"

        # Constraints
        client.post(
            f"/api/v1/studies/{study_id}/constraints",
            json={
                "label": "Focal Depth Limit",
                "expression": "specimen_thickness_um <= 100.0",
                "kind": "hard",
                "rationale": "High-magnification objective working distance limit (illustrative)",
            },
        )
        client.post(
            f"/api/v1/studies/{study_id}/constraints",
            json={
                "label": "Droplet Jamming & Crowding Limit",
                "expression": "volume_fraction_pct <= 35.0",
                "kind": "hard",
                "rationale": "Microcapsule volume fraction above 35% causes dense multi-layer overlap and optical scattering extinction",
            },
        )
        client.post(
            f"/api/v1/studies/{study_id}/constraints",
            json={
                "label": "Target Capsule Size Preference",
                "expression": "feature_diameter_um <= 42.0",
                "kind": "soft",
                "penalty": 2.0,
                "rationale": "Target microcapsule diameter under 42 µm ensures narrow monodispersity and capillary flow",
            },
        )

        # Candidate Set (Sobol DoE 32 samples)
        client.post(f"/api/v1/studies/{study_id}/candidate-sets", json={"method": "sobol", "settings": {"n": 32}})

        # Ground-truth evidence points (benchmark reference hemocytometer / spectrophotometer trials)
        def _simulate_bench_run(d_um: float, phi_pct: float, h_um: float, c_mol: float) -> tuple[float, float, float]:
            h_mat = max(0.1, h_um * (1.0 - phi_pct / 100.0))
            h_feat = max(0.0, h_um * (phi_pct / 100.0))
            tau = 0.003 * h_mat + 0.045 * h_feat + math.log(10) * 85.0 * c_mol * h_um * 1e-6
            t_pct = round(math.exp(-tau) * 100.0, 2)
            od = round(-math.log10(max(t_pct / 100.0, 1e-6)), 4)
            contrast = round(min(0.95, max(0.2, 0.55 + 0.008 * d_um - 0.005 * phi_pct)), 4)
            return t_pct, od, contrast

        benchmarks = [
            ({"feature_diameter_um": 25.0, "volume_fraction_pct": 15.0, "specimen_thickness_um": 50.0, "chromophore_conc_mol_m3": 5.0}),
            ({"feature_diameter_um": 30.0, "volume_fraction_pct": 20.0, "specimen_thickness_um": 60.0, "chromophore_conc_mol_m3": 10.0}),
            ({"feature_diameter_um": 35.0, "volume_fraction_pct": 25.0, "specimen_thickness_um": 80.0, "chromophore_conc_mol_m3": 15.0}),
            ({"feature_diameter_um": 20.0, "volume_fraction_pct": 10.0, "specimen_thickness_um": 40.0, "chromophore_conc_mol_m3": 0.0}),
            ({"feature_diameter_um": 40.0, "volume_fraction_pct": 30.0, "specimen_thickness_um": 75.0, "chromophore_conc_mol_m3": 20.0}),
            ({"feature_diameter_um": 50.0, "volume_fraction_pct": 35.0, "specimen_thickness_um": 90.0, "chromophore_conc_mol_m3": 25.0}),
        ]

        for vals in benchmarks:
            t_pct, od, contrast = _simulate_bench_run(
                vals["feature_diameter_um"],
                vals["volume_fraction_pct"],
                vals["specimen_thickness_um"],
                vals["chromophore_conc_mol_m3"],
            )
            client.post(
                f"/api/v1/studies/{study_id}/evidence",
                json={
                    "kind": "lab",
                    "values": vals,
                    "outcomes": {
                        "transmittance_pct": t_pct,
                        "optical_density": od,
                        "michelson_contrast": contrast,
                        "abbe_resolution_um": 0.516,
                    },
                    "status": "valid",
                    "notes": "Calibrated spectrophotometer & digital microscopy bench reference (illustrative)",
                },
            )

    # Create v3 Model Version with the complete flow project & bindings
    mv_res = client.post(
        f"/api/v1/studies/{study_id}/models",
        json={
            "project": _build_microscope_project(),
            "parameter_bindings": [
                {"parameter_key": "feature_diameter_um", "node_id": "n_diam", "param_key": "a", "param_unit": "µm", "field_unit": "µm"},
                {"parameter_key": "volume_fraction_pct", "node_id": "n_frac", "param_key": "a", "param_unit": "%", "field_unit": "%"},
                {"parameter_key": "specimen_thickness_um", "node_id": "n_thick", "param_key": "a", "param_unit": "µm", "field_unit": "µm"},
                {"parameter_key": "chromophore_conc_mol_m3", "node_id": "n_conc", "param_key": "a"},
                {"parameter_key": "focus_drift_um", "node_id": "n_focus", "param_key": "a", "param_unit": "µm", "field_unit": "µm"},
                {"parameter_key": "objective_mag", "not_in_model": True},
            ],
            "outcome_bindings": [
                {"outcome_key": "transmittance_pct", "node_id": "n_microscope", "port": "transmittance", "reducer": "value"},
                {"outcome_key": "optical_density", "node_id": "n_microscope", "port": "opticalDensity", "reducer": "value"},
                {"outcome_key": "michelson_contrast", "node_id": "n_microscope", "port": "contrast", "reducer": "value"},
                {"outcome_key": "abbe_resolution_um", "node_id": "n_microscope", "port": "resolution", "reducer": "value"},
            ],
            "notes": "Full digital transmissive microscope flow model simulating Beer-Lambert attenuation, Abbe PSF diffraction, and Berek depth of field.",
        },
    )
    assert mv_res.status_code in (200, 201), f"Failed creating model version: {mv_res.text}"
    model_id = mv_res.json()["id"]

    # Validate against evidence points and accept
    client.post(f"/api/v1/studies/{study_id}/models/{model_id}/validate", json={"n_draws": 25})
    client.post(
        f"/api/v1/models/{model_id}/accept-validation",
        json={"reason": "Model matches benchmark spectrophotometer transmission and optical density trials within ±10% tolerance (illustrative)"},
    )

    # Run screening pipeline with Monte Carlo draws
    print("Running screening pipeline for 32 candidates...")
    run_screening_pipeline(conn=conn, study_id=study_id, settings={"mc_draws": 30})
    conn.commit()

    # Generate an active balanced batch
    client.post(f"/api/v1/studies/{study_id}/batches", json={"batch_size": 4, "strategy": "balanced"})

    print("\n✓ Transmissive Optical Microscope Study seeded successfully!")
    print(f"Study ID: {study_id}")
    print(f"Name: {study_name}")
    return study_id


if __name__ == "__main__":
    main()
