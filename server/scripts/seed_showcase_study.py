#!/usr/bin/env python3
"""Seed an end-to-end Showcase Study into the local SQLite database so every UI tab is populated."""

from __future__ import annotations

import json
import math

from fastapi.testclient import TestClient

from lattice_server import config, db
from lattice_server.main import app
from lattice_server.screening.pipeline import run_screening_pipeline


def _build_showcase_flow_project() -> dict:
    """Build a full 3D Tunnel + 4-input formula flow model with valid v3 Project schema."""
    demo_path = config.REPO_ROOT / "public/demos/tunnel-methane-water.json"
    base_proj = json.loads(demo_path.read_text(encoding="utf-8"))

    extra_nodes = [
        {"id": "n_droplet", "kind": "formula", "label": "Droplet (um)", "position": {"x": 40, "y": 950}, "params": {"expression": "a", "a": 80.0, "b": 0.0, "unit": "um"}},
        {"id": "n_flow", "kind": "formula", "label": "Flow (L/min)", "position": {"x": 40, "y": 1070}, "params": {"expression": "a", "a": 60.0, "b": 0.0, "unit": "L/min"}},
        {"id": "n_nozzles", "kind": "formula", "label": "Nozzles", "position": {"x": 40, "y": 1190}, "params": {"expression": "a", "a": 12.0, "b": 0.0, "unit": ""}},
        {"id": "n_delay_s", "kind": "formula", "label": "Delay (s)", "position": {"x": 40, "y": 1310}, "params": {"expression": "a", "a": 0.025, "b": 0.0, "unit": "s"}},
        {"id": "n_methane", "kind": "formula", "label": "Methane (%)", "position": {"x": 40, "y": 1430}, "params": {"expression": "a", "a": 9.5, "b": 0.0, "unit": "%"}},
        {"id": "n_eff", "kind": "formula", "label": "Cooling Factor", "position": {"x": 40, "y": 1550}, "params": {"expression": "a", "a": 1.0, "b": 0.0, "unit": ""}},
        {
            "id": "n_atten",
            "kind": "formula",
            "label": "Attenuation Factor",
            "position": {"x": 380, "y": 1120},
            "params": {
                "expression": "clamp((b / 60) * (c / 10) * (80 / max(a, 20)) * exp(-8 * d), 0.1, 4.0)",
                "a": 80.0,
                "b": 60.0,
                "unit": "ratio",
            },
        },
        {
            "id": "n_pressure",
            "kind": "formula",
            "label": "Peak Overpressure (kPa)",
            "position": {"x": 760, "y": 1220},
            "params": {
                "expression": "max(12.0, 95.0 * (a / 9.5) / (1.0 + 0.85 * c * b))",
                "a": 9.5,
                "b": 1.0,
                "unit": "kPa",
            },
        },
    ]
    extra_edges = [
        {"id": "e1", "source": "n_droplet", "sourceHandle": "result", "target": "n_atten", "targetHandle": "a"},
        {"id": "e2", "source": "n_flow", "sourceHandle": "result", "target": "n_atten", "targetHandle": "b"},
        {"id": "e3", "source": "n_nozzles", "sourceHandle": "result", "target": "n_atten", "targetHandle": "c"},
        {"id": "e4", "source": "n_delay_s", "sourceHandle": "result", "target": "n_atten", "targetHandle": "d"},
        {"id": "e5", "source": "n_methane", "sourceHandle": "result", "target": "n_pressure", "targetHandle": "a"},
        {"id": "e6", "source": "n_atten", "sourceHandle": "result", "target": "n_pressure", "targetHandle": "b"},
        {"id": "e7", "source": "n_eff", "sourceHandle": "result", "target": "n_pressure", "targetHandle": "c"},
    ]

    base_proj["nodes"].extend(extra_nodes)
    base_proj["edges"].extend(extra_edges)
    base_proj["version"] = 3
    base_proj["tools"] = base_proj.get("tools", [])
    return base_proj


