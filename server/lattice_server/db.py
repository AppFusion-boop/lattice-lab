from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import Depends

from lattice_server import config


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    config.ensure_directories()
    target = db_path or config.DB_PATH
    conn = sqlite3.connect(target, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def get_current_version(conn: sqlite3.Connection) -> int:
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version';"
    )
    if not cursor.fetchone():
        return 0
    row = conn.execute("SELECT MAX(version) AS v FROM schema_version;").fetchone()
    if row and row["v"] is not None:
        return int(row["v"])
    return 0


def get_available_migrations(migrations_dir: Path | None = None) -> list[tuple[int, Path]]:
    mdir = migrations_dir or config.MIGRATIONS_DIR
    if not mdir.exists():
        return []
    migrations: list[tuple[int, Path]] = []
    pattern = re.compile(r"^(\d{4})_.*\.sql$")
    for file in mdir.iterdir():
        if file.is_file():
            match = pattern.match(file.name)
            if match:
                version = int(match.group(1))
                migrations.append((version, file))
    migrations.sort(key=lambda x: x[0])
    return migrations


def migrate(conn: sqlite3.Connection | None = None, migrations_dir: Path | None = None) -> int:
    own_conn = conn is None
    c = conn or connect()
    try:
        migrations = get_available_migrations(migrations_dir)
        max_available = migrations[-1][0] if migrations else 0
        current_version = get_current_version(c)

        if current_version > max_available:
            raise RuntimeError(
                f"Database version ({current_version}) is newer than latest available migration ({max_available})."
            )

        for version, path in migrations:
            if version > current_version:
                sql = path.read_text(encoding="utf-8")
                with c:
                    c.executescript(sql)
                    # Verify or record version
                    new_version = get_current_version(c)
                    if new_version < version:
                        c.execute("INSERT INTO schema_version (version) VALUES (?);", (version,))
                current_version = version

        return current_version
    finally:
        if own_conn:
            c.close()


def get_db():
    """FastAPI dependency for obtaining a database connection with transaction context."""
    conn = connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


DbConn = Annotated[sqlite3.Connection, Depends(get_db)]

