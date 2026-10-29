#!/usr/bin/env python3
"""Export curated example studies from a local database into the bundled first-run seed.

The output (``lattice_server/seeds/example_studies.sql``) is applied by
``lattice_server.examples.seed_example_studies`` on server start. It is idempotent: every row is
``INSERT OR IGNORE`` under its original primary key, so databases that already contain these
studies are left untouched.

Safety / integrity (AGENTS.md hard rules):
* The source database is opened read-only; it is never modified (rules 3 and 4).
* Nothing is invented. Rows are copied verbatim. The only additions are labels that say the data
  is illustrative (study description / empty evidence notes) and one ``example_seeded`` audit row.
* If an example's latest screening run is stale against its current evidence, the run is
  recomputed with the real screening pipeline on a *temporary copy* of the database, so first-time
  users do not open an example that shows a "stale" warning.
* Only the latest screening run per study is exported, to keep the bundle small and the examples
  uncluttered by experimentation history.
* Known leftover test records (``EXCLUDED_EVIDENCE``) are not exported; the run is recomputed
  without them.

Usage (from ``server/``):
    uv run python scripts/export_example_seed.py
    uv run python scripts/export_example_seed.py --source ../data/lattice.sqlite
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

from lattice_server import config, db
from lattice_server.screening.pipeline import compute_evidence_fingerprint, run_screening_pipeline

# Existing, user-curated studies chosen as first-run examples. IDs are kept so that databases that
# already hold them (e.g. the developer database) are not duplicated.
EXAMPLE_STUDY_IDS = [
    "std_8762436bdd7f400f8b20",  # Tunnel Blast Mitigation (Example)
    "std_796e920d7c2a4caaace4",  # Microchannel Cold Plate Optimization (Physics)
    "std_963895eb68f8499087c8",  # Smart Damped Cement Skyscraper (Civil & Materials)
    "std_1e778353e1b74901b002",  # Microfluidic Emulsion & Microcapsule Quality (Microscopy)
    "std_02a4c5337c3442abb142",  # Hair Keratin Tribology & Cuticle Abrasion Wear (Microscopy)
]

# Leftover test records that must not ship as examples. They are retracted (the schema's one
# permitted evidence transition) on the scratch copy only, so the recomputed screening run's
# evidence fingerprint matches the exported evidence set. Nothing is deleted anywhere.
EXCLUDED_EVIDENCE = {
    "evi_ecfd02f82b124438a7cb": (
        "stress-test artifact: water_binder_ratio=1.1e10 and silica_fume_ratio=2.0 are far outside "
        "the declared parameter ranges; note tag [BENCH-RUN-7237223213]"
    ),
}

DISCLAIMER = "Example values — replace with your own."
EVIDENCE_NOTE = "Illustrative example record — not a real measurement."
OUTPUT_PATH = config.PACKAGE_DIR / "seeds" / "example_studies.sql"


def lit(value: Any) -> str:
    """Render a Python value as an exact SQL literal."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"Cannot export non-finite number: {value!r}")
        return repr(value)
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError("Cannot export text containing NUL")
        return "'" + value.replace("'", "''") + "'"
    raise TypeError(f"Unsupported SQL value type: {type(value).__name__}")


def insert_stmt(table: str, row: sqlite3.Row, overrides: dict[str, Any] | None = None) -> str:
    cols = row.keys()
    values = [(overrides or {}).get(c, row[c]) for c in cols]
    return (
        f"INSERT OR IGNORE INTO {table} ({', '.join(cols)}) "
        f"VALUES ({', '.join(lit(v) for v in values)});"
    )


def snapshot_source(source: Path, workdir: Path) -> sqlite3.Connection:
    """Copy the (read-only) source database into a temp file and open the copy."""
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst_path = workdir / "snapshot.sqlite"
    dst = sqlite3.connect(dst_path)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    return db.connect(dst_path)


def retract_excluded_evidence(conn: sqlite3.Connection) -> None:
    """On the scratch copy, retract records we refuse to ship (see EXCLUDED_EVIDENCE)."""
    for evidence_id, reason in EXCLUDED_EVIDENCE.items():
        row = conn.execute(
            "SELECT retracted_at FROM evidence WHERE id = ?", (evidence_id,)
        ).fetchone()
        if row is None:
            raise SystemExit(f"{evidence_id}: excluded evidence id not found in source")
        if row["retracted_at"] is None:
            conn.execute(
                "UPDATE evidence SET retracted_at = ?, retraction_reason = ? WHERE id = ?",
                ("2026-10-29T00:00:00+00:00", f"Excluded from example bundle: {reason}", evidence_id),
            )
    conn.commit()


def refresh_stale_runs(conn: sqlite3.Connection) -> None:
    """Recompute a study's screening run when its latest run no longer matches its evidence."""
    for study_id in EXAMPLE_STUDY_IDS:
        latest = conn.execute(
            "SELECT * FROM screening_runs WHERE study_id = ? ORDER BY created_at DESC LIMIT 1",
            (study_id,),
        ).fetchone()
        if latest is None:
            raise SystemExit(f"{study_id}: no screening run to export")
        current = compute_evidence_fingerprint(conn, study_id)
        if latest["evidence_fingerprint"] == current:
            continue
        settings = json.loads(latest["settings_json"] or "{}")
        print(f"{study_id}: latest run is stale -> recomputing with settings {settings}")
        run_screening_pipeline(conn=conn, study_id=study_id, settings=settings, actor="system")
        conn.commit()