def main() -> str:
    client = TestClient(app)
    conn = db.connect()

    existing = conn.execute(
        "SELECT id, name FROM studies WHERE name LIKE 'Showcase: Tunnel Water-Mist%';"
    ).fetchone()
    if existing:
        study_id = str(existing["id"])
        print(f"Updating existing Showcase study: {study_id} ({existing['name']})")
    else:
        study_res = client.post(
            "/api/v1/studies",
            json={
                "name": "Showcase: Tunnel Water-Mist Blast Suppression (Illustrative)",
                "description": "Full scientific showcase: Buckingham Pi, Interval Arithmetic proofs, Adaptive 2-stage MC, Conformal GP, TOST equivalence, Split-Plot run sheets, and Report generator.",
                "domain": "tunnel_mist",
                "exclusion_threshold": 0.05,
                "confidence": 0.95,
                "rng_seed": 20261019,
                "budget": 5000.0,
            },
        )
        study_id = study_res.json()["id"]

        params_payload = [
            {"key": "droplet_um", "label": "Droplet Sauter Mean Diameter", "unit": "um", "role": "controlled", "kind": "continuous", "spec": {"min": 30.0, "max": 180.0}},
            {"key": "flow_lpm", "label": "Total Water Mist Flow Rate", "unit": "L/min", "role": "controlled", "kind": "continuous", "spec": {"min": 20.0, "max": 120.0}},
            {"key": "nozzles", "label": "Active Mist Nozzle Count", "unit": "", "role": "controlled", "kind": "integer", "spec": {"min": 4, "max": 20, "step": 4, "values": [4, 8, 12, 16, 20]}},
            {"key": "delay_ms", "label": "Valve Activation Delay", "unit": "ms", "role": "controlled", "kind": "continuous", "spec": {"min": 10.0, "max": 100.0}},
            {"key": "methane_pct", "label": "Ambient Methane Stoichiometry", "unit": "percent", "role": "uncertain", "kind": "continuous", "spec": {"min": 8.5, "max": 10.5, "distribution": {"type": "normal", "mean": 9.5, "sd": 0.35}}},
            {"key": "cooling_factor", "label": "Empirical Mist Cooling Factor", "unit": "", "role": "fixed", "kind": "continuous", "spec": {"min": 0.5, "max": 2.0, "value": 1.0}},
        ]
        for p in params_payload:
            client.post(f"/api/v1/studies/{study_id}/parameters", json=p)

        client.patch(f"/api/v1/studies/{study_id}", json={"cost_expression": "150 + 25 * nozzles + 1.5 * flow_lpm"})

        client.post(
            f"/api/v1/studies/{study_id}/outcomes",
            json={"key": "peak_pressure_kpa", "label": "Peak Blast Overpressure", "unit": "kPa", "kind": "continuous", "direction": "minimize", "criterion": {"op": "<=", "value": 45.0}},
        )

        client.post(f"/api/v1/studies/{study_id}/constraints", json={"label": "Fast Valve Response Limit", "expression": "delay_ms <= 75", "kind": "hard", "rationale": "Flame front passes mist curtain after 75 ms (illustrative)"})
        client.post(f"/api/v1/studies/{study_id}/constraints", json={"label": "Max Per-Nozzle Manifold Flow", "expression": "flow_lpm / nozzles <= 12.0", "kind": "hard", "rationale": "Manifold cavitation above 12 L/min per nozzle (illustrative)"})
        client.post(f"/api/v1/studies/{study_id}/constraints", json={"label": "Low Nozzle Count Maintenance Preference", "expression": "nozzles <= 12", "kind": "soft", "penalty": 2.5, "rationale": "Fewer nozzles reduce tunnel installation & maintenance cost"})

        client.post(f"/api/v1/studies/{study_id}/candidate-sets", json={"method": "sobol", "settings": {"n": 32}})

        def _sim_p(d_um: float, f_lpm: float, noz: int, del_ms: float, noise: float = 0.0) -> float:
            att = min(4.0, max(0.1, (f_lpm / 60.0) * (noz / 10.0) * (80.0 / max(d_um, 20.0)) * math.exp(-8.0 * (del_ms / 1000.0))))
            return round(max(12.0, 95.0 / (1.0 + 0.85 * 1.0 * att)) + noise, 2)

        bench_trials = [
            ({"droplet_um": 60.0, "flow_lpm": 75.0, "nozzles": 12, "delay_ms": 25.0}, _sim_p(60.0, 75.0, 12, 25.0, -0.2)),
            ({"droplet_um": 60.0, "flow_lpm": 75.0, "nozzles": 12, "delay_ms": 25.0}, _sim_p(60.0, 75.0, 12, 25.0, +0.2)),
            ({"droplet_um": 60.0, "flow_lpm": 75.0, "nozzles": 12, "delay_ms": 25.0}, _sim_p(60.0, 75.0, 12, 25.0, 0.0)),
            ({"droplet_um": 80.0, "flow_lpm": 75.0, "nozzles": 16, "delay_ms": 25.0}, _sim_p(80.0, 75.0, 16, 25.0, -0.15)),
            ({"droplet_um": 80.0, "flow_lpm": 75.0, "nozzles": 16, "delay_ms": 25.0}, _sim_p(80.0, 75.0, 16, 25.0, +0.25)),
            ({"droplet_um": 80.0, "flow_lpm": 75.0, "nozzles": 16, "delay_ms": 25.0}, _sim_p(80.0, 75.0, 16, 25.0, 0.0)),
            ({"droplet_um": 150.0, "flow_lpm": 30.0, "nozzles": 4, "delay_ms": 60.0}, _sim_p(150.0, 30.0, 4, 60.0, +0.3)),
            ({"droplet_um": 140.0, "flow_lpm": 40.0, "nozzles": 8, "delay_ms": 55.0}, _sim_p(140.0, 40.0, 8, 55.0, -0.2)),
            ({"droplet_um": 110.0, "flow_lpm": 50.0, "nozzles": 8, "delay_ms": 40.0}, _sim_p(110.0, 50.0, 8, 40.0, +0.1)),
            ({"droplet_um": 90.0, "flow_lpm": 65.0, "nozzles": 12, "delay_ms": 30.0}, _sim_p(90.0, 65.0, 12, 30.0, -0.1)),
            ({"droplet_um": 50.0, "flow_lpm": 90.0, "nozzles": 16, "delay_ms": 20.0}, _sim_p(50.0, 90.0, 16, 20.0, +0.15)),
            ({"droplet_um": 40.0, "flow_lpm": 105.0, "nozzles": 20, "delay_ms": 15.0}, _sim_p(40.0, 105.0, 20, 15.0, -0.1)),
        ]
        for vals, p_kpa in bench_trials:
            client.post(f"/api/v1/studies/{study_id}/evidence", json={"kind": "lab", "values": vals, "outcomes": {"peak_pressure_kpa": p_kpa}, "status": "valid", "notes": "Illustrative shock-tube benchmark run"})

    # Always save a new v3 Model Version with full 3D tunnel + formula nodes and validate it
    mv_res = client.post(
        f"/api/v1/studies/{study_id}/models",
        json={
            "project": _build_showcase_flow_project(),
            "parameter_bindings": [
                {"parameter_key": "droplet_um", "node_id": "n_droplet", "param_key": "a", "param_unit": "um", "field_unit": "um"},
                {"parameter_key": "flow_lpm", "node_id": "n_flow", "param_key": "a", "param_unit": "L/min", "field_unit": "L/min"},
                {"parameter_key": "nozzles", "node_id": "n_nozzles", "param_key": "a"},
                {"parameter_key": "delay_ms", "node_id": "n_delay_s", "param_key": "a", "param_unit": "ms", "field_unit": "s"},
                {"parameter_key": "methane_pct", "node_id": "n_methane", "param_key": "a"},
                {"parameter_key": "cooling_factor", "node_id": "n_eff", "param_key": "a"},
            ],
            "outcome_bindings": [
                {"outcome_key": "peak_pressure_kpa", "node_id": "n_pressure", "port": "result", "reducer": "value"}
            ],
            "notes": "3D Tunnel + 4-input formula flow model with ms->s Pint unit scaling",
        },
    )
    model_id = mv_res.json()["id"]
    client.post(f"/api/v1/studies/{study_id}/models/{model_id}/validate", json={"n_draws": 20})
    client.post(f"/api/v1/models/{model_id}/accept-validation", json={"reason": "Validated against 12 shock-tube benchmark trials (illustrative)"})
    run_screening_pipeline(conn=conn, study_id=study_id, settings={"mc_draws": 40})
    conn.commit()
    client.post(f"/api/v1/studies/{study_id}/batches", json={"batch_size": 4, "strategy": "balanced"})
    print(f"Showcase Study updated with v3 3D Flow Project: {study_id}")
    return study_id


if __name__ == "__main__":
    main()
