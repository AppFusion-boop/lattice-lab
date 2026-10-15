"""Design of Experiments (DoE) candidate generators: Grid, LHS, Sobol."""

from __future__ import annotations

import hashlib
import itertools
import json
import math
from typing import Any

import numpy as np
from scipy.stats import qmc

from lattice_server.schemas import ParameterResponse

MAX_CANDIDATE_LIMIT = 250_000


class TooManyCandidatesError(Exception):
    """Raised when candidate generation exceeds the allowed limit."""


def compute_parameters_hash(params: list[ParameterResponse]) -> str:
    """Compute canonical SHA-256 hash of controlled parameter definitions."""
    controlled = [p for p in params if p.role == "controlled"]
    sorted_params = sorted(controlled, key=lambda p: p.key)
    canonical = [
        {"key": p.key, "kind": p.kind, "unit": p.unit, "spec": p.spec}
        for p in sorted_params
    ]
    raw_json = json.dumps(canonical, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw_json).hexdigest()


def _get_parameter_levels(p: ParameterResponse) -> list[Any]:
    spec = p.spec
    kind = p.kind

    if kind == "continuous":
        if spec.get("values"):
            return [float(v) for v in spec["values"]]
        levels = int(spec.get("levels", 10))
        scale = spec.get("scale", "linear")
        low = float(spec["min"])
        high = float(spec["max"])
        if scale == "log":
            return [float(v) for v in np.geomspace(low, high, levels)]
        return [float(v) for v in np.linspace(low, high, levels)]

    if kind == "integer":
        if spec.get("values"):
            return [int(v) for v in spec["values"]]
        low = int(spec["min"])
        high = int(spec["max"])
        step = int(spec.get("step", 1))
        full_range = list(range(low, high + 1, step))
        if "levels" in spec and spec["levels"] and spec["levels"] < len(full_range):
            indices = np.round(np.linspace(0, len(full_range) - 1, int(spec["levels"]))).astype(int)
            return [full_range[i] for i in indices]
        return full_range

    if kind == "categorical":
        return list(spec.get("options", []))

    raise ValueError(f"Unsupported parameter kind: {kind}")


def grid(params: list[ParameterResponse]) -> list[dict[str, Any]]:
    """Generate candidates via Cartesian product of parameter levels.

    Raises TooManyCandidatesError if product exceeds 250,000.
    """
    controlled = [p for p in params if p.role == "controlled"]
    if not controlled:
        return []

    levels_per_param: list[list[Any]] = []
    total_count = 1
    for p in controlled:
        levs = _get_parameter_levels(p)
        if not levs:
            return []
        levels_per_param.append(levs)
        total_count *= len(levs)
        if total_count > MAX_CANDIDATE_LIMIT:
            raise TooManyCandidatesError(
                f"Grid generation produced {total_count:,} candidates, exceeding the limit of "
                f"{MAX_CANDIDATE_LIMIT:,}. Consider using Latin Hypercube Sampling (LHS) or Sobol sequence instead."
            )

    candidates: list[dict[str, Any]] = []
    keys = [p.key for p in controlled]
    for combo in itertools.product(*levels_per_param):
        candidates.append(dict(zip(keys, combo, strict=False)))

    return candidates


def _transform_unit_samples(
    unit_samples: np.ndarray,
    controlled: list[ParameterResponse],
) -> list[dict[str, Any]]:
    """Transform unit hypercube samples in [0, 1)^d to parameter values."""
    n_samples = unit_samples.shape[0]
    out_cols: list[list[Any]] = []

    for j, p in enumerate(controlled):
        u = unit_samples[:, j]
        spec = p.spec
        kind = p.kind

        if kind == "continuous":
            scale = spec.get("scale", "linear")
            low = float(spec["min"])
            high = float(spec["max"])
            if scale == "log":
                log_low = math.log(low)
                log_high = math.log(high)
                vals = [float(v) for v in np.exp(log_low + u * (log_high - log_low))]
            else:
                vals = [float(v) for v in (low + u * (high - low))]
            out_cols.append(vals)

        elif kind == "integer":
            low = int(spec["min"])
            high = int(spec["max"])
            step = int(spec.get("step", 1))
            val = low + u * (high - low)
            rounded = np.round((val - low) / step) * step + low
            clipped = np.clip(rounded, low, high).astype(int)
            out_cols.append([int(v) for v in clipped])

        elif kind == "categorical":
            options = spec.get("options", [])
            k = len(options)
            idx = np.floor(u * k).astype(int)
            idx = np.clip(idx, 0, k - 1)
            out_cols.append([options[i] for i in idx])

        else:
            raise ValueError(f"Unsupported parameter kind: {kind}")

    candidates: list[dict[str, Any]] = []
    keys = [p.key for p in controlled]
    for i in range(n_samples):
        row = {keys[j]: out_cols[j][i] for j in range(len(keys))}
        candidates.append(row)

    return candidates


def lhs(
    params: list[ParameterResponse],
    n: int = 1000,
    seed: int | None = None,
) -> list[dict[str, Any]]:
    """Generate candidates via Latin Hypercube Sampling (LHS)."""
    controlled = [p for p in params if p.role == "controlled"]
    if not controlled or n <= 0:
        return []

    if n > MAX_CANDIDATE_LIMIT:
        raise TooManyCandidatesError(
            f"Requested candidate count {n:,} exceeds maximum limit of {MAX_CANDIDATE_LIMIT:,}."
        )

    d = len(controlled)
    sampler = qmc.LatinHypercube(d=d, seed=seed)
    unit_samples = sampler.random(n=n)
    return _transform_unit_samples(unit_samples, controlled)


def sobol(
    params: list[ParameterResponse],
    n: int = 1024,
    seed: int | None = None,
) -> list[dict[str, Any]]:
    """Generate candidates via Sobol sequence (scrambled).

    Count n is rounded up to the nearest power of 2.
    """
    controlled = [p for p in params if p.role == "controlled"]
    if not controlled or n <= 0:
        return []

    # Round n up to next power of 2
    n_effective = 2 ** math.ceil(math.log2(max(1, n)))
    if n_effective > MAX_CANDIDATE_LIMIT:
        raise TooManyCandidatesError(
            f"Sobol sequence rounded count {n_effective:,} exceeds maximum limit of {MAX_CANDIDATE_LIMIT:,}."
        )

    d = len(controlled)
    sampler = qmc.Sobol(d=d, scramble=True, seed=seed)
    unit_samples = sampler.random(n=n_effective)
    return _transform_unit_samples(unit_samples, controlled)