def export_study(conn: sqlite3.Connection, study_id: str) -> list[str]:
    study = conn.execute("SELECT * FROM studies WHERE id = ?", (study_id,)).fetchone()
    if study is None:
        raise SystemExit(f"{study_id}: study not found in source database")
    for table in ("overrides", "run_sheets"):
        n = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE study_id = ?", (study_id,)).fetchone()[0]
        if n:
            raise SystemExit(f"{study_id}: has {n} {table} rows; exporter does not curate those")

    run = conn.execute(
        "SELECT * FROM screening_runs WHERE study_id = ? ORDER BY created_at DESC LIMIT 1",
        (study_id,),
    ).fetchone()
    if run["evidence_fingerprint"] != compute_evidence_fingerprint(conn, study_id):
        raise SystemExit(f"{study_id}: latest run is stale; refresh failed")

    set_ids = {run["candidate_set_id"]} | {
        r["id"]
        for r in conn.execute(
            "SELECT id FROM candidate_sets WHERE study_id = ? AND active = 1", (study_id,)
        )
    }
    description = study["description"]
    if DISCLAIMER not in description:
        description = f"{description} {DISCLAIMER}".strip()

    out: list[str] = [f"-- example-study: {study_id}  ({study['name']})"]
    # Audit row first, and only when the study is not yet present, so re-runs and databases that
    # already contain the study never gain a misleading "seeded" entry.
    out.append(
        "INSERT INTO audit_log (study_id, at, actor, action, entity, entity_id, details_json) "
        f"SELECT {lit(study_id)}, strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'), 'system', "
        f"'example_seeded', 'study', {lit(study_id)}, "
        f"{lit(json.dumps({'bundle': 'example_studies', 'version': 1}, sort_keys=True))} "
        f"WHERE NOT EXISTS (SELECT 1 FROM studies WHERE id = {lit(study_id)});"
    )
    out.append(insert_stmt("studies", study, {"description": description, "archived": 0}))

    def rows(sql: str, *params: Any) -> list[sqlite3.Row]:
        return conn.execute(sql, params).fetchall()

    for r in rows("SELECT * FROM sources WHERE study_id = ? ORDER BY created_at, id", study_id):
        out.append(insert_stmt("sources", r))
    for r in rows("SELECT * FROM parameters WHERE study_id = ? ORDER BY position, id", study_id):
        out.append(insert_stmt("parameters", r))
    for r in rows("SELECT * FROM outcomes WHERE study_id = ? ORDER BY position, id", study_id):
        out.append(insert_stmt("outcomes", r))
    for r in rows("SELECT * FROM constraints WHERE study_id = ? ORDER BY position, id", study_id):
        out.append(insert_stmt("constraints", r))
    for r in rows("SELECT * FROM model_versions WHERE study_id = ? ORDER BY version", study_id):
        out.append(insert_stmt("model_versions", r))
    for sid in sorted(set_ids):
        out.append(insert_stmt("candidate_sets", conn.execute(
            "SELECT * FROM candidate_sets WHERE id = ?", (sid,)).fetchone()))
        for r in rows("SELECT * FROM candidates WHERE candidate_set_id = ? ORDER BY idx", sid):
            out.append(insert_stmt("candidates", r))

    analyses = rows("SELECT * FROM analyses WHERE study_id = ? ORDER BY created_at, id", study_id)
    job_ids = sorted({j for j in [run["job_id"], *[a["job_id"] for a in analyses]] if j})
    for jid in job_ids:
        out.append(insert_stmt("jobs", conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)).fetchone()))
    out.append(insert_stmt("screening_runs", run))
    for r in rows(
        "SELECT * FROM decisions WHERE screening_run_id = ? ORDER BY candidate_id", run["id"]
    ):
        out.append(insert_stmt("decisions", r))
    for a in analyses:
        out.append(insert_stmt("analyses", a))
    # created_at then rowid keeps superseded evidence ahead of its replacement (self-FK).
    for r in rows("SELECT * FROM evidence WHERE study_id = ? ORDER BY created_at, rowid", study_id):
        if r["id"] in EXCLUDED_EVIDENCE:
            continue
        overrides = {"notes": EVIDENCE_NOTE} if not (r["notes"] or "").strip() else None
        out.append(insert_stmt("evidence", r, overrides))
    out.append("")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--source", type=Path, default=config.DB_PATH)
    parser.add_argument("--out", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="lattice-example-export-") as tmp:
        conn = snapshot_source(args.source.resolve(), Path(tmp))
        try:
            retract_excluded_evidence(conn)
            refresh_stale_runs(conn)
            lines = [
                "-- GENERATED by server/scripts/export_example_seed.py. Do not edit by hand.",
                "-- One self-contained block per study (INSERT OR IGNORE under original IDs).",
                "-- Applied by lattice_server.examples.seed_example_studies(), which wraps the blocks",
                "-- of studies that are not yet present in a single transaction.",
            ]
            for study_id in EXAMPLE_STUDY_IDS:
                lines.extend(export_study(conn, study_id))
        finally:
            conn.close()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    size_kb = args.out.stat().st_size / 1024
    print(f"Wrote {args.out} ({size_kb:.0f} KiB, {len(EXAMPLE_STUDY_IDS)} studies)")


if __name__ == "__main__":
    main()
