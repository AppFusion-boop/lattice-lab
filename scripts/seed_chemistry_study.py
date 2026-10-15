#!/usr/bin/env python3
"""Seed 3D Molecular Flow model into the pharmacology study in lattice.sqlite."""

import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "data" / "lattice.sqlite"
STUDY_ID = "std_cafd0a825d4c429e947b"

def get_molecular_project_json() -> str:
    cmd = [
        "npx", "tsx", "-e",
        'import { molecularProject } from "./src/core/molecule-demo.ts"; console.log(JSON.stringify(molecularProject()));'
    ]
    res = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, check=True)
    # The last line should be the JSON string (in case tsx outputs deprecation warnings before it)
    lines = [line.strip() for line in res.stdout.strip().split("\n") if line.strip().startswith("{")]
    if not lines:
        raise RuntimeError(f"Failed to extract project JSON: {res.stdout} {res.stderr}")
    return lines[-1]

def main() -> None:
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}")
        sys.exit(1)

    print("Extracting 3D molecular flow project from TypeScript...")
    project_json_str = get_molecular_project_json()
    project = json.loads(project_json_str)
    print(f"Project loaded: {len(project.get('nodes', []))} nodes, {len(project.get('edges', []))} edges.")
    scene = next((n for n in project["nodes"] if n["kind"] == "scene3d"), None)
    if scene:
        print(f"3D Scene found: {len(scene.get('params', {}).get('objects', []))} 3D molecular objects.")

    param_bindings = [
        {"parameter_key": "mw", "node_id": "node_mw_calc", "param_key": "a", "not_in_model": False},
        {"parameter_key": "logp", "node_id": "node_logp_calc", "param_key": "a", "not_in_model": False},
        {"parameter_key": "tpsa", "node_id": "node_tpsa_calc", "param_key": "a", "not_in_model": False},
        {"parameter_key": "hbd", "node_id": "node_hbd_calc", "param_key": "a", "not_in_model": False},
        {"parameter_key": "hba", "node_id": "node_hba_calc", "param_key": "a", "not_in_model": False},
        {"parameter_key": "rot_bonds", "node_id": "node_rot_bonds_calc", "param_key": "a", "not_in_model": False},
    ]

    outcome_bindings = [
        {"outcome_key": "caco2_papp", "node_id": "node_perm", "port": "result", "reducer": "value"},
        {"outcome_key": "cytotoxic", "node_id": "node_tox", "port": "result", "reducer": "value"},
    ]

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Verify study exists
    study = conn.execute("SELECT * FROM studies WHERE id = ?", (STUDY_ID,)).fetchone()
    if not study:
        print(f"Study {STUDY_ID} not found!")
        sys.exit(1)

    print(f"Targeting study: '{study['name']}' ({STUDY_ID})")

    # Check existing model versions
    existing = conn.execute("SELECT id, version FROM model_versions WHERE study_id = ?", (STUDY_ID,)).fetchall()
    if existing:
        print(f"Existing model versions found: {[r['id'] for r in existing]}. Updating latest version...")
        model_id = existing[0]["id"]
        conn.execute(
            """
            UPDATE model_versions
            SET project_json = ?, parameter_bindings_json = ?, outcome_bindings_json = ?, notes = ?
            WHERE id = ?
            """,
            (
                project_json_str,
                json.dumps(param_bindings),
                json.dumps(outcome_bindings),
                "3D Molecular Kinase Lead & Caco-2 Permeability Model (v1)",
                model_id,
            ),
        )
    else:
        model_id = "mod_chem_" + STUDY_ID[-8:]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """
            INSERT INTO model_versions (
                id, study_id, version, kind, project_json, parameter_bindings_json,
                outcome_bindings_json, engine_version, signature, validation_status,
                validation_json, notes, created_at
            )
            VALUES (?, ?, 1, 'flow', ?, ?, ?, 'git', 'sha256-chem-v1', 'unvalidated', NULL, ?, ?)
            """,
            (
                model_id,
                STUDY_ID,
                project_json_str,
                json.dumps(param_bindings),
                json.dumps(outcome_bindings),
                "3D Molecular Kinase Lead & Caco-2 Permeability Model (v1)",
                now,
            ),
        )

    conn.commit()
    print(f"Successfully seeded model version '{model_id}' for study '{STUDY_ID}'.")

if __name__ == "__main__":
    main()
