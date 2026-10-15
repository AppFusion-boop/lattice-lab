"""Python engine bridge for invoking the headless Node.js simulation engine."""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from lattice_server import config
from lattice_server.errors import ApiHttpError


@dataclass
class RowResult:
    id: str
    status: Literal["ok", "error"]
    outcomes: dict[str, float]
    message: str | None = None
    node_errors: dict[str, str] = field(default_factory=dict)


class BudgetExceededError(ApiHttpError):
    def __init__(self, estimated: int, limit: int):
        super().__init__(
            status_code=409,
            code="budget_exceeded",
            message=f"Simulation budget exceeded: {estimated} evaluations > limit {limit}",
            details={"estimated": estimated, "limit": limit},
        )


def resolve_engine_command() -> list[str]:
    """Resolve the engine invocation command into an executable command list."""
    parts = shlex.split(config.ENGINE_CMD)
    if not parts:
        parts = ["node_modules/.bin/tsx", "scripts/eval-batch.ts"]

    cmd0 = parts[0]
    # Check if relative to REPO_ROOT
    candidate0 = config.REPO_ROOT / cmd0
    if candidate0.exists() and os.access(candidate0, os.X_OK):
        parts[0] = str(candidate0.resolve())
    elif not shutil.which(cmd0):
        # If cmd0 is tsx, try npx tsx
        if shutil.which("npx"):
            parts = ["npx"] + parts

    # Check second argument (the script file)
    if len(parts) > 1 and parts[1].endswith(".ts"):
        script_cand = config.REPO_ROOT / parts[1]
        if script_cand.exists():
            parts[1] = str(script_cand.resolve())

    return parts


def health() -> dict[str, Any]:
    """Smoke test the engine CLI by running a 1-row evaluation."""
    cmd = resolve_engine_command()

    # Minimal project: empty node graph
    header = {
        "project": {
            "version": 3,
            "name": "Health check",
            "duration": 1,
            "sampleRate": 100,
            "nodes": [],
            "edges": [],
            "tools": [],
        },
        "parameterBindings": [],
        "outcomeBindings": [],
    }
    row = {"id": "smoke", "values": {}}

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(config.REPO_ROOT),
        )
        input_data = json.dumps(header) + "\n" + json.dumps(row) + "\n"
        stdout, stderr = proc.communicate(input=input_data, timeout=30.0)

        if proc.returncode != 0:
            return {
                "ok": False,
                "error": f"Engine exited with code {proc.returncode}: {stderr.strip()}",
            }

        lines = [line.strip() for line in stdout.splitlines() if line.strip()]
        if not lines:
            return {"ok": False, "error": "No output from engine"}

        last_line = json.loads(lines[-1])
        return {
            "ok": True,
            "engine_version": last_line.get("engineVersion", "unknown"),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _run_single_chunk(
    cmd: list[str],
    header_dict: dict[str, Any],
    chunk_rows: list[dict[str, Any]],
    timeout_s: float,
    cancelled_cb: Callable[[], bool] | None = None,
) -> list[RowResult]:
    """Execute a single chunk of rows in a subprocess."""
    if cancelled_cb and cancelled_cb():
        return [
            RowResult(id=r["id"], status="error", outcomes={}, message="Cancelled")
            for r in chunk_rows
        ]

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(config.REPO_ROOT),
    )

    try:
        # Prepare stdin
        payload = [json.dumps(header_dict)]
        for r in chunk_rows:
            payload.append(json.dumps(r))
        payload_str = "\n".join(payload) + "\n"

        stdout, stderr = proc.communicate(input=payload_str, timeout=timeout_s)

        if proc.returncode != 0:
            err_msg = f"Engine exited with code {proc.returncode}: {stderr.strip()}"
            return [
                RowResult(id=r["id"], status="error", outcomes={}, message=err_msg)
                for r in chunk_rows
            ]

        results: list[RowResult] = []
        lines = [line.strip() for line in stdout.splitlines() if line.strip()]

        # The last line is the done summary line: {"done": true, ...}
        for line in lines:
            try:
                data = json.loads(line)
                if data.get("done") is True:
                    continue
                results.append(
                    RowResult(
                        id=data.get("id", "unknown"),
                        status=data.get("status", "error"),
                        outcomes=data.get("outcomes", {}),
                        message=data.get("message"),
                        node_errors=data.get("nodeErrors", {}),
                    )
                )
            except Exception as parse_err:
                results.append(
                    RowResult(
                        id="unknown",
                        status="error",
                        outcomes={},
                        message=f"JSON parse error: {parse_err}",
                    )
                )

        return results

    except subprocess.TimeoutExpired:
        proc.kill()
        return [
            RowResult(
                id=r["id"],
                status="error",
                outcomes={},
                message=f"Simulation timed out after {timeout_s}s",
            )
            for r in chunk_rows
        ]
    except Exception as exc:
        proc.kill()
        return [
            RowResult(id=r["id"], status="error", outcomes={}, message=str(exc))
            for r in chunk_rows
        ]


