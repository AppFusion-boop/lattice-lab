"""Buckingham Pi Theorem Automated Dimensional Analysis Reducer (§4.1, T4-1)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pint

from lattice_server.schemas import OutcomeResponse, ParameterResponse
from lattice_server.units import normalize_unit, ureg

BASE_DIMS = [
    "[length]",
    "[mass]",
    "[time]",
    "[temperature]",
    "[substance]",
    "[current]",
    "[luminosity]",
]


@dataclass(frozen=True)
class PiGroup:
    name: str
    expression: str
    exponents: dict[str, float]


@dataclass(frozen=True)
class DimensionalAnalysisResult:
    total_variables: int
    dimensional_rank: int
    num_pi_groups: int
    reduction_summary: str
    pi_groups: list[PiGroup]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def get_dimension_vector(unit_str: str) -> np.ndarray | None:
    norm_u = normalize_unit(unit_str)
    if not norm_u or norm_u == "percent":
        return np.zeros(len(BASE_DIMS), dtype=np.float64)
    try:
        q = ureg.Quantity(1.0, norm_u)
        dims = q.dimensionality
        return np.array([float(dims.get(d, 0.0)) for d in BASE_DIMS], dtype=np.float64)
    except (pint.UndefinedUnitError, pint.DimensionalityError, ValueError, TypeError):
        return None


def compute_buckingham_pi(
    parameters: list[ParameterResponse],
    outcomes: list[OutcomeResponse],
) -> DimensionalAnalysisResult:
    """Compute dimensionless Π groups via SVD nullspace of the Pint dimensional matrix."""
    vars_info: list[tuple[str, np.ndarray]] = []
    for p in parameters:
        if p.kind in ("continuous", "integer") and p.unit:
            vec = get_dimension_vector(p.unit)
            if vec is not None and np.any(vec != 0):
                vars_info.append((p.key, vec))
    for o in outcomes:
        if o.kind == "continuous" and o.unit:
            vec = get_dimension_vector(o.unit)
            if vec is not None and np.any(vec != 0):
                vars_info.append((o.key, vec))

    k = len(vars_info)
    if k == 0:
        return DimensionalAnalysisResult(
            total_variables=0,
            dimensional_rank=0,
            num_pi_groups=0,
            reduction_summary="No dimensional physical units defined on parameters/outcomes.",
            pi_groups=[],
        )

    names = [v[0] for v in vars_info]
    D = np.column_stack([v[1] for v in vars_info])  # shape (7, k)
    rank = int(np.linalg.matrix_rank(D, tol=1e-9))
    num_pi = max(0, k - rank)

    if num_pi == 0:
        return DimensionalAnalysisResult(
            total_variables=k,
            dimensional_rank=rank,
            num_pi_groups=0,
            reduction_summary=f"{k} dimensional variables have full rank {rank} (0 dimensionless groups).",
            pi_groups=[],
        )

    # Extract nullspace basis via SVD of D
    _u, _s, vt = np.linalg.svd(D, full_matrices=True)
    null_rows = vt[rank:, :]  # shape (num_pi, k)

    pi_groups: list[PiGroup] = []
    for idx in range(num_pi):
        vec = null_rows[idx].copy()
        nz = np.abs(vec[np.abs(vec) > 1e-4])
        if len(nz) > 0:
            vec = vec / np.min(nz)
        vec = np.round(vec, 2)
        exps = {names[j]: float(vec[j]) for j in range(k) if abs(vec[j]) > 1e-3}
        num_parts = [
            f"{k_name}" if exp == 1.0 else f"{k_name}^{exp:g}"
            for k_name, exp in exps.items()
            if exp > 0
        ]
        den_parts = [
            f"{k_name}" if abs(exp) == 1.0 else f"{k_name}^{abs(exp):g}"
            for k_name, exp in exps.items()
            if exp < 0
        ]
        num_str = " * ".join(num_parts) if num_parts else "1"
        expr_str = f"({num_str}) / ({' * '.join(den_parts)})" if den_parts else num_str
        pi_groups.append(PiGroup(name=f"Π_{idx + 1}", expression=expr_str, exponents=exps))

    summary = (
        f"Buckingham Π Theorem: {k} physical variables across {rank} fundamental dimensions "
        f"collapse into {num_pi} independent dimensionless group(s), reducing grid complexity "
        f"from 10^{k} to 10^{num_pi}."
    )
    return DimensionalAnalysisResult(
        total_variables=k,
        dimensional_rank=rank,
        num_pi_groups=num_pi,
        reduction_summary=summary,
        pi_groups=pi_groups,
    )
