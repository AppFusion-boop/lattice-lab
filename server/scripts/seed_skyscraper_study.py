#!/usr/bin/env python3
"""Seed the Smart Damped Cement Skyscraper experiment study into the database."""

import json
import subprocess
from pathlib import Path

from lattice_server import config, db
from lattice_server.api.studies import create_from_template
from lattice_server.ids import new_id
from lattice_server.repo import candidates as candidates_repo
from lattice_server.repo import evidence as evidence_repo
from lattice_server.repo import models as models_repo
from lattice_server.repo import parameters as parameters_repo
from lattice_server.repo import studies as studies_repo
from lattice_server.schemas import (
    EvidenceCreate,
    ModelVersionCreate,
    ParameterBindingModel,
    OutcomeBindingModel,
    TemplateCreateRequest,
)
from lattice_server.screening.pipeline import run_screening_pipeline
from lattice_server.stats.doe import lhs


def main():
    conn = db.connect()

    # 1. Check if study already exists
    existing = conn.execute(
        "SELECT id, name FROM studies WHERE name LIKE '%Smart%Cement%' OR name LIKE '%Skyscraper%';"
    ).fetchone()
    if existing:
        print(f"Study already exists: {existing['id']} ({existing['name']})")
        study_id = existing["id"]
    else:
        print("Creating Smart Damped Cement Skyscraper study from template...")
        req = TemplateCreateRequest(
            template="smart_cement_skyscraper",
            name="Smart Damped Cement Skyscraper (Civil & Materials)",
        )
        study_resp = create_from_template(req, conn)
        study_id = study_resp.id
        print(f"Created study: {study_id}")

    # 2. Extract 3D project JSON using tsx
    print("Generating 3D Skyscraper project definition...")
    res = subprocess.run(
        ["npx", "tsx", "-e", "import { skyscraperProject } from './src/core/skyscraper-demo'; console.log(JSON.stringify(skyscraperProject()));"],
        cwd=config.REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    project_obj = json.loads(res.stdout.strip())
    print(f"Generated project: {len(project_obj.get('nodes', []))} nodes, {len(project_obj.get('edges', []))} edges")

    # 3. Create or update ModelVersion
    existing_models = models_repo.get_model_versions(conn, study_id)
    if not existing_models:
        print("Creating ModelVersion 1 with parameter & outcome bindings...")
        model_payload = ModelVersionCreate(
            project=project_obj,
            parameter_bindings=[
                ParameterBindingModel(parameter_key="water_binder_ratio", node_id="node_wb", param_key="a"),
                ParameterBindingModel(parameter_key="silica_fume_ratio", node_id="node_sf", param_key="a"),
                ParameterBindingModel(parameter_key="polymer_cement_ratio", node_id="node_polymer", param_key="a"),
                ParameterBindingModel(parameter_key="fiber_volume_fraction", node_id="node_fiber", param_key="a"),
                ParameterBindingModel(parameter_key="wind_speed_gust", node_id="node_wind_gust", param_key="a"),
            ],
            outcome_bindings=[
                OutcomeBindingModel(outcome_key="top_acceleration", node_id="node_top_accel", port="result", reducer="value"),
                OutcomeBindingModel(outcome_key="compressive_strength", node_id="node_fc", port="result", reducer="value"),
                OutcomeBindingModel(outcome_key="damping_ratio", node_id="node_damping", port="result", reducer="value"),
                OutcomeBindingModel(outcome_key="embodied_carbon", node_id="node_carbon", port="result", reducer="value"),
            ],
            notes="Initial civil engineering flow model for viscoelastic damped UHPC composite high-rise screening.",
        )
        mv = models_repo.create_model_version(
            conn,
            study_id,
            model_payload,
            engine_version="2.2.0",
            signature="flow-v1-skyscraper",
        )
        print(f"Created model version: {mv.id} (version {mv.version})")
    else:
        print(f"Found existing model version: {existing_models[0].id}")

    # 4. Generate candidate design set (DoE latin hypercube / grid)
    existing_csets = conn.execute(
        "SELECT id, count FROM candidate_sets WHERE study_id = ? AND active = 1;",
        (study_id,),
    ).fetchone()

    if not existing_csets:
        print("Generating 32 candidate concrete mix designs via DoE...")
        params = parameters_repo.list_parameters(conn, study_id)
        candidate_rows = lhs(
            params=params,
            n=32,
            seed=42,
        )
        cset = candidates_repo.create_candidate_set(
            conn=conn,
            study_id=study_id,
            method="lhs",
            settings={"count": 32, "seed": 42},
            candidate_rows=candidate_rows,
        )
        print(f"Created candidate set: {cset.id} with {cset.count} candidates.")

    # 5. Run screening pipeline to evaluate outcomes
    print("Executing simulation screening pipeline across candidates...")
    screening_run = run_screening_pipeline(conn=conn, study_id=study_id)
    print(f"Screening complete: Run ID {screening_run.id}")

    # 6. Add physical lab bench evidence rows (ASTM C39 & Dynamic Shaker Trials)
    existing_ev = evidence_repo.list_evidence(conn, study_id)
    if not existing_ev:
        print("Adding physical benchmark evidence from MTS shake-table & cylinder tests...")
        benchmarks = [
            {
                "label": "Trial Mix A (Standard Baseline UHPC)",
                "values": {
                    "water_binder_ratio": 0.24,
                    "silica_fume_ratio": 0.10,
                    "polymer_cement_ratio": 0.0,
                    "fiber_volume_fraction": 0.5,
                    "wind_speed_gust": 42.0,
                },
                "outcomes": {
                    "top_acceleration": 28.4,
                    "compressive_strength": 118.5,
                    "damping_ratio": 1.45,
                    "embodied_carbon": 435.0,
                },
                "protocol": "ASTM C39 28d cylinder + 1:100 aeroelastic wind tunnel test",
            },
            {
                "label": "Trial Mix B (Viscoelastic Damped ECC)",
                "values": {
                    "water_binder_ratio": 0.22,
                    "silica_fume_ratio": 0.15,
                    "polymer_cement_ratio": 5.0,
                    "fiber_volume_fraction": 1.5,
                    "wind_speed_gust": 42.0,
                },
                "outcomes": {
                    "top_acceleration": 13.8,
                    "compressive_strength": 124.0,
                    "damping_ratio": 3.42,
                    "embodied_carbon": 448.0,
                },
                "protocol": "ASTM C39 / C1018 flexural toughness + dynamic shaker modal ring-down",
            },
            {
                "label": "Trial Mix C (High-Volume Pozzolan + Polymer)",
                "values": {
                    "water_binder_ratio": 0.20,
                    "silica_fume_ratio": 0.22,
                    "polymer_cement_ratio": 7.0,
                    "fiber_volume_fraction": 2.0,
                    "wind_speed_gust": 42.0,
                },
                "outcomes": {
                    "top_acceleration": 10.9,
                    "compressive_strength": 131.2,
                    "damping_ratio": 4.18,
                    "embodied_carbon": 412.0,
                },
                "protocol": "MTS dynamic actuator resonance sweep at 0.25 Hz",
            },
        ]

        for b in benchmarks:
            ev_payload = EvidenceCreate(
                kind="lab",
                values=b["values"],
                outcomes=b["outcomes"],
                status="valid",
            )
            evidence_repo.create_evidence(conn, study_id, ev_payload)
        print("Inserted 3 physical evidence benchmark points.")

    conn.commit()
    print(f"\nSUCCESS: Study '{study_id}' is ready with 3D model, candidates, evaluated screening, and evidence!")
    return study_id


if __name__ == "__main__":
    main()
