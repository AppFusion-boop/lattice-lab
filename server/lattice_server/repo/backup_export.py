"""Repository for database backups and study ZIP export (§4.5, §6)."""

from __future__ import annotations

import csv
import io
import json
import sqlite3
import zipfile
from datetime import UTC, datetime
from typing import Any

from lattice_server import config
from lattice_server.audit import write_audit
from lattice_server.repo import (
    constraints as constraints_repo,
)
from lattice_server.repo import (
    outcomes as outcomes_repo,
)
from lattice_server.repo import (
    parameters as parameters_repo,
)
from lattice_server.repo import (
    sources as sources_repo,
)
from lattice_server.repo import (
    studies as studies_repo,
)
from lattice_server.schemas import BackupResponse


def create_backup(conn: sqlite3.Connection, study_id: str | None = None) -> BackupResponse:
    """Backup the SQLite database to data/backups/lattice-<timestamp>.sqlite using SQLite online backup API."""
    config.ensure_directories()
    now_utc = datetime.now(UTC)
    ts = now_utc.strftime("%Y%m%d_%H%M%S")
    backup_filename = f"lattice-{ts}.sqlite"
    backup_path = config.DATA_DIR / "backups" / backup_filename

    dest_conn = sqlite3.connect(backup_path)
    try:
        conn.backup(dest_conn)
    finally:
        dest_conn.close()

    size_bytes = backup_path.stat().st_size

    write_audit(
        conn=conn,
        action="backup",
        entity="database",
        study_id=study_id,
        details={"backup_file": backup_filename, "size_bytes": size_bytes},
    )
    conn.commit()

    return BackupResponse(
        filename=backup_filename,
        created_at=now_utc.isoformat(),
        size_bytes=size_bytes,
    )


def auto_backup_if_needed(conn: sqlite3.Connection) -> BackupResponse | None:
    """Perform auto-backup on server startup if the newest backup is older than 24 hours."""
    config.ensure_directories()
    backups_dir = config.DATA_DIR / "backups"
    backup_files = list(backups_dir.glob("lattice-*.sqlite"))

    now_ts = datetime.now(UTC).timestamp()
    needs_backup = False

    if not backup_files:
        needs_backup = True
    else:
        newest_mtime = max(f.stat().st_mtime for f in backup_files)
        # 24 hours = 86400 seconds
        if now_ts - newest_mtime > 86400:
            needs_backup = True

    if needs_backup:
        try:
            return create_backup(conn)
        except (sqlite3.Error, OSError):
            return None
    return None


