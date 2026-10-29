#!/usr/bin/env python3
"""Seed the Hair Keratin Tribology & Cuticle Abrasion Wear Study into the database.

Demonstrates:
1. In-situ real-time micrograph evolution under mechanical contact friction & wear.
2. Direct coupling between reciprocating tribometer stroke (generator/formula) and transmissive optical microscopy.
3. Archard abrasive wear kinetics (W = k * P * v * t): keratin cuticle shingles (~0.8 µm height)
   progressively sand down and smooth out over 5.0 seconds.
4. Real-time changes in optical transmittance, Michelson diffraction contrast, and centerline line scan.
5. Calibrated micro-tribometer and digital optical microscopy bench benchmark evidence.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from lattice_server import db
from lattice_server.main import app
from lattice_server.screening.pipeline import run_screening_pipeline


def _build_hair_wear_project() -> dict:
    """Build the dynamic hair tribology simulation flow project."""
    nodes = [
        {
            "id": "n_stroke",
            "kind": "generator",
            "label": "Reciprocating Rubbing Stroke (mm)",
            "position": {"x": 40, "y": 160},
            "params": {
                "wave": "triangle",
                "frequency": 1.0,
                "amplitude": 5.0,
                "offset": 0.0,
                "phase": 0.0,
                "unit": "mm",
            },
        },
        {
            "id": "n_friction",
            "kind": "formula",
            "label": "Frictional Shear Force (mN)",
            "position": {"x": 340, "y": 60},
            "params": {
                "expression": "120.0 * (0.35 + 0.06 * (a / 5.0) - 0.02 * t)",
                "a": 0.0,
                "b": 0.0,
                "unit": "mN",
            },
        },
        {
            "id": "n_wear_thick",
            "kind": "formula",
            "label": "Cuticle Layer Thickness d(t) (µm)",
            "position": {"x": 340, "y": 220},
            "params": {
                "expression": "max(18.0, 32.0 - 2.8 * t + 0.2 * (a / 5.0))",
                "a": 0.0,
                "b": 0.0,
                "unit": "µm",
            },
        },
        {
            "id": "n_scale_frac",
            "kind": "formula",
            "label": "Cuticle Scale Roughness Fraction (%)",
            "position": {"x": 340, "y": 380},
            "params": {
                "expression": "max(6.0, 36.0 - 5.8 * t + 1.5 * (a / 5.0))",
                "a": 0.0,
                "b": 0.0,
                "unit": "%",
            },
        },
        {
            "id": "n_vibration",
            "kind": "formula",
            "label": "Stage Micro-Vibration Δz (µm)",
            "position": {"x": 340, "y": 540},
            "params": {
                "expression": "0.35 * sin(2.0 * pi * 1.5 * t)",
                "a": 0.0,
                "b": 0.0,
                "unit": "µm",
            },
        },
        {
            "id": "n_microscope",
            "kind": "transmissiveMicroscope",
            "label": "Transmissive Microscope",
            "position": {"x": 680, "y": 260},
            "params": {
                "sourceMode": "Coupled Physical Inputs",
                "illuminationMode": "Brightfield",
                "magnification": 40.0,
                "numericalAperture": 0.65,
                "wavelengthNm": 546.0,
                "focusOffsetUm": 0.0,
                "immersionIndex": 1.0,
                "exposure": 1.0,
                "gridN": 64.0,
                "matrixThicknessUm": 32.0,
                "matrixAttenInvUm": 0.005,
                "featureAttenInvUm": 0.075,
                "matrixRefractiveIndex": 1.54,
                "featureRefractiveIndex": 1.51,
                "featureDiameterUm": 12.0,
                "featureVolumeFractionPct": 36.0,
                "chromophoreConcMolM3": 40.0,
                "molarAbsorptivityM2Mol": 0.15,
                "reticleFrequencyLpMm": 50.0,
                "seed": 777.0,
            },
        },
        {
            "id": "n_display",
            "kind": "microscopeDisplay",
            "label": "Real-Time Micrograph Viewport",
            "position": {"x": 1040, "y": 120},
            "params": {},
        },
        {
            "id": "n_scope_wear",
            "kind": "scope",
            "label": "Cuticle Wear & Friction Kinetics",
            "position": {"x": 1040, "y": 320},
            "params": {},
        },
        {
            "id": "n_scope_optical",
            "kind": "scope",
            "label": "Optical Centerline Transmission",
            "position": {"x": 1040, "y": 500},
            "params": {},
        },
    ]

    edges = [
        {"id": "e_stroke_fric", "source": "n_stroke", "sourceHandle": "signal", "target": "n_friction", "targetHandle": "a"},
        {"id": "e_stroke_thick", "source": "n_stroke", "sourceHandle": "signal", "target": "n_wear_thick", "targetHandle": "a"},
        {"id": "e_stroke_frac", "source": "n_stroke", "sourceHandle": "signal", "target": "n_scale_frac", "targetHandle": "a"},
        {"id": "e_thick_mic", "source": "n_wear_thick", "sourceHandle": "result", "target": "n_microscope", "targetHandle": "thickness"},
        {"id": "e_frac_mic", "source": "n_scale_frac", "sourceHandle": "result", "target": "n_microscope", "targetHandle": "volumeFraction"},
        {"id": "e_vib_mic", "source": "n_vibration", "sourceHandle": "result", "target": "n_microscope", "targetHandle": "focusOffset"},
        {"id": "e_mic_disp", "source": "n_microscope", "sourceHandle": "micrograph", "target": "n_display", "targetHandle": "micrograph"},
        {"id": "e_mic_scan", "source": "n_microscope", "sourceHandle": "lineProfile", "target": "n_scope_optical", "targetHandle": "ch1"},
        {"id": "e_wear_scope", "source": "n_wear_thick", "sourceHandle": "result", "target": "n_scope_wear", "targetHandle": "ch1"},
        {"id": "e_fric_scope", "source": "n_friction", "sourceHandle": "result", "target": "n_scope_wear", "targetHandle": "ch2"},
    ]

    return {
        "version": 3,
        "name": "Hair Cuticle Friction Wear Simulation",
        "duration": 5.0,
        "sampleRate": 50.0,
        "nodes": nodes,
        "edges": edges,
        "tools": [],
    }


def main() -> str:
    client = TestClient(app)
    conn = db.connect()

    study_name = "Hair Keratin Tribology & Cuticle Abrasion Wear (Transmissive Microscopy)"

    existing = conn.execute(
        "SELECT id, name FROM studies WHERE name = ?;", (study_name,)
    ).fetchone()

    if existing:
        study_id = str(existing["id"])
        print(f"Updating existing Hair Tribology study: {study_id}")
    else:
        study_res = client.post(
            "/api/v1/studies",
            json={
                "name": study_name,
                "description": (
                    "In-situ tribological wear screening of hair fiber cuticle scales under reciprocating micro-friction (Archard wear law: Δh = k·P·v·t). "
                    "Simulates real-time surface smoothing, scale edge shearing, dynamic optical transmittance increase, "
                    "and Abbe diffraction contrast drop as fibers rub together over 5.0 seconds."
                ),
                "domain": "biophysics_materials",
                "exclusion_threshold": 0.05,
                "confidence": 0.95,
                "rng_seed": 888999,
                "budget": 5500.0,
            },
        )
        assert study_res.status_code in (200, 201), f"Failed creating study: {study_res.text}"
        study_id = study_res.json()["id"]
        print(f"Created Hair Tribology study: {study_id}")

        # Parameters
        params = [
            {"key": "normal_load_mn", "label": "Normal Contact Force", "unit": "mN", "role": "controlled", "kind": "continuous", "spec": {"min": 50.0, "max": 250.0}},
            {"key": "sliding_velocity_mms", "label": "Reciprocating Rubbing Speed", "unit": "mm/s", "role": "controlled", "kind": "continuous", "spec": {"min": 2.0, "max": 20.0}},
            {"key": "cuticle_wear_coeff", "label": "Archard Cuticle Wear Coefficient (×10⁻³)", "unit": "1", "role": "controlled", "kind": "continuous", "spec": {"min": 2.0, "max": 20.0}},
            {"key": "initial_cuticle_thickness_um", "label": "Starting Cuticle Layer Thickness", "unit": "µm", "role": "controlled", "kind": "continuous", "spec": {"min": 2.0, "max": 6.0}},
            {"key": "vibration_amplitude_um", "label": "Mechanical Reciprocating Chatter", "unit": "µm", "role": "uncertain", "kind": "continuous", "spec": {"min": -0.8, "max": 0.8, "distribution": {"type": "normal", "mean": 0.0, "sd": 0.25}}},
            {"key": "objective_mag", "label": "Objective Magnification", "unit": "×", "role": "fixed", "kind": "continuous", "spec": {"min": 10.0, "max": 100.0, "value": 40.0}},
        ]
        for p in params:
            r = client.post(f"/api/v1/studies/{study_id}/parameters", json=p)
            assert r.status_code in (200, 201), f"Failed adding parameter {p['key']}: {r.text}"

        # Cost expression
        client.patch(
            f"/api/v1/studies/{study_id}",
            json={"cost_expression": "80 + 0.4 * normal_load_mn + 1.2 * sliding_velocity_mms"},
        )

        # Outcomes
        outcomes = [
            {
                "key": "final_cuticle_thickness_um",
                "label": "Surviving Cuticle Thickness",
                "unit": "µm",
                "kind": "continuous",
                "direction": "maximize",
                "criterion": {"op": ">=", "value": 2.2},
            },
            {
                "key": "transmittance_pct",
                "label": "Mean Optical Transmittance",
                "unit": "%",
                "kind": "continuous",
                "direction": "maximize",
                "criterion": {"op": ">=", "value": 72.0},
            },
            {
                "key": "michelson_contrast",
                "label": "Boundary Diffraction Contrast",
                "unit": "1",
                "kind": "continuous",
                "direction": "minimize",
                "criterion": {"op": "<=", "value": 0.35},
            },
            {
                "key": "cortex_breakthrough_time_s",
                "label": "Cuticle Perforation Breakthrough Time",
                "unit": "s",
                "kind": "continuous",
                "direction": "maximize",
                "criterion": {"op": ">=", "value": 4.5},
            },
        ]
        for oc in outcomes:
            r = client.post(f"/api/v1/studies/{study_id}/outcomes", json=oc)
            assert r.status_code in (200, 201), f"Failed adding outcome {oc['key']}: {r.text}"

        # Constraints
        client.post(
            f"/api/v1/studies/{study_id}/constraints",
            json={
                "label": "Catastrophic Cuticle Stripping Threshold",
                "expression": "cuticle_wear_coeff <= 16.0",
                "kind": "hard",
                "rationale": "High wear coefficient causes immediate scale edge delamination and total cuticle loss (illustrative)",
            },
        )
        client.post(
            f"/api/v1/studies/{study_id}/constraints",
            json={
                "label": "Pre-damaged Fiber Rejection",
                "expression": "initial_cuticle_thickness_um >= 2.5",
                "kind": "hard",
                "rationale": "Fibers with less than 2.5 µm initial cuticle are pre-bleached/damaged and excluded from virgin wear benchmarks",
            },
        )
        client.post(
            f"/api/v1/studies/{study_id}/constraints",
            json={
                "label": "Gentle Combing Friction Preference",
                "expression": "normal_load_mn <= 180.0",
                "kind": "soft",
                "penalty": 2.0,
                "rationale": "Loads above 180 mN represent harsh unconditioned brush snagging; lower loads reflect typical grooming",
            },
        )

        # Candidate Set (Sobol DoE 32 samples)
        client.post(f"/api/v1/studies/{study_id}/candidate-sets", json={"method": "sobol", "settings": {"n": 32}})

        # Ground-truth evidence points (benchmark micro-tribometer & optical microscopy trials)
        def _simulate_hair_bench(fn_mn: float, v_mms: float, k_wear: float, h0_um: float) -> tuple[float, float, float, float]:
            # Wear depth after 5 seconds: dh = k * P * v * t
            wear_rate = (k_wear * 1e-3) * (fn_mn / 100.0) * (v_mms / 10.0) * 0.45
            h_final = round(max(0.5, h0_um - wear_rate * 5.0), 2)
            breakthrough_time = round(min(5.0, (h0_um / max(wear_rate, 0.05))), 2)
            # Transmittance increases as rough scattering scales are polished smooth
            t_pct = round(min(92.0, 68.0 + 3.5 * (h0_um - h_final)), 1)
            # Michelson contrast decreases from 0.48 down to 0.15 as shingles smooth out
            contrast = round(max(0.12, 0.48 - 0.06 * (5.0 - h_final)), 3)
            return h_final, t_pct, contrast, breakthrough_time

        benchmarks = [
            {"normal_load_mn": 80.0, "sliding_velocity_mms": 5.0, "cuticle_wear_coeff": 4.0, "initial_cuticle_thickness_um": 4.5},
            {"normal_load_mn": 120.0, "sliding_velocity_mms": 10.0, "cuticle_wear_coeff": 8.0, "initial_cuticle_thickness_um": 4.0},
            {"normal_load_mn": 160.0, "sliding_velocity_mms": 15.0, "cuticle_wear_coeff": 12.0, "initial_cuticle_thickness_um": 3.8},
            {"normal_load_mn": 60.0, "sliding_velocity_mms": 4.0, "cuticle_wear_coeff": 3.0, "initial_cuticle_thickness_um": 5.0},
            {"normal_load_mn": 200.0, "sliding_velocity_mms": 18.0, "cuticle_wear_coeff": 14.0, "initial_cuticle_thickness_um": 3.5},
            {"normal_load_mn": 240.0, "sliding_velocity_mms": 20.0, "cuticle_wear_coeff": 18.0, "initial_cuticle_thickness_um": 3.0},
        ]

        for vals in benchmarks:
            h_fin, t_pct, contrast, t_bt = _simulate_hair_bench(
                vals["normal_load_mn"],
                vals["sliding_velocity_mms"],
                vals["cuticle_wear_coeff"],
                vals["initial_cuticle_thickness_um"],
            )
            client.post(
                f"/api/v1/studies/{study_id}/evidence",
                json={
                    "kind": "lab",
                    "values": vals,
                    "outcomes": {
                        "final_cuticle_thickness_um": h_fin,
                        "transmittance_pct": t_pct,
                        "michelson_contrast": contrast,
                        "cortex_breakthrough_time_s": t_bt,
                    },
                    "status": "valid",
                    "notes": "Reciprocating micro-tribometer & in-situ optical microscopy bench wear trial (illustrative)",
                },
            )

    # Create v3 Model Version with the complete flow project & bindings
    mv_res = client.post(
        f"/api/v1/studies/{study_id}/models",
        json={
            "project": _build_hair_wear_project(),
            "parameter_bindings": [
                {"parameter_key": "normal_load_mn", "not_in_model": True},
                {"parameter_key": "sliding_velocity_mms", "not_in_model": True},
                {"parameter_key": "cuticle_wear_coeff", "not_in_model": True},
                {"parameter_key": "initial_cuticle_thickness_um", "not_in_model": True},
                {"parameter_key": "vibration_amplitude_um", "not_in_model": True},
                {"parameter_key": "objective_mag", "not_in_model": True},
            ],
            "outcome_bindings": [
                {"outcome_key": "transmittance_pct", "node_id": "n_microscope", "port": "transmittance", "reducer": "value"},
                {"outcome_key": "michelson_contrast", "node_id": "n_microscope", "port": "contrast", "reducer": "value"},
            ],
            "notes": "Dynamic in-situ transmissive microscope flow model of keratin fiber cuticle friction & abrasion wear.",
        },
    )
    assert mv_res.status_code in (200, 201), f"Failed creating model version: {mv_res.text}"
    model_id = mv_res.json()["id"]

    # Validate against evidence points and accept
    client.post(f"/api/v1/studies/{study_id}/models/{model_id}/validate", json={"n_draws": 25})
    client.post(
        f"/api/v1/models/{model_id}/accept-validation",
        json={"reason": "Model accurately reflects in-situ optical transmittance gain and cuticle scale edge erosion within ±12% tolerance (illustrative)"},
    )

    # Run screening pipeline with Monte Carlo draws
    print("Running screening pipeline for 32 candidates...")
    run_screening_pipeline(conn=conn, study_id=study_id, settings={"mc_draws": 30})
    conn.commit()

    # Generate an active balanced batch
    client.post(f"/api/v1/studies/{study_id}/batches", json={"batch_size": 4, "strategy": "balanced"})

    print("\n✓ Hair Keratin Tribology Study seeded successfully!")
    print(f"Study ID: {study_id}")
    print(f"Name: {study_name}")
    return study_id


if __name__ == "__main__":
    main()
