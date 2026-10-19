"""Repository for full study package export and import (.lat ZIP format).

Preserves 100% of study metadata, parameters, outcomes, constraints, flow
models, 3D scenes/meshes, candidate sets, candidates, screening decisions, run
sheets, evidence (immutable), analyses, and audit logs.
"""

from __future__ import annotations

import contextlib
import io
import json
import sqlite3
import zipfile
from datetime import UTC, datetime
from typing import Any

from lattice_server import config, ids
from lattice_server.audit import write_audit
from lattice_server.schemas import StudyResponse


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def export_vertices_to_obj(vertices: list[float], name: str = "Mesh") -> str:
    """Format a flat array of vertex coordinates into standard Wavefront OBJ."""
    lines = [f"# Lattice Lab 3D Mesh: {name}", f"o {name}"]
    num_verts = len(vertices) // 3
    for i in range(0, len(vertices), 3):
        lines.append(f"v {vertices[i]:.6f} {vertices[i+1]:.6f} {vertices[i+2]:.6f}")
    # Faces (1-indexed in OBJ, triangles)
    for i in range(1, num_verts + 1, 3):
        lines.append(f"f {i} {i+1} {i+2}")
    return "\n".join(lines) + "\n"


def export_study_package(conn: sqlite3.Connection, study_id: str) -> bytes:
    """Generate a complete standalone .lat archive for a study."""
    study_row = conn.execute("SELECT * FROM studies WHERE id = ?", (study_id,)).fetchone()
    if not study_row:
        raise ValueError(f"Study '{study_id}' not found")
    study_data = _row_to_dict(study_row)

    # 1. Fetch all associated relational entities
    parameters = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM parameters WHERE study_id = ? ORDER BY position ASC, id ASC", (study_id,)
    ).fetchall()]

    outcomes = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM outcomes WHERE study_id = ? ORDER BY position ASC, id ASC", (study_id,)
    ).fetchall()]

    sources = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM sources WHERE study_id = ? ORDER BY created_at ASC, id ASC", (study_id,)
    ).fetchall()]

    constraints = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM constraints WHERE study_id = ? ORDER BY position ASC, id ASC", (study_id,)
    ).fetchall()]

    model_versions = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM model_versions WHERE study_id = ? ORDER BY version ASC, id ASC", (study_id,)
    ).fetchall()]

    candidate_sets = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM candidate_sets WHERE study_id = ? ORDER BY created_at ASC, id ASC", (study_id,)
    ).fetchall()]

    cs_ids = [cs["id"] for cs in candidate_sets]
    if cs_ids:
        placeholders = ",".join("?" for _ in cs_ids)
        candidates = [_row_to_dict(r) for r in conn.execute(
            f"SELECT * FROM candidates WHERE candidate_set_id IN ({placeholders}) ORDER BY candidate_set_id ASC, idx ASC",
            cs_ids,
        ).fetchall()]
    else:
        candidates = []

    screening_runs = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM screening_runs WHERE study_id = ? ORDER BY created_at ASC, id ASC", (study_id,)
    ).fetchall()]

    sr_ids = [sr["id"] for sr in screening_runs]
    if sr_ids:
        placeholders = ",".join("?" for _ in sr_ids)
        decisions = [_row_to_dict(r) for r in conn.execute(
            f"SELECT * FROM decisions WHERE screening_run_id IN ({placeholders}) ORDER BY screening_run_id ASC, candidate_id ASC",
            sr_ids,
        ).fetchall()]
    else:
        decisions = []

    run_sheets = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM run_sheets WHERE study_id = ? ORDER BY created_at ASC, id ASC", (study_id,)
    ).fetchall()]

    evidence = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM evidence WHERE study_id = ? ORDER BY created_at ASC, id ASC", (study_id,)
    ).fetchall()]

    overrides = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM overrides WHERE study_id = ? ORDER BY created_at ASC, id ASC", (study_id,)
    ).fetchall()]

    analyses = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM analyses WHERE study_id = ? ORDER BY created_at ASC, id ASC", (study_id,)
    ).fetchall()]

    audit_log = [_row_to_dict(r) for r in conn.execute(
        "SELECT * FROM audit_log WHERE study_id = ? ORDER BY id ASC", (study_id,)
    ).fetchall()]

    # 2. Extract 3D models and mesh assets
    mesh_assets: dict[str, bytes] = {}
    model_assets: dict[str, bytes] = {}

    # Bundle any mesh objects in flow project nodes as OBJ files
    for mv in model_versions:
        proj_str = mv.get("project_json")
        if not proj_str:
            continue
        with contextlib.suppress(json.JSONDecodeError, KeyError, TypeError):
            proj = json.loads(proj_str) if isinstance(proj_str, str) else proj_str
            nodes = proj.get("nodes", [])
            for node in nodes:
                node_id = node.get("id", "node")
                params = node.get("params", {})
                objects = params.get("objects", [])
                if isinstance(objects, list):
                    for obj in objects:
                        if isinstance(obj, dict) and obj.get("shape") == "mesh" and obj.get("vertices"):
                            vertices = obj.get("vertices")
                            obj_id = obj.get("id", "mesh")
                            obj_name = obj.get("name", "object")
                            obj_content = export_vertices_to_obj(vertices, obj_name)
                            mesh_assets[f"assets/meshes/{node_id}_{obj_id}.obj"] = obj_content.encode("utf-8")

    # Bundle standard 3D scene models from public/models if available
    public_models_dir = config.REPO_ROOT / "public" / "models"
    if public_models_dir.exists():
        for file_path in public_models_dir.rglob("*"):
            if file_path.is_file():
                rel_path = file_path.relative_to(public_models_dir)
                arc_path = f"assets/models/{rel_path.as_posix()}"
                with contextlib.suppress(OSError):
                    model_assets[arc_path] = file_path.read_bytes()

    # 3. Create Manifest
    now_iso = datetime.now(UTC).isoformat()
    manifest = {
        "format_version": 1,
        "file_type": "lattice_study_package",
        "app_version": "2.2.0",
        "study_id": study_id,
        "study_name": study_data["name"],
        "domain": study_data.get("domain", "generic"),
        "exported_at": now_iso,
        "counts": {
            "parameters": len(parameters),
            "outcomes": len(outcomes),
            "constraints": len(constraints),
            "sources": len(sources),
            "model_versions": len(model_versions),
            "candidate_sets": len(candidate_sets),
            "candidates": len(candidates),
            "screening_runs": len(screening_runs),
            "decisions": len(decisions),
            "run_sheets": len(run_sheets),
            "evidence": len(evidence),
            "overrides": len(overrides),
            "analyses": len(analyses),
            "audit_entries": len(audit_log),
            "mesh_assets": len(mesh_assets),
            "model_assets": len(model_assets),
        },
    }

    # 4. Construct human-readable README
    readme_text = f"""Lattice Lab Complete Study Package (.lat)
===========================================
Study: {study_data['name']}
Domain: {study_data.get('domain', 'generic')}
Exported: {now_iso}
Generator: Lattice Lab 2.2.0

This package is a self-contained, reproducible archive of the complete scientific study.
It includes all parameters, constraints, computational flow models, 3D scenes,
DoE candidates, screening exclusion decisions, lab run sheets, experimental evidence,
and audit logs.

Contents:
- manifest.json: Package metadata and record counts
- study.json: Core study definition and configuration
- parameters.json: Input design factors and uncertainty distributions
- outcomes.json: Evaluated physical response metrics and criteria
- sources.json: Provenance, literature citations, and reference records
- constraints.json: Hard and soft physical constraints
- model_versions.json: Computational models, flow graphs, and port bindings
- candidate_sets.json: Design-of-experiments candidate collections
- candidates.json: Individual design variants and factor values
- screening_runs.json: Multi-criteria Bayesian screening execution records
- decisions.json: Individual candidate status, exclusion filters, and bounds
- run_sheets.json: Randomized lab and field protocols
- evidence.json: Append-only physical and simulation observations
- overrides.json: Human-in-the-loop expert overrides
- analyses.json: Sensitivity, TOST equivalence, and backtest results
- audit_log.json: Cryptographically reproducible append-only provenance log
- assets/: 3D model files (GLB, textures) and exported 3D meshes (OBJ)

To import this study into any Lattice Lab instance:
Use the 'Import Study (.lat)' button on the Studies dashboard, or POST to /api/v1/studies/package/import.
"""

    # 5. Build ZIP
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2).encode("utf-8"))
        zf.writestr("README.txt", readme_text.encode("utf-8"))
        zf.writestr("study.json", json.dumps(study_data, indent=2).encode("utf-8"))
        zf.writestr("parameters.json", json.dumps(parameters, indent=2).encode("utf-8"))
        zf.writestr("outcomes.json", json.dumps(outcomes, indent=2).encode("utf-8"))
        zf.writestr("sources.json", json.dumps(sources, indent=2).encode("utf-8"))
        zf.writestr("constraints.json", json.dumps(constraints, indent=2).encode("utf-8"))
        zf.writestr("model_versions.json", json.dumps(model_versions, indent=2).encode("utf-8"))
        zf.writestr("candidate_sets.json", json.dumps(candidate_sets, indent=2).encode("utf-8"))
        zf.writestr("candidates.json", json.dumps(candidates, indent=2).encode("utf-8"))
        zf.writestr("screening_runs.json", json.dumps(screening_runs, indent=2).encode("utf-8"))
        zf.writestr("decisions.json", json.dumps(decisions, indent=2).encode("utf-8"))
        zf.writestr("run_sheets.json", json.dumps(run_sheets, indent=2).encode("utf-8"))
        zf.writestr("evidence.json", json.dumps(evidence, indent=2).encode("utf-8"))
        zf.writestr("overrides.json", json.dumps(overrides, indent=2).encode("utf-8"))
        zf.writestr("analyses.json", json.dumps(analyses, indent=2).encode("utf-8"))
        zf.writestr("audit_log.json", json.dumps(audit_log, indent=2).encode("utf-8"))

        for arc_path, content in mesh_assets.items():
            zf.writestr(arc_path, content)

        for arc_path, content in model_assets.items():
            zf.writestr(arc_path, content)

    return zip_buf.getvalue()


