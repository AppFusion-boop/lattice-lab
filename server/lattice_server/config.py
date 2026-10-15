from __future__ import annotations

import os
from pathlib import Path

# Package root: server/lattice_server
PACKAGE_DIR = Path(__file__).resolve().parent
# Server dir: server/
SERVER_DIR = PACKAGE_DIR.parent
# Default repo root: repo/
DEFAULT_REPO_ROOT = SERVER_DIR.parent

REPO_ROOT = Path(os.environ.get("LATTICE_REPO_ROOT", str(DEFAULT_REPO_ROOT))).resolve()
DATA_DIR = Path(os.environ.get("LATTICE_DATA_DIR", str(REPO_ROOT / "data"))).resolve()
PORT = int(os.environ.get("LATTICE_PORT", "8765"))
ENGINE_CMD = os.environ.get("LATTICE_ENGINE_CMD", "node_modules/.bin/tsx scripts/eval-batch.ts")

DB_PATH = DATA_DIR / "lattice.sqlite"
MIGRATIONS_DIR = PACKAGE_DIR / "migrations"


def ensure_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "backups").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "imports").mkdir(parents=True, exist_ok=True)
