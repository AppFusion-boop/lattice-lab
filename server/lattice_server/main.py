from __future__ import annotations

import shutil
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from lattice_server import config, db
from lattice_server.api.analyses import router as analyses_router
from lattice_server.api.audit import router as audit_router
from lattice_server.api.backup_export import router as backup_export_router
from lattice_server.api.calibration import router as calibration_router
from lattice_server.api.candidates import router as candidates_router
from lattice_server.api.constraints import router as constraints_router
from lattice_server.api.evidence import router as evidence_router
from lattice_server.api.expressions import router as expressions_router
from lattice_server.api.imports import router as imports_router
from lattice_server.api.jobs import router as jobs_router
from lattice_server.api.models import router as models_router
from lattice_server.api.outcomes import router as outcomes_router
from lattice_server.api.overrides import router as overrides_router
from lattice_server.api.parameters import router as parameters_router
from lattice_server.api.pareto import router as pareto_router
from lattice_server.api.reports import router as reports_router
from lattice_server.api.run_sheets import router as run_sheets_router
from lattice_server.api.screening import router as screening_router
from lattice_server.api.sensitivity import router as sensitivity_router
from lattice_server.api.sources import router as sources_router
from lattice_server.api.studies import router as studies_router
from lattice_server.errors import (
    ApiHttpError,
    api_http_error_handler,
    conflict_error_handler,
    validation_error_handler,
    value_error_handler,
)
from lattice_server.jobs import job_manager
from lattice_server.repo import backup_export as backup_export_repo
from lattice_server.repo.parameters import ConflictError


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run migrations on startup
    db.migrate()
    conn = db.connect()
    try:
        backup_export_repo.auto_backup_if_needed(conn)
    finally:
        conn.close()
    job_manager.startup()
    yield
    job_manager.shutdown(wait=False)


app = FastAPI(
    title="Lattice Lab API",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)

# Exception handlers matching §6 API contract
app.add_exception_handler(ApiHttpError, api_http_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(ConflictError, conflict_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(ValueError, value_error_handler)  # type: ignore[arg-type]


@app.get("/openapi.json", include_in_schema=False)
def openapi_alias() -> dict[str, Any]:
    return app.openapi()


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API v1 routers
app.include_router(studies_router, prefix="/api/v1")
app.include_router(parameters_router, prefix="/api/v1")
app.include_router(outcomes_router, prefix="/api/v1")
app.include_router(constraints_router, prefix="/api/v1")
app.include_router(candidates_router, prefix="/api/v1")
app.include_router(expressions_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(models_router, prefix="/api/v1")
app.include_router(overrides_router, prefix="/api/v1")
app.include_router(screening_router, prefix="/api/v1")
app.include_router(sources_router, prefix="/api/v1")
app.include_router(evidence_router, prefix="/api/v1")
app.include_router(imports_router, prefix="/api/v1")
app.include_router(run_sheets_router, prefix="/api/v1")
app.include_router(audit_router, prefix="/api/v1")
app.include_router(backup_export_router, prefix="/api/v1")
app.include_router(sensitivity_router, prefix="/api/v1")
app.include_router(pareto_router, prefix="/api/v1")
app.include_router(calibration_router, prefix="/api/v1")
app.include_router(analyses_router, prefix="/api/v1")
app.include_router(reports_router, prefix="/api/v1")


@app.get("/api/v1/health")
def health() -> dict[str, Any]:
    cmd_parts = config.ENGINE_CMD.split()
    first_cmd = cmd_parts[0] if cmd_parts else "node"
    engine_available = bool(
        (config.REPO_ROOT / first_cmd).exists()
        or shutil.which(first_cmd)
        or shutil.which("node")
    )

    return {
        "status": "ok",
        "version": app.version,
        "db_path": str(config.DB_PATH),
        "engine_ok": engine_available,
    }