def inspect_study_package(zip_bytes: bytes) -> dict[str, Any]:
    """Inspect a .lat package archive without committing any database mutations."""
    if len(zip_bytes) > 100 * 1024 * 1024:
        raise ValueError("Package exceeds maximum supported size (100 MB)")

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except Exception as exc:
        raise ValueError(f"Invalid package archive: {exc}") from exc

    with zf:
        if "manifest.json" not in zf.namelist():
            raise ValueError("Invalid Lattice study package: missing manifest.json")

        try:
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"Corrupted manifest.json: {exc}") from exc

        if manifest.get("file_type") != "lattice_study_package":
            raise ValueError("Archive is not a valid Lattice study package")

        study_data: dict[str, Any] = {}
        if "study.json" in zf.namelist():
            with contextlib.suppress(json.JSONDecodeError, UnicodeDecodeError):
                study_data = json.loads(zf.read("study.json").decode("utf-8"))

        counts = manifest.get("counts", {})
        has_3d = (counts.get("mesh_assets", 0) > 0) or (counts.get("model_assets", 0) > 0)

        return {
            "manifest": manifest,
            "study_name": study_data.get("name") or manifest.get("study_name", "Untitled Study"),
            "description": study_data.get("description", ""),
            "domain": study_data.get("domain") or manifest.get("domain", "generic"),
            "parameters_count": counts.get("parameters", 0),
            "outcomes_count": counts.get("outcomes", 0),
            "constraints_count": counts.get("constraints", 0),
            "candidate_sets_count": counts.get("candidate_sets", 0),
            "candidates_count": counts.get("candidates", 0),
            "screening_runs_count": counts.get("screening_runs", 0),
            "decisions_count": counts.get("decisions", 0),
            "evidence_count": counts.get("evidence", 0),
            "analyses_count": counts.get("analyses", 0),
            "has_3d_models": has_3d,
            "mesh_files_count": counts.get("mesh_assets", 0),
            "created_at": study_data.get("created_at") or manifest.get("exported_at", ""),
            "exported_at": manifest.get("exported_at", ""),
        }