def generate_study_export_zip(conn: sqlite3.Connection, study_id: str) -> bytes:
    """Generate a complete standalone ZIP export for a study (§6, P2-5)."""
    study = studies_repo.get_study(conn, study_id)
    if not study:
        raise ValueError(f"Study '{study_id}' not found")

    parameters = parameters_repo.list_parameters(conn, study_id)
    outcomes = outcomes_repo.list_outcomes(conn, study_id)
    constraints = constraints_repo.list_constraints(conn, study_id)
    sources = sources_repo.list_sources(conn, study_id)

    # Active candidate set
    active_set_row = conn.execute(
        "SELECT id, method, settings_json, parameters_hash, count, active, created_at FROM candidate_sets WHERE study_id = ? AND active = 1",
        (study_id,),
    ).fetchone()
    active_set = dict(active_set_row) if active_set_row else None

    # Latest screening run for active set (if any)
    latest_run_row = conn.execute(
        "SELECT id, created_at FROM screening_runs WHERE study_id = ? ORDER BY created_at DESC LIMIT 1",
        (study_id,),
    ).fetchone()

    now_iso = datetime.now(UTC).isoformat()

    # 1. study.json
    study_json_data = {
        "study": study.model_dump(),
        "parameters": [p.model_dump() for p in parameters],
        "outcomes": [o.model_dump() for o in outcomes],
        "constraints": [c.model_dump() for c in constraints],
        "sources": [s.model_dump() for s in sources],
        "active_candidate_set": active_set,
        "latest_screening_run_id": latest_run_row["id"] if latest_run_row else None,
        "exported_at": now_iso,
        "generator": "Lattice Lab 2.2.0",
    }
    study_json_bytes = json.dumps(study_json_data, indent=2).encode("utf-8")

    # 2. evidence.csv
    evidence_rows = conn.execute(
        """
        SELECT e.id, e.kind, e.source_id, s.citation as source_citation,
               e.status, e.status_reason, e.values_json, e.outcomes_json,
               e.recorded_at, e.created_at, e.supersedes_id, e.retracted_at, e.retraction_reason
        FROM evidence e
        LEFT JOIN sources s ON e.source_id = s.id
        WHERE e.study_id = ?
        ORDER BY e.created_at ASC
        """,
        (study_id,),
    ).fetchall()

    evidence_buf = io.StringIO()
    evidence_writer = csv.writer(evidence_buf)

    evidence_headers = [
        "id",
        "kind",
        "source_id",
        "source_citation",
        "status",
        "status_reason",
        "recorded_at",
        "created_at",
        "supersedes_id",
        "retracted_at",
        "retraction_reason",
    ]
    for p in parameters:
        u = f" [{p.unit}]" if p.unit else ""
        evidence_headers.append(f"{p.key}{u}")
    for o in outcomes:
        u = f" [{o.unit}]" if o.unit else ""
        evidence_headers.append(f"{o.key}{u}")
        evidence_headers.append(f"{o.key}_sd")
        evidence_headers.append(f"{o.key}_n")

    evidence_writer.writerow(evidence_headers)

    for er in evidence_rows:
        val_map = json.loads(er["values_json"]) if er["values_json"] else {}
        out_map = json.loads(er["outcomes_json"]) if er["outcomes_json"] else {}

        row_vals: list[Any] = [
            er["id"],
            er["kind"],
            er["source_id"] or "",
            er["source_citation"] or "",
            er["status"],
            er["status_reason"] or "",
            er["recorded_at"] or "",
            er["created_at"],
            er["supersedes_id"] or "",
            er["retracted_at"] or "",
            er["retraction_reason"] or "",
        ]

        for p in parameters:
            row_vals.append(val_map.get(p.key, ""))

        for o in outcomes:
            o_data = out_map.get(o.key, {})
            if isinstance(o_data, dict):
                row_vals.append(o_data.get("value", ""))
                row_vals.append(o_data.get("sd", ""))
                row_vals.append(o_data.get("n", ""))
            else:
                row_vals.append(o_data if o_data is not None else "")
                row_vals.append("")
                row_vals.append("")

        evidence_writer.writerow(row_vals)

    evidence_csv_bytes = evidence_buf.getvalue().encode("utf-8")

    # 3. candidates.csv
    candidates_buf = io.StringIO()
    candidates_writer = csv.writer(candidates_buf)

    cand_headers = ["candidate_id", "idx"]
    for p in parameters:
        u = f" [{p.unit}]" if p.unit else ""
        cand_headers.append(f"{p.key}{u}")
    cand_headers.extend([
        "screening_status",
        "screening_filter",
        "p_hat",
        "p_upper",
        "screening_reason",
    ])
    candidates_writer.writerow(cand_headers)

    if active_set:
        cands = conn.execute(
            "SELECT id, idx, values_json FROM candidates WHERE candidate_set_id = ? ORDER BY idx ASC, id ASC",
            (active_set["id"],),
        ).fetchall()

        decisions_by_cand: dict[str, sqlite3.Row] = {}
        if latest_run_row:
            decisions = conn.execute(
                "SELECT candidate_id, status, filter, p_hat, p_upper, reason FROM decisions WHERE screening_run_id = ?",
                (latest_run_row["id"],),
            ).fetchall()
            decisions_by_cand = {d["candidate_id"]: d for d in decisions}

        for c in cands:
            c_vals = json.loads(c["values_json"]) if c["values_json"] else {}
            dec = decisions_by_cand.get(c["id"])

            row_line: list[Any] = [c["id"], c["idx"] if c["idx"] is not None else ""]
            for p in parameters:
                row_line.append(c_vals.get(p.key, ""))

            if dec:
                row_line.extend([
                    dec["status"],
                    dec["filter"],
                    f"{dec['p_hat']:.4f}" if dec["p_hat"] is not None else "",
                    f"{dec['p_upper']:.4f}" if dec["p_upper"] is not None else "",
                    dec["reason"],
                ])
            else:
                row_line.extend(["open", "none", "", "", "No screening run"])

            candidates_writer.writerow(row_line)

    candidates_csv_bytes = candidates_buf.getvalue().encode("utf-8")

    # 4. audit.csv
    audit_rows = conn.execute(
        """
        SELECT id, at, actor, action, entity, entity_id, details_json
        FROM audit_log
        WHERE study_id = ?
        ORDER BY id ASC
        """,
        (study_id,),
    ).fetchall()

    audit_buf = io.StringIO()
    audit_writer = csv.writer(audit_buf)
    audit_writer.writerow(["id", "at", "actor", "action", "entity", "entity_id", "details"])
    for ar in audit_rows:
        audit_writer.writerow([
            ar["id"],
            ar["at"],
            ar["actor"],
            ar["action"],
            ar["entity"],
            ar["entity_id"] or "",
            ar["details_json"],
        ])
    audit_csv_bytes = audit_buf.getvalue().encode("utf-8")

    # 5. model_versions/
    model_version_rows = conn.execute(
        """
        SELECT id, signature, project_json, parameter_bindings_json, outcome_bindings_json, notes, created_at
        FROM model_versions
        WHERE study_id = ?
        ORDER BY created_at ASC
        """,
        (study_id,),
    ).fetchall()

    # 6. README.txt
    readme_content = f"""Lattice Lab Study Export Archive
================================
Study ID: {study.id}
Study Name: {study.name}
Domain: {study.domain}
Exported At: {now_iso}
Generator: Lattice Lab 2.2.0

Files included in this archive:
1. study.json
   Complete study schema including parameters, outcomes, constraints, sources,
   and candidate set metadata.

2. evidence.csv
   All experimental, laboratory, literature, and simulation evidence records
   associated with this study, including canonical unit values and retraction audit details.

3. candidates.csv
   Design-of-experiments (DoE) candidate variants from the active candidate set,
   joined with the latest screening run decisions, exclusion filters, and bounds.

4. audit.csv
   Append-only change log recording every mutation, parameter change, evidence entry,
   override, and screening run.

5. model_versions/
   Computational flow models, simulation project definitions, and port bindings registered
   for this study.

This archive is self-contained and formatted for reproducible analysis in Python, R, or Excel.
"""
    readme_bytes = readme_content.encode("utf-8")

    # Build ZIP archive
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.txt", readme_bytes)
        zf.writestr("study.json", study_json_bytes)
        zf.writestr("evidence.csv", evidence_csv_bytes)
        zf.writestr("candidates.csv", candidates_csv_bytes)
        zf.writestr("audit.csv", audit_csv_bytes)

        if model_version_rows:
            for mvr in model_version_rows:
                mv_obj = {
                    "id": mvr["id"],
                    "signature": mvr["signature"],
                    "notes": mvr["notes"],
                    "created_at": mvr["created_at"],
                    "project": json.loads(mvr["project_json"]) if mvr["project_json"] else {},
                    "parameter_bindings": json.loads(mvr["parameter_bindings_json"]) if mvr["parameter_bindings_json"] else [],
                    "outcome_bindings": json.loads(mvr["outcome_bindings_json"]) if mvr["outcome_bindings_json"] else [],
                }
                zf.writestr(f"model_versions/{mvr['id']}.json", json.dumps(mv_obj, indent=2).encode("utf-8"))
        else:
            zf.writestr("model_versions/README.txt", b"No computational models registered for this study yet.\n")

    return zip_buf.getvalue()
