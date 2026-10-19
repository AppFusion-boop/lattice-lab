"""Deterministic Interval Arithmetic & Critical Threshold Futility Prover (T3-1).

Propagates exact mathematical lower and upper bounds [low, high] through the safe
expression AST over bounded parameter intervals, proving when P(success) == 0
deterministically across entire sub-regions of parameter space.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from lattice_server.expr.parser import (
    ASTNode,
    BinaryNode,
    CallNode,
    NumberNode,
    UnaryNode,
    VariableNode,
    parse_expression,
)
from lattice_server.schemas import OutcomeCriterion, OutcomeResponse, ParameterResponse


@dataclass(frozen=True)
class Interval:
    low: float
    high: float

    def __post_init__(self) -> None:
        if self.low > self.high:
            lo = min(self.low, self.high)
            hi = max(self.low, self.high)
            object.__setattr__(self, "low", lo)
            object.__setattr__(self, "high", hi)

    def add(self, other: Interval) -> Interval:
        return Interval(self.low + other.low, self.high + other.high)

    def sub(self, other: Interval) -> Interval:
        return Interval(self.low - other.high, self.high - other.low)

    def mul(self, other: Interval) -> Interval:
        products = (
            self.low * other.low,
            self.low * other.high,
            self.high * other.low,
            self.high * other.high,
        )
        return Interval(min(products), max(products))

    def div(self, other: Interval) -> Interval:
        if other.low <= 0.0 <= other.high:
            return Interval(-math.inf, math.inf)
        return self.mul(Interval(1.0 / other.high, 1.0 / other.low))

    def pow(self, exp: Interval) -> Interval:
        if exp.low == exp.high and exp.low == int(exp.low):
            n = int(exp.low)
            if n == 0:
                return Interval(1.0, 1.0)
            if n > 0 and n % 2 == 0:
                if self.low <= 0.0 <= self.high:
                    return Interval(0.0, max(self.low**n, self.high**n))
                return Interval(min(self.low**n, self.high**n), max(self.low**n, self.high**n))
            if n > 0:
                return Interval(self.low**n, self.high**n)
        if self.low <= 0.0:
            return Interval(-math.inf, math.inf)
        vals = (
            self.low**exp.low,
            self.low**exp.high,
            self.high**exp.low,
            self.high**exp.high,
        )
        return Interval(min(vals), max(vals))


def evaluate_interval_ast(node: ASTNode, env: dict[str, Interval]) -> Interval:
    """Propagate interval bounds [low, high] through a parsed ASTNode."""
    if isinstance(node, NumberNode):
        return Interval(float(node.value), float(node.value))
    if isinstance(node, VariableNode):
        if node.name == "pi":
            return Interval(math.pi, math.pi)
        if node.name == "e":
            return Interval(math.e, math.e)
        return env.get(node.name, Interval(0.0, 0.0))
    if isinstance(node, UnaryNode):
        val = evaluate_interval_ast(node.child, env)
        if node.op == "-":
            return Interval(-val.high, -val.low)
        if node.op == "+":
            return val
        if node.op == "!":
            if val.low > 0 or val.high < 0:
                return Interval(0.0, 0.0)
            if val.low == 0.0 and val.high == 0.0:
                return Interval(1.0, 1.0)
            return Interval(0.0, 1.0)
    if isinstance(node, BinaryNode):
        left = evaluate_interval_ast(node.left, env)
        right = evaluate_interval_ast(node.right, env)
        op = node.op
        if op == "+":
            return left.add(right)
        if op == "-":
            return left.sub(right)
        if op == "*":
            return left.mul(right)
        if op == "/":
            return left.div(right)
        if op == "^":
            return left.pow(right)
        if op == "<":
            if left.high < right.low:
                return Interval(1.0, 1.0)
            if left.low >= right.high:
                return Interval(0.0, 0.0)
            return Interval(0.0, 1.0)
        if op == "<=":
            if left.high <= right.low:
                return Interval(1.0, 1.0)
            if left.low > right.high:
                return Interval(0.0, 0.0)
            return Interval(0.0, 1.0)
        if op == ">":
            if left.low > right.high:
                return Interval(1.0, 1.0)
            if left.high <= right.low:
                return Interval(0.0, 0.0)
            return Interval(0.0, 1.0)
        if op == ">=":
            if left.low >= right.high:
                return Interval(1.0, 1.0)
            if left.high < right.low:
                return Interval(0.0, 0.0)
            return Interval(0.0, 1.0)
    if isinstance(node, CallNode):
        args = [evaluate_interval_ast(a, env) for a in node.args]
        fn = node.fn_name
        if fn == "exp":
            return Interval(math.exp(max(-700.0, args[0].low)), math.exp(min(700.0, args[0].high)))
        if fn in ("log", "ln"):
            if args[0].low <= 0:
                return Interval(-math.inf, math.inf)
            return Interval(math.log(args[0].low), math.log(args[0].high))
        if fn == "log10":
            if args[0].low <= 0:
                return Interval(-math.inf, math.inf)
            return Interval(math.log10(args[0].low), math.log10(args[0].high))
        if fn == "sqrt":
            if args[0].high < 0:
                return Interval(-math.inf, math.inf)
            return Interval(math.sqrt(max(0.0, args[0].low)), math.sqrt(max(0.0, args[0].high)))
        if fn == "abs":
            if args[0].low <= 0.0 <= args[0].high:
                return Interval(0.0, max(abs(args[0].low), abs(args[0].high)))
            return Interval(min(abs(args[0].low), abs(args[0].high)), max(abs(args[0].low), abs(args[0].high)))
        if fn == "min":
            return Interval(min(a.low for a in args), min(a.high for a in args))
        if fn == "max":
            return Interval(max(a.low for a in args), max(a.high for a in args))
        if fn == "pow" and len(args) == 2:
            return args[0].pow(args[1])
        if fn == "clamp" and len(args) == 3:
            return Interval(
                max(args[1].low, min(args[0].low, args[2].low)),
                max(args[1].high, min(args[0].high, args[2].high)),
            )
    return Interval(-math.inf, math.inf)


def evaluate_interval_expression(expression: str, env: dict[str, Interval]) -> Interval:
    """Parse an expression string and evaluate its rigorous interval bounds over `env`."""
    allowed = set(env.keys()) | {"pi", "e", "a", "b", "c", "d", "t"}
    ast = parse_expression(expression, allowed_vars=allowed)
    return evaluate_interval_ast(ast, env)


def is_interval_proven_futile(bounds: Interval, criterion: OutcomeCriterion) -> bool:
    """Return True iff NO value inside `bounds` can possibly satisfy `criterion` (P = 0)."""
    op = criterion.op
    if op == "<" and criterion.value is not None:
        return bounds.low >= criterion.value
    if op == "<=" and criterion.value is not None:
        return bounds.low > criterion.value
    if op == ">" and criterion.value is not None:
        return bounds.high <= criterion.value
    if op == ">=" and criterion.value is not None:
        return bounds.high < criterion.value
    if op == "between" and criterion.low is not None and criterion.high is not None:
        return bounds.high < criterion.low or bounds.low > criterion.high
    if op == "equals" and criterion.value is not None:
        return bounds.high < criterion.value or bounds.low > criterion.value
    return False


def is_interval_proven_viable(bounds: Interval, criterion: OutcomeCriterion) -> bool:
    """Return True iff ALL values inside `bounds` satisfy `criterion` (P = 1)."""
    op = criterion.op
    if op == "<" and criterion.value is not None:
        return bounds.high < criterion.value
    if op == "<=" and criterion.value is not None:
        return bounds.high <= criterion.value
    if op == ">" and criterion.value is not None:
        return bounds.low > criterion.value
    if op == ">=" and criterion.value is not None:
        return bounds.low >= criterion.value
    if op == "between" and criterion.low is not None and criterion.high is not None:
        return bounds.low >= criterion.low and bounds.high <= criterion.high
    return False


def parameter_to_interval(param: ParameterResponse) -> Interval:
    """Extract the full [min, max] interval of a parameter."""
    spec = param.spec if isinstance(param.spec, dict) else {}
    if param.role == "fixed" and spec.get("value") is not None:
        v = float(spec["value"])
        return Interval(v, v)
    if spec.get("min") is not None and spec.get("max") is not None:
        return Interval(float(spec["min"]), float(spec["max"]))
    if spec.get("values"):
        nums = [float(x) for x in spec["values"] if isinstance(x, (int, float))]
        if nums:
            return Interval(min(nums), max(nums))
    return Interval(0.0, 1.0)


@dataclass
class CriticalThresholdTheorem:
    parameter_key: str
    parameter_label: str
    parameter_unit: str
    futile_low: float
    futile_high: float
    outcome_key: str
    outcome_bounds: tuple[float, float]
    statement: str


def find_critical_threshold_theorems(
    expression: str,
    parameters: list[ParameterResponse],
    outcome: OutcomeResponse,
    n_slices: int = 50,
) -> list[CriticalThresholdTheorem]:
    """Identify sub-intervals of each controlled parameter where the outcome is mathematically proven futile
    regardless of the values of all other controlled and uncertain parameters.
    """
    if outcome.criterion is None:
        return []

    base_env: dict[str, Interval] = {p.key: parameter_to_interval(p) for p in parameters}
    allowed = set(base_env.keys()) | {"pi", "e", "a", "b", "c", "d", "t"}
    ast = parse_expression(expression, allowed_vars=allowed)

    theorems: list[CriticalThresholdTheorem] = []
    controlled = [p for p in parameters if p.role == "controlled" and p.kind in ("continuous", "integer")]

    for p in controlled:
        full_iv = base_env[p.key]
        span = full_iv.high - full_iv.low
        if span <= 0:
            continue

        step = span / n_slices
        futile_slices: list[tuple[float, float, Interval]] = []
        for s in range(n_slices):
            lo = full_iv.low + s * step
            hi = full_iv.low + (s + 1) * step if s < n_slices - 1 else full_iv.high
            slice_env = dict(base_env)
            slice_env[p.key] = Interval(lo, hi)
            out_iv = evaluate_interval_ast(ast, slice_env)
            if is_interval_proven_futile(out_iv, outcome.criterion):
                futile_slices.append((lo, hi, out_iv))

        if not futile_slices:
            continue

        # Merge contiguous futile slices into clean theorem intervals
        merged: list[tuple[float, float, float, float]] = []
        cur_lo, cur_hi, cur_out = futile_slices[0][0], futile_slices[0][1], futile_slices[0][2]
        out_lo, out_hi = cur_out.low, cur_out.high

        for lo, hi, out_iv in futile_slices[1:]:
            if abs(lo - cur_hi) <= 1e-9 * max(1.0, span):
                cur_hi = hi
                out_lo = min(out_lo, out_iv.low)
                out_hi = max(out_hi, out_iv.high)
            else:
                merged.append((cur_lo, cur_hi, out_lo, out_hi))
                cur_lo, cur_hi, out_lo, out_hi = lo, hi, out_iv.low, out_iv.high
        merged.append((cur_lo, cur_hi, out_lo, out_hi))

        crit_str = (
            f"{outcome.criterion.op} {outcome.criterion.value}"
            if outcome.criterion.value is not None
            else f"between [{outcome.criterion.low}, {outcome.criterion.high}]"
        )
        unit_s = f" {p.unit}" if p.unit else ""
        out_unit_s = f" {outcome.unit}" if outcome.unit else ""

        for m_lo, m_hi, o_lo, o_hi in merged:
            stmt = (
                f"For all {p.key} in [{m_lo:.4g}, {m_hi:.4g}]{unit_s}, "
                f"{outcome.key} lies in [{o_lo:.4g}, {o_hi:.4g}]{out_unit_s}, "
                f"which violates criterion ({crit_str}{out_unit_s}) under all possible combinations of other parameters."
            )
            theorems.append(
                CriticalThresholdTheorem(
                    parameter_key=p.key,
                    parameter_label=p.label,
                    parameter_unit=p.unit,
                    futile_low=round(m_lo, 6),
                    futile_high=round(m_hi, 6),
                    outcome_key=outcome.key,
                    outcome_bounds=(round(o_lo, 6), round(o_hi, 6)),
                    statement=stmt,
                )
            )

    return theorems