def unpack_study_assets(zf: zipfile.ZipFile) -> None:
    """Extract any 3D model assets into the public/models directory if not already present."""
    models_dir = config.REPO_ROOT / "public" / "models"
    for name in zf.namelist():
        if name.startswith("assets/models/") and not name.endswith("/"):
            rel_path = name[len("assets/models/"):]
            dest_file = (models_dir / rel_path).resolve()
            # Security guard against zip slip
            if not str(dest_file).startswith(str(models_dir.resolve())):
                continue
            dest_file.parent.mkdir(parents=True, exist_ok=True)
            if not dest_file.exists():
                with contextlib.suppress(OSError):
                    dest_file.write_bytes(zf.read(name))


def import_study_package(
    conn: sqlite3.Connection,
    zip_bytes: bytes,
    new_name: str | None = None,
    actor: str = "local-user",
) -> StudyResponse:
    """Import a .lat package archive as a fully functional study with remapped IDs."""
    if len(zip_bytes) > 100 * 1024 * 1024:
        raise ValueError("Package exceeds maximum supported size (100 MB)")

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except Exception as exc:
        raise ValueError(f"Invalid package archive: {exc}") from exc

    with zf:
        if "manifest.json" not in zf.namelist() or "study.json" not in zf.namelist():
            raise ValueError("Invalid Lattice study package: missing manifest.json or study.json")

        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        if manifest.get("file_type") != "lattice_study_package":
            raise ValueError("Archive is not a valid Lattice study package")

        study_data = json.loads(zf.read("study.json").decode("utf-8"))

        def read_json_list(filename: str) -> list[dict[str, Any]]:
            if filename in zf.namelist():
                with contextlib.suppress(json.JSONDecodeError, UnicodeDecodeError):
                    data = json.loads(zf.read(filename).decode("utf-8"))
                    if isinstance(data, list):
                        return data
            return []

        parameters_data = read_json_list("parameters.json")
        outcomes_data = read_json_list("outcomes.json")
        sources_data = read_json_list("sources.json")
        constraints_data = read_json_list("constraints.json")
        model_versions_data = read_json_list("model_versions.json")
        candidate_sets_data = read_json_list("candidate_sets.json")
        candidates_data = read_json_list("candidates.json")
        screening_runs_data = read_json_list("screening_runs.json")
        decisions_data = read_json_list("decisions.json")
        run_sheets_data = read_json_list("run_sheets.json")
        evidence_data = read_json_list("evidence.json")
        overrides_data = read_json_list("overrides.json")
        analyses_data = read_json_list("analyses.json")
        audit_log_data = read_json_list("audit_log.json")

        # Unpack any missing 3D models into public/models
        unpack_study_assets(zf)

    old_study_id = study_data["id"]
    new_study_id = ids.new_id("std")
    now_iso = datetime.now(UTC).isoformat()

    # Determine unique study name
    final_name = (new_name or study_data["name"]).strip()
    existing_row = conn.execute("SELECT id FROM studies WHERE name = ?", (final_name,)).fetchone()
    if existing_row and not new_name:
        final_name = f"{final_name} (Imported)"

    # ID Remapping tables
    source_id_map: dict[str, str] = {s["id"]: ids.new_id("src") for s in sources_data if "id" in s}
    param_id_map: dict[str, str] = {p["id"]: ids.new_id("par") for p in parameters_data if "id" in p}
    outcome_id_map: dict[str, str] = {o["id"]: ids.new_id("out") for o in outcomes_data if "id" in o}
    constraint_id_map: dict[str, str] = {c["id"]: ids.new_id("con") for c in constraints_data if "id" in c}
    mv_id_map: dict[str, str] = {mv["id"]: ids.new_id("mod") for mv in model_versions_data if "id" in mv}
    cs_id_map: dict[str, str] = {cs["id"]: ids.new_id("cst") for cs in candidate_sets_data if "id" in cs}
    cand_id_map: dict[str, str] = {c["id"]: ids.new_id("can") for c in candidates_data if "id" in c}
    sr_id_map: dict[str, str] = {sr["id"]: ids.new_id("scr") for sr in screening_runs_data if "id" in sr}
    rs_id_map: dict[str, str] = {rs["id"]: ids.new_id("rs") for rs in run_sheets_data if "id" in rs}
    ev_id_map: dict[str, str] = {ev["id"]: ids.new_id("ev") for ev in evidence_data if "id" in ev}

    # Execute all imports in a single atomic transaction
    with conn:
        # 1. studies
        settings_raw = study_data.get("settings_json") or study_data.get("settings", {})
        settings_str = settings_raw if isinstance(settings_raw, str) else json.dumps(settings_raw)

        conn.execute(
            """
            INSERT INTO studies (
                id, name, description, domain, exclusion_threshold, confidence,
                cost_expression, budget, max_engine_evaluations, settings_json,
                rng_seed, archived, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_study_id,
                final_name,
                study_data.get("description", ""),
                study_data.get("domain", "generic"),
                float(study_data.get("exclusion_threshold", 0.05)),
                float(study_data.get("confidence", 0.95)),
                study_data.get("cost_expression"),
                float(study_data["budget"]) if study_data.get("budget") is not None else None,
                int(study_data.get("max_engine_evaluations", 50000)),
                settings_str,
                int(study_data.get("rng_seed", 42)),
                0,
                study_data.get("created_at", now_iso),
                now_iso,
            ),
        )

        # 2. sources
        for s in sources_data:
            new_sid = source_id_map[s["id"]]
            conn.execute(
                """
                INSERT INTO sources (id, study_id, kind, citation, doi, url, file_name, file_sha256, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_sid,
                    new_study_id,
                    s["kind"],
                    s.get("citation", ""),
                    s.get("doi"),
                    s.get("url"),
                    s.get("file_name"),
                    s.get("file_sha256"),
                    s.get("notes", ""),
                    s.get("created_at", now_iso),
                ),
            )

        # 3. parameters
        for p in parameters_data:
            new_pid = param_id_map[p["id"]]
            spec_str = p["spec_json"] if isinstance(p.get("spec_json"), str) else json.dumps(p.get("spec_json", {}))
            conn.execute(
                """
                INSERT INTO parameters (id, study_id, key, label, unit, kind, role, spec_json, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_pid,
                    new_study_id,
                    p["key"],
                    p["label"],
                    p.get("unit", ""),
                    p["kind"],
                    p["role"],
                    spec_str,
                    int(p.get("position", 0)),
                ),
            )

        # 4. outcomes
        for o in outcomes_data:
            new_oid = outcome_id_map[o["id"]]
            crit_val = o.get("criterion_json")
            crit_str = crit_val if isinstance(crit_val, (str, type(None))) else json.dumps(crit_val)
            conn.execute(
                """
                INSERT INTO outcomes (id, study_id, key, label, unit, kind, direction, criterion_json, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_oid,
                    new_study_id,
                    o["key"],
                    o["label"],
                    o.get("unit", ""),
                    o["kind"],
                    o.get("direction", "none"),
                    crit_str,
                    int(o.get("position", 0)),
                ),
            )

        # 5. constraints
        for c in constraints_data:
            new_cid = constraint_id_map[c["id"]]
            mapped_src = source_id_map.get(c.get("source_id")) if c.get("source_id") else None
            conn.execute(
                """
                INSERT INTO constraints (id, study_id, label, expression, kind, penalty, rationale, source_id, enabled, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_cid,
                    new_study_id,
                    c["label"],
                    c["expression"],
                    c["kind"],
                    float(c["penalty"]) if c.get("penalty") is not None else None,
                    c["rationale"],
                    mapped_src,
                    int(c.get("enabled", 1)),
                    int(c.get("position", 0)),
                ),
            )

        # 6. model_versions
        for mv in model_versions_data:
            new_mvid = mv_id_map[mv["id"]]

            # Remap parameter bindings
            pb_raw = mv.get("parameter_bindings_json") or []
            pb_list = json.loads(pb_raw) if isinstance(pb_raw, str) else list(pb_raw)
            for b in pb_list:
                if isinstance(b, dict) and "parameter_id" in b and b["parameter_id"] in param_id_map:
                    b["parameter_id"] = param_id_map[b["parameter_id"]]

            # Remap outcome bindings
            ob_raw = mv.get("outcome_bindings_json") or []
            ob_list = json.loads(ob_raw) if isinstance(ob_raw, str) else list(ob_raw)
            for b in ob_list:
                if isinstance(b, dict) and "outcome_id" in b and b["outcome_id"] in outcome_id_map:
                    b["outcome_id"] = outcome_id_map[b["outcome_id"]]

            proj_raw = mv.get("project_json")
            proj_str = proj_raw if isinstance(proj_raw, (str, type(None))) else json.dumps(proj_raw)

            val_raw = mv.get("validation_json")
            val_str = val_raw if isinstance(val_raw, (str, type(None))) else (json.dumps(val_raw) if val_raw else None)

            conn.execute(
                """
                INSERT INTO model_versions (
                    id, study_id, version, kind, project_json, parameter_bindings_json,
                    outcome_bindings_json, engine_version, signature, validation_status,
                    validation_json, notes, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_mvid,
                    new_study_id,
                    int(mv["version"]),
                    mv.get("kind", "flow"),
                    proj_str,
                    json.dumps(pb_list),
                    json.dumps(ob_list),
                    mv.get("engine_version"),
                    mv.get("signature"),
                    mv.get("validation_status", "unvalidated"),
                    val_str,
                    mv.get("notes", ""),
                    mv.get("created_at", now_iso),
                ),
            )

        # 7. candidate_sets
        for cs in candidate_sets_data:
            new_csid = cs_id_map[cs["id"]]
            settings_str = cs["settings_json"] if isinstance(cs.get("settings_json"), str) else json.dumps(cs.get("settings_json", {}))
            conn.execute(
                """
                INSERT INTO candidate_sets (id, study_id, method, settings_json, parameters_hash, count, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_csid,
                    new_study_id,
                    cs["method"],
                    settings_str,
                    cs["parameters_hash"],
                    int(cs["count"]),
                    int(cs.get("active", 0)),
                    cs.get("created_at", now_iso),
                ),
            )

        # 8. candidates
        cand_batch = []
        for c in candidates_data:
            new_cid = cand_id_map[c["id"]]
            mapped_csid = cs_id_map.get(c["candidate_set_id"], c["candidate_set_id"])
            vals_str = c["values_json"] if isinstance(c.get("values_json"), str) else json.dumps(c.get("values_json", {}))
            cand_batch.append((
                new_cid,
                mapped_csid,
                int(c["idx"]),
                c.get("label"),
                vals_str,
                c["values_hash"],
            ))
        if cand_batch:
            conn.executemany(
                """
                INSERT INTO candidates (id, candidate_set_id, idx, label, values_json, values_hash)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                cand_batch,
            )

        # 9. screening_runs
        for sr in screening_runs_data:
            new_srid = sr_id_map[sr["id"]]
            mapped_csid = cs_id_map.get(sr["candidate_set_id"], sr["candidate_set_id"])
            mapped_mvid = mv_id_map.get(sr.get("model_version_id")) if sr.get("model_version_id") else None
            settings_str = sr["settings_json"] if isinstance(sr.get("settings_json"), str) else json.dumps(sr.get("settings_json", {}))
            summary_str = sr["summary_json"] if isinstance(sr.get("summary_json"), str) else json.dumps(sr.get("summary_json", {}))
            conn.execute(
                """
                INSERT INTO screening_runs (
                    id, study_id, candidate_set_id, model_version_id, evidence_fingerprint,
                    settings_json, summary_json, job_id, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_srid,
                    new_study_id,
                    mapped_csid,
                    mapped_mvid,
                    sr.get("evidence_fingerprint", ""),
                    settings_str,
                    summary_str,
                    sr.get("job_id"),
                    sr.get("created_at", now_iso),
                ),
            )

        # 10. decisions
        dec_batch = []
        for d in decisions_data:
            mapped_srid = sr_id_map.get(d["screening_run_id"], d["screening_run_id"])
            mapped_cid = cand_id_map.get(d["candidate_id"], d["candidate_id"])
            det_str = d["details_json"] if isinstance(d.get("details_json"), str) else json.dumps(d.get("details_json", {}))
            dec_batch.append((
                mapped_srid,
                mapped_cid,
                d["status"],
                d["filter"],
                float(d["p_hat"]) if d.get("p_hat") is not None else None,
                float(d["p_upper"]) if d.get("p_upper") is not None else None,
                d["reason"],
                det_str,
            ))
        if dec_batch:
            conn.executemany(
                """
                INSERT INTO decisions (screening_run_id, candidate_id, status, filter, p_hat, p_upper, reason, details_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                dec_batch,
            )

        # 11. run_sheets
        for rs in run_sheets_data:
            new_rsid = rs_id_map[rs["id"]]
            mapped_srid = sr_id_map.get(rs.get("screening_run_id")) if rs.get("screening_run_id") else None

            rows_raw = rs.get("rows_json") or []
            rows_list = json.loads(rows_raw) if isinstance(rows_raw, str) else list(rows_raw)
            for item in rows_list:
                if isinstance(item, dict) and "candidate_id" in item and item["candidate_id"] in cand_id_map:
                    item["candidate_id"] = cand_id_map[item["candidate_id"]]

            conn.execute(
                """
                INSERT INTO run_sheets (id, study_id, screening_run_id, seed, rows_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    new_rsid,
                    new_study_id,
                    mapped_srid,
                    int(rs["seed"]),
                    json.dumps(rows_list),
                    rs.get("created_at", now_iso),
                ),
            )

        # 12. evidence
        for ev in evidence_data:
            new_evid = ev_id_map[ev["id"]]
            mapped_src = source_id_map.get(ev.get("source_id")) if ev.get("source_id") else None
            mapped_cid = cand_id_map.get(ev.get("candidate_id")) if ev.get("candidate_id") else None
            mapped_rsid = rs_id_map.get(ev.get("run_sheet_id")) if ev.get("run_sheet_id") else None
            mapped_sup = ev_id_map.get(ev.get("supersedes_id")) if ev.get("supersedes_id") else None

            v_str = ev["values_json"] if isinstance(ev.get("values_json"), str) else json.dumps(ev.get("values_json", {}))
            o_str = ev["outcomes_json"] if isinstance(ev.get("outcomes_json"), str) else json.dumps(ev.get("outcomes_json", {}))

            conn.execute(
                """
                INSERT INTO evidence (
                    id, study_id, kind, source_id, values_json, outcomes_json,
                    status, status_reason, candidate_id, run_sheet_id, replicate,
                    supersedes_id, recorded_at, recorded_by, notes,
                    retracted_at, retraction_reason, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_evid,
                    new_study_id,
                    ev["kind"],
                    mapped_src,
                    v_str,
                    o_str,
                    ev.get("status", "valid"),
                    ev.get("status_reason"),
                    mapped_cid,
                    mapped_rsid,
                    int(ev["replicate"]) if ev.get("replicate") is not None else None,
                    mapped_sup,
                    ev.get("recorded_at"),
                    ev.get("recorded_by", "local-user"),
                    ev.get("notes", ""),
                    ev.get("retracted_at"),
                    ev.get("retraction_reason"),
                    ev.get("created_at", now_iso),
                ),
            )

        # 13. overrides
        for ov in overrides_data:
            new_ovid = ids.new_id("ov")
            conn.execute(
                """
                INSERT INTO overrides (id, study_id, values_hash, status, reason, created_by, created_at, revoked_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_ovid,
                    new_study_id,
                    ov["values_hash"],
                    ov["status"],
                    ov["reason"],
                    ov.get("created_by", "local-user"),
                    ov.get("created_at", now_iso),
                    ov.get("revoked_at"),
                ),
            )

        # 14. analyses
        for an in analyses_data:
            new_anid = ids.new_id("an")
            mapped_mvid = mv_id_map.get(an.get("model_version_id")) if an.get("model_version_id") else None
            in_str = an["input_json"] if isinstance(an.get("input_json"), str) else json.dumps(an.get("input_json", {}))
            res_str = an["result_json"] if isinstance(an.get("result_json"), str) else json.dumps(an.get("result_json", {}))
            conn.execute(
                """
                INSERT INTO analyses (id, study_id, kind, model_version_id, input_json, result_json, job_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_anid,
                    new_study_id,
                    an["kind"],
                    mapped_mvid,
                    in_str,
                    res_str,
                    an.get("job_id"),
                    an.get("created_at", now_iso),
                ),
            )

        # 15. audit_log
        for al in audit_log_data:
            old_eid = al.get("entity_id")
            mapped_eid = (
                source_id_map.get(old_eid)
                or param_id_map.get(old_eid)
                or outcome_id_map.get(old_eid)
                or constraint_id_map.get(old_eid)
                or mv_id_map.get(old_eid)
                or cs_id_map.get(old_eid)
                or cand_id_map.get(old_eid)
                or sr_id_map.get(old_eid)
                or rs_id_map.get(old_eid)
                or ev_id_map.get(old_eid)
                or old_eid
            ) if old_eid else None

            det_str = al["details_json"] if isinstance(al.get("details_json"), str) else json.dumps(al.get("details_json", {}))

            conn.execute(
                """
                INSERT INTO audit_log (study_id, at, actor, action, entity, entity_id, details_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_study_id,
                    al.get("at", now_iso),
                    al.get("actor", "local-user"),
                    al.get("action", "unknown"),
                    al.get("entity", "unknown"),
                    mapped_eid,
                    det_str,
                ),
            )

        # Record audit log entry for this package import
        write_audit(
            conn=conn,
            action="import_package",
            entity="study",
            entity_id=new_study_id,
            study_id=new_study_id,
            details={
                "original_study_id": old_study_id,
                "original_name": study_data.get("name"),
                "imported_name": final_name,
                "manifest": manifest,
            },
            actor=actor,
        )

    # Return created study response
    res_row = conn.execute("SELECT * FROM studies WHERE id = ?", (new_study_id,)).fetchone()
    if not res_row:
        raise RuntimeError("Failed to retrieve imported study")

    settings_dict = json.loads(res_row["settings_json"]) if res_row["settings_json"] else {}
    return StudyResponse(
        id=res_row["id"],
        name=res_row["name"],
        description=res_row["description"],
        domain=res_row["domain"],
        exclusion_threshold=res_row["exclusion_threshold"],
        confidence=res_row["confidence"],
        cost_expression=res_row["cost_expression"],
        budget=res_row["budget"],
        max_engine_evaluations=res_row["max_engine_evaluations"],
        settings=settings_dict,
        rng_seed=res_row["rng_seed"],
        archived=bool(res_row["archived"]),
        created_at=res_row["created_at"],
        updated_at=res_row["updated_at"],
    )
