"""Tests for Python expression compiler and evaluator against shared conformance fixture."""

import json
from pathlib import Path

import numpy as np
import pytest

from lattice_server.expr import (
    ArityError,
    ExpressionError,
    MissingVariableError,
    NonFiniteError,
    TooDeepError,
    TooLongError,
    UnknownFunctionError,
    UnknownVariableError,
    compile_expression,
    expression_variables,
)

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "shared" / "expression-conformance.json"


def classify_error(exc: Exception, expr: str) -> str:
    """Classify exception into conformance error kind."""
    if isinstance(exc, TooLongError) or len(expr) > 500:
        return "too_long"
    if isinstance(exc, TooDeepError):
        return "too_deep"
    if isinstance(exc, MissingVariableError):
        return "missing_variable"
    if isinstance(exc, UnknownVariableError):
        return "unknown_variable"
    if isinstance(exc, UnknownFunctionError):
        return "unknown_function"
    if isinstance(exc, ArityError):
        return "arity"
    if isinstance(exc, NonFiniteError):
        return "non_finite"
    msg = str(exc).lower()
    if "non-finite" in msg:
        return "non_finite"
    if "expects" in msg and "argument" in msg:
        return "arity"
    if "unknown function" in msg:
        return "unknown_function"
    if "unknown variable" in msg:
        return "unknown_variable"
    if "missing variable" in msg:
        return "missing_variable"
    if "too deeply nested" in msg:
        return "too_deep"
    return "parse"


def load_conformance_cases():
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_conformance_cases_scalar():
    """Verify all shared conformance cases using scalar evaluation."""
    cases = load_conformance_cases()
    assert len(cases) >= 40

    for c in cases:
        expr = c["expr"]
        variables = c.get("variables")
        v_map = c.get("vars", {})
        expect = c["expect"]

        if "value" in expect:
            compiled = compile_expression(expr, variables=variables)
            val = compiled.evaluate(v_map)
            assert abs(val - expect["value"]) < 1e-9, (
                f"Expression '{expr}' evaluated to {val}, expected {expect['value']}"
            )
        elif "error" in expect:
            expected_err = expect["error"]
            with pytest.raises(Exception) as exc_info:
                compiled = compile_expression(expr, variables=variables)
                compiled.evaluate(v_map)
            kind = classify_error(exc_info.value, expr)
            assert kind == expected_err, (
                f"Expression '{expr}' produced error kind '{kind}', expected '{expected_err}' ({exc_info.value})"
            )


def test_conformance_cases_vectorized_length_1():
    """Verify value cases in conformance fixture using vectorized evaluation with N=1."""
    cases = load_conformance_cases()

    for c in cases:
        expr = c["expr"]
        variables = c.get("variables")
        v_map = c.get("vars", {})
        expect = c["expect"]

        if "value" in expect:
            compiled = compile_expression(expr, variables=variables)
            v_arr = {k: np.array([v], dtype=np.float64) for k, v in v_map.items()}
            vals, mask = compiled.evaluate_vec(v_arr, n=1)
            assert len(vals) == 1
            assert mask[0] is True or mask[0] == 1
            assert abs(vals[0] - expect["value"]) < 1e-9, (
                f"Vectorized expression '{expr}' evaluated to {vals[0]}, expected {expect['value']}"
            )


def test_vectorized_vs_scalar_10k_random():
    """Verify that vectorized evaluation on 10,000 rows matches scalar evaluation."""
    rng = np.random.default_rng(42)
    n = 10_000

    flow = rng.uniform(1.0, 150.0, size=n)
    nozzles = rng.integers(1, 24, size=n).astype(np.float64)
    radius = rng.uniform(0.1, 50.0, size=n)

    expr = "flow * nozzles <= 600 && sqrt(radius) + 2.5 > 5.0"
    compiled = compile_expression(expr, variables=["flow", "nozzles", "radius"])

    vars_arr = {"flow": flow, "nozzles": nozzles, "radius": radius}
    vec_vals, vec_mask = compiled.evaluate_vec(vars_arr)

    assert len(vec_vals) == n
    assert np.all(vec_mask)

    # Check against scalar evaluation for all 10k rows
    for i in range(n):
        s_val = compiled.evaluate({"flow": flow[i], "nozzles": nozzles[i], "radius": radius[i]})
        assert vec_vals[i] == s_val


def test_vectorized_non_finite_mask():
    """Test that non-finite values (division by zero, sqrt of negative) are flagged in finite_mask."""
    x = np.array([4.0, 0.0, -4.0, 9.0])
    y = np.array([2.0, 0.0, 1.0, 3.0])

    # 1. Division by y
    compiled_div = compile_expression("x / y", variables=["x", "y"])
    _vals, mask = compiled_div.evaluate_vec({"x": x, "y": y})
    assert mask[0] == True  # 4 / 2 = 2
    assert mask[1] == False  # 0 / 0 = nan
    assert mask[2] == True  # -4 / 1 = -4
    assert mask[3] == True  # 9 / 3 = 3

    # 2. Sqrt of x
    compiled_sqrt = compile_expression("sqrt(x)", variables=["x"])
    _vals, mask = compiled_sqrt.evaluate_vec({"x": x})
    assert mask[0] == True  # sqrt(4) = 2
    assert mask[1] == True  # sqrt(0) = 0
    assert mask[2] == False  # sqrt(-4) = nan
    assert mask[3] == True  # sqrt(9) = 3


def test_expression_variables_helper():
    """Verify expression_variables extracts identifiers, excludes functions/constants, and is resilient."""
    vars_list = expression_variables("flow * nozzles + sqrt(radius) <= 600 * sin(pi / 2)")
    assert vars_list == ["flow", "nozzles", "radius"]

    # Partial / invalid expression should not crash
    partial = expression_variables("a + b * foo(")
    assert "foo" not in partial
    assert "a" in partial
    assert "b" in partial


def test_variable_collisions_and_strictness():
    """Verify variable name collisions and strictness checks."""
    # Collision with built-in function
    with pytest.raises(ExpressionError, match="Variable name collides with function: sin"):
        compile_expression("sin * 2", variables=["sin"])

    # Missing variable in strict mode
    compiled = compile_expression("x + y", variables=["x", "y"])
    with pytest.raises(MissingVariableError, match="Missing variable: y"):
        compiled.evaluate({"x": 5.0})

    with pytest.raises(MissingVariableError, match="Missing variable: y"):
        compiled.evaluate_vec({"x": np.array([5.0])})

    # Default non-strict behavior (missing vars default to 0.0)
    compiled_default = compile_expression("a + b")
    assert compiled_default.evaluate({"a": 10.0}) == 10.0

    vec_vals, vec_mask = compiled_default.evaluate_vec({"a": np.array([10.0])})
    assert vec_vals[0] == 10.0
    assert vec_mask[0] == True
