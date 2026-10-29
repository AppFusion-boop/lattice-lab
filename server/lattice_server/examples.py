"""First-run example studies.

Applies the bundled, generated ``seeds/example_studies.sql`` so that a new installation opens with
worked examples instead of an empty study list.

Properties (see also ``scripts/export_example_seed.py``, which generates the bundle):

* **Idempotent.** A study that already exists is skipped entirely; the rows for missing studies are
  ``INSERT OR IGNORE`` under fixed primary keys. Running again, or against a database that
  already holds these studies (e.g. the developer database), changes nothing.
* **Never destructive.** It only inserts. It cannot delete or edit studies, evidence, or the audit
  log (AGENTS.md hard rules 3 and 4). Studies a user archives stay archived, because they still
  exist and are therefore not re-inserted.
* **All-or-nothing.** The bundle runs in one transaction; on any error it is rolled back.
* **Opt-out.** Set ``LATTICE_SEED_EXAMPLES=0`` to skip seeding (e.g. a production instance that
  should start empty). Tests disable it by default.
"""

from __future__ import annotations

import logging
import os
import re
import sqlite3

from lattice_server import config, db

logger = logging.getLogger(__name__)

SEED_FILE = config.PACKAGE_DIR / "seeds" / "example_studies.sql"
_STUDY_MARKER = re.compile(r"^-- example-study: (\S+)", re.MULTILINE)
_BLOCK_SPLIT = re.compile(r"^(?=-- example-study: )", re.MULTILINE)
_FALSE_VALUES = {"0", "false", "no", "off"}


def seeding_enabled() -> bool:
    return os.environ.get("LATTICE_SEED_EXAMPLES", "1").strip().lower() not in _FALSE_VALUES


def _blocks(sql: str) -> dict[str, str]:
    """Split the bundle into one self-contained SQL block per study, keyed by study id."""
    out: dict[str, str] = {}
    for chunk in _BLOCK_SPLIT.split(sql):
        m = _STUDY_MARKER.match(chunk)
        if m:
            out[m.group(1)] = chunk
    return out


def example_study_ids() -> list[str]:
    """IDs of the studies contained in the bundle, in bundle order."""
    return list(_blocks(SEED_FILE.read_text(encoding="utf-8")))


def seed_example_studies(conn: sqlite3.Connection | None = None) -> list[str]:
    """Insert every bundled example study that is not yet present.

    A study that already exists is skipped entirely (none of its rows are touched), so databases
    that already hold an example, or a user's own edits to one, are never altered.
    Returns the IDs of the studies that were newly created (empty when nothing was needed).
    The schema must already be migrated.
    """
    if not seeding_enabled() or not SEED_FILE.exists():
        return []

    own_conn = conn is None
    c = conn or db.connect()
    try:
        blocks = _blocks(SEED_FILE.read_text(encoding="utf-8"))
        if not blocks:
            return []
        marks = ",".join("?" for _ in blocks)
        present = {
            row["id"]
            for row in c.execute(f"SELECT id FROM studies WHERE id IN ({marks})", list(blocks))
        }
        missing = [sid for sid in blocks if sid not in present]
        if not missing:
            return []

        script = "PRAGMA foreign_keys = ON;\nBEGIN IMMEDIATE;\n"
        script += "\n".join(blocks[sid] for sid in missing)
        script += "\nCOMMIT;\n"
        try:
            c.executescript(script)
        except Exception:
            # executescript leaves the explicit BEGIN open on failure; undo everything.
            if c.in_transaction:
                c.rollback()
            logger.exception("Seeding example studies failed; rolled back")
            raise
        logger.info("Seeded %d example studies: %s", len(missing), ", ".join(missing))
        return missing
    finally:
        if own_conn:
            c.close()
