"""Tests for study package export, inspection, and import (.lat format)."""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile

from fastapi.testclient import TestClient

from lattice_server.repo import study_package as package_repo


def test_study_package_export_inspect_import_roundtrip(client: TestClient, db_conn: sqlite3.Connection):
    # 1. Create a study via template
    res = client.post("/api/v1/studies/from-template", json={"template": "tunnel_blast", "name": "Tunnel Blast Roundtrip"})
    assert res.status_code == 201
    study_id = res.json()["id"]

    # Add a model version with 3D scene & mesh vertices
    mock_project = {
        "version": 3,
        "name": "3D Flow Model",
        "duration": 5.0,
        "sampleRate": 20,
        "nodes": [
            {
                "id": "scene_node",
                "kind": "scene3d",
                "params": {
                    "dimension": 3,
                    "width": 50,
                    "depth": 10,
                    "height": 5,
                    "objects": [
                        {
                            "id": "mesh_obj_1",
                            "name": "BarrierMesh",
                            "shape": "mesh",
                            "position": {"x": 25, "y": 2, "z": 5},
                            "size": {"x": 2, "y": 4, "z": 2},
                            "rotation": 0,
                            "color": "#89a8b7",
                            "vertices": [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
                        }
                    ],
                },
            }
        ],
        "edges": [],
    }

    study_params = db_conn.execute("SELECT id, key FROM parameters WHERE study_id = ?", (study_id,)).fetchall()
    p_bindings = [{"parameter_id": p["id"], "parameter_key": p["key"], "not_in_model": True} for p in study_params]

    mv_res = client.post(
        f"/api/v1/studies/{study_id}/models",
        json={
            "version": 1,
            "kind": "flow",
            "project": mock_project,
            "parameter_bindings": p_bindings,
            "outcome_bindings": [],
            "notes": "Version with 3D mesh object",
        },
    )
    assert mv_res.status_code == 201

    # Generate DoE candidates
    cs_res = client.post(
        f"/api/v1/studies/{study_id}/candidate-sets",
        json={"method": "lhs", "count": 20},
    )
    assert cs_res.status_code == 201

    # Run screening synchronously via screening pipeline
    from lattice_server.screening.pipeline import run_screening_pipeline
    run_screening_pipeline(db_conn, study_id)

    # Add an evidence record
    params = db_conn.execute("SELECT key FROM parameters WHERE study_id = ?", (study_id,)).fetchall()
    param_vals = {p["key"]: 50.0 for p in params}
    ev_res = client.post(
        f"/api/v1/studies/{study_id}/evidence",
        json={
            "kind": "lab",
            "values": param_vals,
            "outcomes": {"peak_overpressure": {"value": 150.0, "sd": 5.0, "n": 3}},
            "status": "valid",
            "notes": "Lab test run #1",
        },
    )
    assert ev_res.status_code == 201

    # 2. Test export
    lat_bytes = package_repo.export_study_package(db_conn, study_id)
    assert len(lat_bytes) > 0

    # Verify zip content
    with zipfile.ZipFile(io.BytesIO(lat_bytes), "r") as zf:
        namelist = zf.namelist()
        assert "manifest.json" in namelist
        assert "study.json" in namelist
        assert "parameters.json" in namelist
        assert "outcomes.json" in namelist
        assert "constraints.json" in namelist
        assert "model_versions.json" in namelist
        assert "candidate_sets.json" in namelist
        assert "candidates.json" in namelist
        assert "screening_runs.json" in namelist
        assert "decisions.json" in namelist
        assert "evidence.json" in namelist
        assert "audit_log.json" in namelist
        assert "README.txt" in namelist

        # Verify 3D mesh was extracted to assets/meshes/
        mesh_files = [f for f in namelist if f.startswith("assets/meshes/") and f.endswith(".obj")]
        assert len(mesh_files) == 1
        obj_content = zf.read(mesh_files[0]).decode("utf-8")
        assert "v 0.000000 0.000000 0.000000" in obj_content
        assert "f 1 2 3" in obj_content

        expected_cand_count = db_conn.execute(
            "SELECT COUNT(*) as c FROM candidates WHERE candidate_set_id IN (SELECT id FROM candidate_sets WHERE study_id = ?)",
            (study_id,)
        ).fetchone()["c"]
        expected_ev_count = db_conn.execute("SELECT COUNT(*) as c FROM evidence WHERE study_id = ?", (study_id,)).fetchone()["c"]

        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert manifest["file_type"] == "lattice_study_package"
        assert manifest["app_version"] == "2.2.0"
        assert manifest["study_id"] == study_id
        assert manifest["counts"]["candidates"] == expected_cand_count
        assert manifest["counts"]["evidence"] == expected_ev_count
        assert manifest["counts"]["mesh_assets"] == 1

    # 3. Test inspect
    inspected = package_repo.inspect_study_package(lat_bytes)
    assert inspected["study_name"] == "Tunnel Blast Roundtrip"
    assert inspected["domain"] == "physics"
    assert inspected["parameters_count"] > 0
    assert inspected["candidates_count"] == expected_cand_count
    assert inspected["evidence_count"] == expected_ev_count
    assert inspected["has_3d_models"] is True
    assert inspected["mesh_files_count"] == 1
    assert "manifest" in inspected

    # 4. Test import
    imported = package_repo.import_study_package(db_conn, lat_bytes, new_name="Cloned Tunnel Blast")
    assert imported.id != study_id
    assert imported.name == "Cloned Tunnel Blast"

    # Verify remapped parameters
    orig_params = db_conn.execute("SELECT key, label, unit FROM parameters WHERE study_id = ? ORDER BY key", (study_id,)).fetchall()
    new_params = db_conn.execute("SELECT key, label, unit FROM parameters WHERE study_id = ? ORDER BY key", (imported.id,)).fetchall()
    assert len(orig_params) == len(new_params)
    for op, np in zip(orig_params, new_params):
        assert op["key"] == np["key"]
        assert op["label"] == np["label"]
        assert op["unit"] == np["unit"]

    # Verify remapped model versions and preserved 3D vertices
    new_mv_row = db_conn.execute("SELECT project_json FROM model_versions WHERE study_id = ?", (imported.id,)).fetchone()
    assert new_mv_row is not None
    restored_proj = json.loads(new_mv_row["project_json"])
    scene_nodes = [n for n in restored_proj["nodes"] if n["kind"] == "scene3d"]
    assert len(scene_nodes) == 1
    restored_objects = scene_nodes[0]["params"]["objects"]
    assert len(restored_objects) == 1
    assert restored_objects[0]["shape"] == "mesh"
    assert restored_objects[0]["vertices"] == [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]

    # Verify candidate sets & count
    orig_cs = db_conn.execute("SELECT count FROM candidate_sets WHERE study_id = ?", (study_id,)).fetchall()
    new_cs = db_conn.execute("SELECT count FROM candidate_sets WHERE study_id = ?", (imported.id,)).fetchall()
    assert len(orig_cs) == len(new_cs)
    for o_cs, n_cs in zip(orig_cs, new_cs):
        assert o_cs["count"] == n_cs["count"]

    # Verify decisions
    orig_dec_count = db_conn.execute(
        "SELECT COUNT(*) as c FROM decisions WHERE screening_run_id IN (SELECT id FROM screening_runs WHERE study_id = ?)",
        (study_id,)
    ).fetchone()["c"]
    new_dec_count = db_conn.execute(
        "SELECT COUNT(*) as c FROM decisions WHERE screening_run_id IN (SELECT id FROM screening_runs WHERE study_id = ?)",
        (imported.id,)
    ).fetchone()["c"]
    assert orig_dec_count == new_dec_count
    assert new_dec_count > 0

    # Verify evidence
    orig_ev_count = db_conn.execute("SELECT COUNT(*) as c FROM evidence WHERE study_id = ?", (study_id,)).fetchone()["c"]
    new_ev_count = db_conn.execute("SELECT COUNT(*) as c FROM evidence WHERE study_id = ?", (imported.id,)).fetchone()["c"]
    assert orig_ev_count == new_ev_count


def test_study_package_api_endpoints(client: TestClient, db_conn: sqlite3.Connection):
    # Create study via template
    res = client.post("/api/v1/studies/from-template", json={"template": "smart_cement_skyscraper", "name": "Cement Skyscraper Test"})
    assert res.status_code == 201
    study_id = res.json()["id"]

    # Test GET export.lat
    resp = client.get(f"/api/v1/studies/{study_id}/export.lat")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/x-lattice-study"
    assert 'attachment; filename="' in resp.headers["content-disposition"]
    assert resp.headers["content-disposition"].endswith('.lat"')
    lat_bytes = resp.content

    # Test POST /studies/package/inspect
    files = {"file": ("skyscraper.lat", lat_bytes, "application/x-lattice-study")}
    inspect_resp = client.post("/api/v1/studies/package/inspect", files=files)
    assert inspect_resp.status_code == 200
    inspect_data = inspect_resp.json()
    assert inspect_data["study_name"] == "Cement Skyscraper Test"
    assert "counts" in inspect_data["manifest"]

    # Test POST /studies/package/import
    files = {"file": ("skyscraper.lat", lat_bytes, "application/x-lattice-study")}
    data = {"name": "Imported Skyscraper Colleague Copy"}
    import_resp = client.post("/api/v1/studies/package/import", files=files, data=data)
    assert import_resp.status_code == 201
    imported_study = import_resp.json()
    assert imported_study["name"] == "Imported Skyscraper Colleague Copy"
    assert imported_study["id"] != study_id

    # Verify that the newly imported study is immediately accessible via GET
    get_resp = client.get(f"/api/v1/studies/{imported_study['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == imported_study["id"]