def evaluate(
    project: dict[str, Any],
    param_bindings: list[dict[str, Any]],
    outcome_bindings: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    *,
    progress: Callable[[float], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
    timeout_per_chunk: float = 120.0,
    chunk_size: int = 500,
) -> list[RowResult]:
    """Evaluate rows through the simulation engine in parallel chunks.

    Maintains input order of rows in the returned list.
    """
    if not rows:
        return []

    cmd = resolve_engine_command()
    norm_pb = []
    for pb in param_bindings:
        norm_pb.append({
            "parameterKey": pb.get("parameterKey") or pb.get("parameter_key"),
            "nodeId": pb.get("nodeId") or pb.get("node_id"),
            "paramKey": pb.get("paramKey") or pb.get("param_key"),
            "notInModel": bool(pb.get("notInModel", pb.get("not_in_model", False))),
        })
    norm_ob = []
    for ob in outcome_bindings:
        norm_ob.append({
            "outcomeKey": ob.get("outcomeKey") or ob.get("outcome_key"),
            "nodeId": ob.get("nodeId") or ob.get("node_id"),
            "port": ob.get("port"),
            "reducer": ob.get("reducer"),
            "threshold": ob.get("threshold", 0.0),
        })

    header_dict = {
        "project": project,
        "parameterBindings": norm_pb,
        "outcomeBindings": norm_ob,
    }

    # Split rows into chunks
    chunks: list[tuple[int, list[dict[str, Any]]]] = []
    for i in range(0, len(rows), chunk_size):
        chunks.append((i, rows[i : i + chunk_size]))

    max_workers = max(1, (os.cpu_count() or 2) - 1)
    # If only 1 chunk, avoid executor overhead
    if len(chunks) == 1:
        if progress:
            progress(0.1)
        res = _run_single_chunk(
            cmd, header_dict, chunks[0][1], timeout_per_chunk, cancelled
        )
        if progress:
            progress(1.0)
        return res

    indexed_results: list[tuple[int, list[RowResult]]] = []
    completed_rows = 0
    total_rows = len(rows)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_chunk = {
            executor.submit(
                _run_single_chunk,
                cmd,
                header_dict,
                chunk,
                timeout_per_chunk,
                cancelled,
            ): (idx, chunk)
            for idx, chunk in chunks
        }

        for future in as_completed(future_to_chunk):
            if cancelled and cancelled():
                # Cancel remaining
                executor.shutdown(wait=False, cancel_futures=True)
                break

            idx, chunk = future_to_chunk[future]
            try:
                chunk_res = future.result()
            except Exception as exc:
                chunk_res = [
                    RowResult(id=r["id"], status="error", outcomes={}, message=str(exc))
                    for r in chunk
                ]

            indexed_results.append((idx, chunk_res))
            completed_rows += len(chunk)
            if progress:
                progress(min(1.0, completed_rows / total_rows))

    # Sort chunks back into original order
    indexed_results.sort(key=lambda x: x[0])
    ordered_results: list[RowResult] = []
    for _, chunk_res in indexed_results:
        ordered_results.extend(chunk_res)

    return ordered_results

