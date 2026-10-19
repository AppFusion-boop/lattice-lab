"""End-to-End Scientific Showcase Test: demonstrates all Tiers 1-4 capabilities in one cohesive campaign."""

from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient


def _build_illustrative_blast_flow_project() -> dict:
    """Build a deterministic flow model for tunnel blast overpressure attenuation (illustrative)."""
    return {
        "version": 3,
        "name": "Illustrative Tunnel Water-Mist Blast Attenuation Model",
        "duration": 1.0,
        "sampleRate": 50,
        "tools": [],
        "nodes": [
            {"id": "n_droplet", "kind": "formula", "label": "Droplet (um)", "position": {"x": 0, "y": 0}, "params": {"expression": "a", "a": 80.0, "b": 0.0, "unit": "um"}},
            {"id": "n_flow", "kind": "formula", "label": "Flow (L/min)", "position": {"x": 0, "y": 100}, "params": {"expression": "a", "a": 60.0, "b": 0.0, "unit": "L/min"}},
            {"id": "n_nozzles", "kind": "formula", "label": "Nozzles", "position": {"x": 0, "y": 200}, "params": {"expression": "a", "a": 12.0, "b": 0.0, "unit": ""}},
            {"id": "n_delay_s", "kind": "formula", "label": "Delay (s)", "position": {"x": 0, "y": 300}, "params": {"expression": "a", "a": 0.025, "b": 0.0, "unit": "s"}},
            {"id": "n_methane", "kind": "formula", "label": "Methane (%)", "position": {"x": 0, "y": 400}, "params": {"expression": "a", "a": 9.5, "b": 0.0, "unit": "%"}},
            {"id": "n_eff", "kind": "formula", "label": "Cooling Factor", "position": {"x": 0, "y": 500}, "params": {"expression": "a", "a": 1.0, "b": 0.0, "unit": ""}},
            {
                # Uses 4-input formula node (a=droplet_um, b=flow_lpm, c=nozzles, d=delay_s)
                "id": "n_atten",
                "kind": "formula",
                "label": "Attenuation Factor",
                "position": {"x": 280, "y": 150},
                "params": {
                    "expression": "clamp((b / 60) * (c / 10) * (80 / max(a, 20)) * exp(-8 * d), 0.1, 4.0)",
                    "a": 80.0,
                    "b": 60.0,
                    "unit": "ratio",
                },
            },
            {
                # Combines methane conc (a), wired attenuation (b), cooling factor (c) -> peak_pressure_kpa
                "id": "n_pressure",
                "kind": "formula",
                "label": "Peak Overpressure (kPa)",
                "position": {"x": 560, "y": 200},
                "params": {
                    "expression": "max(12.0, 95.0 * (a / 9.5) / (1.0 + 0.85 * c * b))",
                    "a": 9.5,
                    "b": 1.0,
                    "unit": "kPa",
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "n_droplet", "sourceHandle": "result", "target": "n_atten", "targetHandle": "a"},
            {"id": "e2", "source": "n_flow", "sourceHandle": "result", "target": "n_atten", "targetHandle": "b"},
            {"id": "e3", "source": "n_nozzles", "sourceHandle": "result", "target": "n_atten", "targetHandle": "c"},
            {"id": "e4", "source": "n_delay_s", "sourceHandle": "result", "target": "n_atten", "targetHandle": "d"},
            {"id": "e5", "source": "n_methane", "sourceHandle": "result", "target": "n_pressure", "targetHandle": "a"},
            {"id": "e6", "source": "n_atten", "sourceHandle": "result", "target": "n_pressure", "targetHandle": "b"},
            {"id": "e7", "source": "n_eff", "sourceHandle": "result", "target": "n_pressure", "targetHandle": "c"},
        ],
    }


def test_full_scientific_showcase_pipeline(client: TestClient, db_conn: sqlite3.Connection) -> None:
    """Demonstrates and verifies all 12 scientific overhaul capabilities in one end-to-end campaign."""
    banner = "=" * 78
    print(f"\n{banner}")
    print("  LATTICE LAB -- SCIENTIFIC OVERHAUL END-TO-END SHOWCASE")
    print(f"{banner}")

    # -------------------------------------------------------------------------
    # 1. Create Study with Statistical Guarantees
    # -------------------------------------------------------------------------
    study_res = client.post(
        "/api/v1/studies",
        json={
            "name": "Showcase: Tunnel Water-Mist Blast Suppression (Illustrative)",
            "description": "End-to-end demonstration of interval proofs, Buckingham Pi, adaptive MC, conformal GP, TOST, split-plot run sheets, and report generation.",
            "domain": "tunnel_mist",
            "exclusion_threshold": 0.05,
            "confidence": 0.95,
            "rng_seed": 20261019,
            "budget": 5000.0,
        },
    )
    assert study_res.status_code == 201, study_res.text
    study_id = study_res.json()["id"]
    print(f"\n[1/12] Created Study '{study_res.json()['name']}' (id={study_id})")

    # -------------------------------------------------------------------------
    # 2. Define Controlled, Uncertain (Normal), and Fixed Parameters
    # -------------------------------------------------------------------------
    params_payload = [
        {
            "key": "droplet_um",
            "label": "Droplet Sauter Mean Diameter",
            "unit": "um",
            "role": "controlled",
            "kind": "continuous",
            "spec": {"min": 30.0, "max": 180.0},
        },
        {
            "key": "flow_lpm",
            "label": "Total Water Mist Flow Rate",
            "unit": "L/min",
            "role": "controlled",
            "kind": "continuous",
            "spec": {"min": 20.0, "max": 120.0},
        },
        {
            "key": "nozzles",
            "label": "Active Mist Nozzle Count",
            "unit": "",
            "role": "controlled",
            "kind": "integer",
            "spec": {"min": 4, "max": 20, "step": 4, "values": [4, 8, 12, 16, 20]},
        },
        {
            "key": "delay_ms",
            "label": "Valve Activation Delay",
            "unit": "ms",
            "role": "controlled",
            "kind": "continuous",
            "spec": {"min": 10.0, "max": 100.0},
        },
        {
            "key": "methane_pct",
            "label": "Ambient Methane Stoichiometry",
            "unit": "percent",
            "role": "uncertain",
            "kind": "continuous",
            "spec": {
                "min": 8.5,
                "max": 10.5,
                "distribution": {"type": "normal", "mean": 9.5, "sd": 0.35},
            },
        },
        {
            "key": "cooling_factor",
            "label": "Empirical Mist Cooling Factor",
            "unit": "",
            "role": "fixed",
            "kind": "continuous",
            "spec": {"min": 0.5, "max": 2.0, "value": 1.0},
        },
    ]
    for p in params_payload:
        r = client.post(f"/api/v1/studies/{study_id}/parameters", json=p)
        assert r.status_code == 201, r.text

    # Set cost expression referencing nozzles and flow_lpm
    patch_res = client.patch(
        f"/api/v1/studies/{study_id}",
        json={"cost_expression": "150 + 25 * nozzles + 1.5 * flow_lpm"},
    )
    assert patch_res.status_code == 200, patch_res.text

    # Outcome: Peak Overpressure <= 45 kPa
    out_res = client.post(
        f"/api/v1/studies/{study_id}/outcomes",
        json={
            "key": "peak_pressure_kpa",
            "label": "Peak Blast Overpressure",
            "unit": "kPa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<=", "value": 45.0},
        },
    )
    assert out_res.status_code == 201, out_res.text
    print("[2/12] Configured 4 controlled, 1 uncertain (Normal), 1 fixed parameter, cost formula & outcome <= 45 kPa")

    # -------------------------------------------------------------------------
    # 3. Hard & Soft Constraints + Uncertain-in-Hard-Constraint Guard (T1-3)
    # -------------------------------------------------------------------------
    # Verify Hard Rule / T1-3 guard: uncertain parameter inside hard constraint is rejected!
    bad_c = client.post(
        f"/api/v1/studies/{study_id}/constraints",
        json={
            "label": "Invalid Uncertain Hard Constraint",
            "expression": "methane_pct <= 9.8",
            "kind": "hard",
            "rationale": "Should be rejected because methane_pct is uncertain",
        },
    )
    assert bad_c.status_code == 422, bad_c.text
    assert bad_c.json()["detail"]["code"] == "uncertain_in_hard_constraint"

    # Valid Hard Constraint 1: Trigger delay must be <= 75 ms
    c1 = client.post(
        f"/api/v1/studies/{study_id}/constraints",
        json={
            "label": "Fast Valve Response Limit",
            "expression": "delay_ms <= 75",
            "kind": "hard",
            "rationale": "Flame front passes mist curtain after 75 ms (illustrative geometry limit)",
        },
    )
    assert c1.status_code == 201, c1.text

    # Valid Hard Constraint 2: Per-nozzle flow rate <= 12 L/min (pump manifold limit)
    c2 = client.post(
        f"/api/v1/studies/{study_id}/constraints",
        json={
            "label": "Max Per-Nozzle Manifold Flow",
            "expression": "flow_lpm / nozzles <= 12.0",
            "kind": "hard",
            "rationale": "Manifold cavitation above 12 L/min per nozzle (illustrative)",
        },
    )
    assert c2.status_code == 201, c2.text

    # Valid Soft Constraint: Prefer <= 12 nozzles with penalty = 2.5
    c3 = client.post(
        f"/api/v1/studies/{study_id}/constraints",
        json={
            "label": "Low Nozzle Count Maintenance Preference",
            "expression": "nozzles <= 12",
            "kind": "soft",
            "penalty": 2.5,
            "rationale": "Fewer nozzles reduce tunnel installation & maintenance cost",
        },
    )
    assert c3.status_code == 201, c3.text
    print("[3/12] Verified 422 uncertain_in_hard_constraint guard; created 2 hard + 1 weighted soft constraint")

    # -------------------------------------------------------------------------
    # 4. Generate 32 Sobol Candidates & Run Buckingham Pi + Interval Proofs
    # -------------------------------------------------------------------------
    cand_res = client.post(
        f"/api/v1/studies/{study_id}/candidate-sets",
        json={"method": "sobol", "settings": {"n": 32}},
    )
    assert cand_res.status_code == 201, cand_res.text
    print(f"[4/12] Generated {cand_res.json()['count']} Sobol space-filling candidate designs")

    # Buckingham Pi Dimensional Analysis (T4-1)
    pi_res = client.get(f"/api/v1/studies/{study_id}/analyses/dimensional")
    assert pi_res.status_code == 200, pi_res.text
    pi_data = pi_res.json()
    assert pi_data["num_pi_groups"] >= 1
    print(f"[5/12] Buckingham Pi Analysis: {pi_data['reduction_summary']}")
    for g in pi_data["pi_groups"][:3]:
        print(f"       - {g['name']}: {g['expression']}")

    # Interval Arithmetic Futility Prover & Critical Threshold Solver (T3-1)
    int_res = client.post(
        f"/api/v1/studies/{study_id}/analyses/intervals",
        json={
            "outcome_key": "peak_pressure_kpa",
            "expression": "95.0 * (methane_pct / 9.5) - 0.55 * flow_lpm",
            "n_slices": 50,
        },
    )
    assert int_res.status_code == 200, int_res.text
    int_data = int_res.json()
    assert len(int_data["theorems"]) >= 1
    print(
        f"[6/12] Interval Arithmetic Prover: {len(int_data['theorems'])} analytical 1D futility threshold theorem(s) proved without simulation!"
    )
    for thm in int_data["theorems"]:
        print(f"       - {thm['statement']}")

    # -------------------------------------------------------------------------
    # 5. Connect 3D Flow Model with Pint Unit Conversion (ms -> s) (T1-5)
    # -------------------------------------------------------------------------
    project_json = _build_illustrative_blast_flow_project()
    mv_res = client.post(
        f"/api/v1/studies/{study_id}/models",
        json={
            "project": project_json,
            "parameter_bindings": [
                {"parameter_key": "droplet_um", "node_id": "n_droplet", "param_key": "a", "param_unit": "um", "field_unit": "um"},
                {"parameter_key": "flow_lpm", "node_id": "n_flow", "param_key": "a", "param_unit": "L/min", "field_unit": "L/min"},
                {"parameter_key": "nozzles", "node_id": "n_nozzles", "param_key": "a"},
                # Automatic Pint conversion: study parameter is in 'ms', flow node expects 's'!
                {"parameter_key": "delay_ms", "node_id": "n_delay_s", "param_key": "a", "param_unit": "ms", "field_unit": "s"},
                {"parameter_key": "methane_pct", "node_id": "n_methane", "param_key": "a"},
                {"parameter_key": "cooling_factor", "node_id": "n_eff", "param_key": "a"},
            ],
            "outcome_bindings": [
                {"outcome_key": "peak_pressure_kpa", "node_id": "n_pressure", "port": "result", "reducer": "value"}
            ],
            "notes": "4-input formula flow model with ms->s Pint unit scaling",
        },
    )
    assert mv_res.status_code == 201, mv_res.text
    model_v1_id = mv_res.json()["id"]

    # -------------------------------------------------------------------------
    # 6. Calibration Guard (T1-1) & Physical Evidence Ingestion
    # -------------------------------------------------------------------------
    # Verify T1-1: Calibration before adding >= 3 evidence rows is strictly forbidden (422)
    cal_fail = client.post(
        f"/api/v1/studies/{study_id}/calibrate",
        json={
            "parameter_key": "cooling_factor",
            "target_outcome": "peak_pressure_kpa",
            "initial_guess": 1.0,
            "param_bounds": [0.5, 2.0],
        },
    )
    assert cal_fail.status_code == 422, cal_fail.text
    assert cal_fail.json()["detail"]["code"] == "insufficient_evidence"

    # Add 12 illustrative physical shock-tube bench trials (including replicates for TOST!)
    import math

    def _sim_p(d_um: float, f_lpm: float, noz: int, del_ms: float, noise: float = 0.0) -> float:
        att = min(4.0, max(0.1, (f_lpm / 60.0) * (noz / 10.0) * (80.0 / max(d_um, 20.0)) * math.exp(-8.0 * (del_ms / 1000.0))))
        return round(max(12.0, 95.0 / (1.0 + 0.85 * 1.02 * att)) + noise, 2)

    bench_trials = [
        # Group A replicates (12 nozzles, 60um, 75 L/min, 25ms)
        ({"droplet_um": 60.0, "flow_lpm": 75.0, "nozzles": 12, "delay_ms": 25.0}, _sim_p(60.0, 75.0, 12, 25.0, -0.2)),
        ({"droplet_um": 60.0, "flow_lpm": 75.0, "nozzles": 12, "delay_ms": 25.0}, _sim_p(60.0, 75.0, 12, 25.0, +0.2)),
        ({"droplet_um": 60.0, "flow_lpm": 75.0, "nozzles": 12, "delay_ms": 25.0}, _sim_p(60.0, 75.0, 12, 25.0, 0.0)),
        # Group B replicates (16 nozzles, 80um, 75 L/min, 25ms) -> equivalent to Group A within +-3 kPa!
        ({"droplet_um": 80.0, "flow_lpm": 75.0, "nozzles": 16, "delay_ms": 25.0}, _sim_p(80.0, 75.0, 16, 25.0, -0.15)),
        ({"droplet_um": 80.0, "flow_lpm": 75.0, "nozzles": 16, "delay_ms": 25.0}, _sim_p(80.0, 75.0, 16, 25.0, +0.25)),
        ({"droplet_um": 80.0, "flow_lpm": 75.0, "nozzles": 16, "delay_ms": 25.0}, _sim_p(80.0, 75.0, 16, 25.0, 0.0)),
        # Diverse points across the design space for GP Surrogate & K-Fold Backtest
        ({"droplet_um": 150.0, "flow_lpm": 30.0, "nozzles": 4, "delay_ms": 60.0}, _sim_p(150.0, 30.0, 4, 60.0, +0.3)),
        ({"droplet_um": 140.0, "flow_lpm": 40.0, "nozzles": 8, "delay_ms": 55.0}, _sim_p(140.0, 40.0, 8, 55.0, -0.2)),
        ({"droplet_um": 110.0, "flow_lpm": 50.0, "nozzles": 8, "delay_ms": 40.0}, _sim_p(110.0, 50.0, 8, 40.0, +0.1)),
        ({"droplet_um": 90.0, "flow_lpm": 65.0, "nozzles": 12, "delay_ms": 30.0}, _sim_p(90.0, 65.0, 12, 30.0, -0.1)),
        ({"droplet_um": 50.0, "flow_lpm": 90.0, "nozzles": 16, "delay_ms": 20.0}, _sim_p(50.0, 90.0, 16, 20.0, +0.15)),
        ({"droplet_um": 40.0, "flow_lpm": 105.0, "nozzles": 20, "delay_ms": 15.0}, _sim_p(40.0, 105.0, 20, 15.0, -0.1)),
    ]
    for vals, p_kpa in bench_trials:
        ev_r = client.post(
            f"/api/v1/studies/{study_id}/evidence",
            json={
                "kind": "lab",
                "values": vals,
                "outcomes": {"peak_pressure_kpa": p_kpa},
                "status": "valid",
                "notes": "Illustrative shock-tube benchmark run",
            },
        )
        assert ev_r.status_code == 201, ev_r.text

    # Now calibrate cooling_factor against the 12 real evidence rows
    cal_ok = client.post(
        f"/api/v1/studies/{study_id}/calibrate",
        json={
            "parameter_key": "cooling_factor",
            "target_outcome": "peak_pressure_kpa",
            "initial_guess": 0.9,
            "param_bounds": [0.5, 2.0],
        },
    )
    assert cal_ok.status_code == 200, cal_ok.text
    cal_data = cal_ok.json()
    print(
        f"[7/12] L-BFGS-B Calibration on {cal_data['n_evidence_points']} evidence points: "
        f"cooling_factor={cal_data['calibrated_value']:.3f} (RMSE {cal_data['prior_rmse']:.2f} -> {cal_data['calibrated_rmse']:.2f} kPa)"
    )

    # -------------------------------------------------------------------------
    # 7. Empirical Model Validation & Human Acceptance (T3-2, Hard Rule 6)
    # -------------------------------------------------------------------------
    val_res = client.post(
        f"/api/v1/studies/{study_id}/models/{model_v1_id}/validate",
        json={"n_draws": 20},
    )
    assert val_res.status_code == 200, val_res.text
    val_body = val_res.json()
    rmse_kpa = val_body["rmse_by_outcome"]["peak_pressure_kpa"]
    cov_90 = val_body["empirical_coverage_90"]

    acc_res = client.post(
        f"/api/v1/models/{model_v1_id}/accept-validation",
        json={"reason": "Validated against 12 shock-tube benchmark trials (illustrative)"},
    )
    assert acc_res.status_code == 200, acc_res.text
    assert acc_res.json()["validation_status"] == "validated"
    print(
        f"[8/12] Model Validated & Human-Accepted: RMSE={rmse_kpa:.2f} kPa, "
        f"90% Coverage={cov_90*100:.0f}%"
    )

    # -------------------------------------------------------------------------
    # 8. Full 8-Stage Screening Pipeline (T1-2, T1-3, T3-3)
    # -------------------------------------------------------------------------
    from lattice_server.screening.pipeline import run_screening_pipeline

    screen_run = run_screening_pipeline(conn=db_conn, study_id=study_id, settings={"mc_draws": 40})
    db_conn.commit()

    summary = screen_run.summary.model_dump()
    counts = summary["counts_by_status"]
    filters = summary["counts_by_filter"]
    print(
        f"[9/12] Screening Funnel Complete: Statuses={counts} | "
        f"By Filter={filters} | "
        f"Expected False-Exclusions Bound <= {summary['expected_false_exclusions_bound']:.3f}"
    )
    assert counts.get("excluded", 0) > 0

    # -------------------------------------------------------------------------
    # 9. TOST Equivalence & K-Fold Back-Test (T3-4)
    # -------------------------------------------------------------------------
    tost_res = client.post(
        f"/api/v1/studies/{study_id}/analyses/tost",
        json={
            "outcome_key": "peak_pressure_kpa",
            "unit": "kPa",
            "margin": 3.0,
            "alpha": 0.05,
            "label_a": "12 Nozzles (60um)",
            "label_b": "16 Nozzles (80um)",
            "group_a": [34.2, 34.8, 34.5],
            "group_b": [34.6, 35.0, 34.4],
        },
    )
    assert tost_res.status_code == 200, tost_res.text
    tost_claim = tost_res.json()
    assert tost_claim["equivalent"] is True
    stmt_ascii = tost_claim["statement"].replace("±", "+/-")
    print(f"[10/12] TOST Equivalence Claim: {stmt_ascii}")

    bt_res = client.post(
        f"/api/v1/studies/{study_id}/analyses/backtest",
        json={"k_folds": 4},
    )
    assert bt_res.status_code == 200, bt_res.text
    bt_data = bt_res.json()
    print(
        f"        K-Fold Back-Test: {bt_data['false_exclusions']}/{bt_data['total_true_successes']} "
        f"false exclusions (rate={bt_data['false_exclusion_rate']*100:.1f}%, within_bound={bt_data['within_nominal_bound']})"
    )

    # -------------------------------------------------------------------------
    # 10. Active Learning Next Batch, Power Analysis & Split-Plot Run Sheet (T3-5, T4-2)
    # -------------------------------------------------------------------------
    batch_res = client.post(
        f"/api/v1/studies/{study_id}/batches",
        json={"batch_size": 4, "strategy": "balanced"},
    )
    assert batch_res.status_code == 200, batch_res.text
    batch_items = batch_res.json()["items"]
    assert len(batch_items) > 0

    pwr_res = client.post(
        f"/api/v1/studies/{study_id}/analyses/power",
        json={"min_effect": 2.5, "noise_sd": 1.5, "alpha": 0.05, "power": 0.80},
    )
    assert pwr_res.status_code == 200, pwr_res.text
    print(
        f"[11/12] Active Learning selected {len(batch_items)} diverse next runs; "
        f"Power Analysis: r={pwr_res.json()['recommended_replicates']} replicates/arm (d={pwr_res.json()['cohens_d']})"
    )

    rs_res = client.post(
        f"/api/v1/studies/{study_id}/run-sheets",
        json={
            "candidate_status": "recommended",
            "replicates": 2,
            "hard_to_change_keys": ["nozzles", "droplet_um"],
        },
    )
    assert rs_res.status_code == 201, rs_res.text
    rs_data = rs_res.json()
    print(
        f"        Split-Plot Run Sheet: {len(rs_data['rows'])} runs, "
        f"hardware_changeovers={rs_data['hardware_changeovers']} (saved {rs_data['saved_changeovers']} swaps!)"
    )

    # -------------------------------------------------------------------------
    # 11. Defensible Scientific Markdown Report (T4-4, Hard Rule 7)
    # -------------------------------------------------------------------------
    rep_res = client.get(f"/api/v1/studies/{study_id}/report")
    assert rep_res.status_code == 200, rep_res.text
    md = rep_res.json()["markdown"]
    assert "## 1. Study Definition & Statistical Guarantee" in md
    assert "## 5. Screening Funnel & Exclusion Breakdown" in md
    assert "## 8. Methodological Limitations & Assumptions" in md
    print(f"[12/12] Generated Defensible Scientific Markdown Report ({len(md)} chars)")
    print(f"{banner}\n")
