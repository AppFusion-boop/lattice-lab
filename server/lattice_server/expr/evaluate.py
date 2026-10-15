"""Expression compilation and evaluation (scalar and vectorized)."""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

from lattice_server.expr.exceptions import (
    ExpressionError,
    MissingVariableError,
    NonFiniteError,
)
from lattice_server.expr.parser import (
    FUNCTION_ARITIES,
    ASTNode,
    BinaryNode,
    CallNode,
    NumberNode,
    UnaryNode,
    VariableNode,
    parse_expression,
)
from lattice_server.expr.tokenizer import TOKEN_RE

FORMULA_FUNCTIONS = list(FUNCTION_ARITIES.keys())


def expression_variables(source: str) -> list[str]:
    """Extract variable identifiers used in source, excluding functions and constants (pi, e).

    Does not throw syntax errors on invalid expressions, matching the TS helper.
    """
    if not source or not isinstance(source, str):
        return []

    tokens: list[str] = []
    end = 0
    length = len(source)
    while end < length:
        m = TOKEN_RE.match(source, end)
        if not m:
            break
        tok = m.group(1) or m.group(2) or m.group(3)
        tokens.append(tok)
        end = m.end()

    found_vars: set[str] = set()
    for i, tok in enumerate(tokens):
        if tok[0].isalpha() or tok[0] == "_":
            if i + 1 < len(tokens) and tokens[i + 1] == "(":
                # Function call
                continue
            if tok not in ("pi", "e"):
                found_vars.add(tok)

    return sorted(found_vars)


def _collect_ast_variables(node: ASTNode) -> set[str]:
    """Collect all variable names referenced in the AST (excluding pi and e)."""
    result: set[str] = set()

    def walk(n: ASTNode) -> None:
        if isinstance(n, VariableNode):
            if n.name not in ("pi", "e"):
                result.add(n.name)
        elif isinstance(n, UnaryNode):
            walk(n.child)
        elif isinstance(n, BinaryNode):
            walk(n.left)
            walk(n.right)
        elif isinstance(n, CallNode):
            for arg in n.args:
                walk(arg)

    walk(node)
    return result


class CompiledExpression:
    """Compiled expression AST with scalar and vectorized evaluators."""

    def __init__(
        self,
        ast: ASTNode,
        allowed_vars: set[str] | None,
        strict: bool,
    ) -> None:
        self.ast = ast
        self.allowed_vars = allowed_vars
        self.strict = strict
        self._referenced_vars = _collect_ast_variables(ast)

    def evaluate(self, vars_map: dict[str, float] | None = None) -> float:
        """Evaluate the expression with scalar variable inputs."""
        v = vars_map if vars_map is not None else {}
        res = self._eval_scalar(self.ast, v)
        if not math.isfinite(res):
            raise NonFiniteError(
                "Expression produced a non-finite value. Check division and function domains."
            )
        return float(res)

    def evaluate_vec(
        self,
        vars_array: dict[str, np.ndarray] | None = None,
        n: int | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Evaluate the expression over 1D NumPy arrays.

        Returns:
            (values, finite_mask) where finite_mask is True for finite outputs.
        """
        raw_vars = vars_array if vars_array is not None else {}

        # Determine batch size n
        if n is None:
            if raw_vars:
                first_arr = next(iter(raw_vars.values()))
                n = len(first_arr)
            else:
                n = 1

        if n == 0:
            return np.empty(0, dtype=np.float64), np.empty(0, dtype=bool)

        # Validate variables in strict mode
        prepared_vars: dict[str, np.ndarray] = {}
        for var in self._referenced_vars:
            if var not in raw_vars:
                if self.strict:
                    raise MissingVariableError(f"Missing variable: {var}")
                prepared_vars[var] = np.zeros(n, dtype=np.float64)
            else:
                arr = np.asarray(raw_vars[var], dtype=np.float64)
                if arr.shape != (n,):
                    raise ExpressionError(
                        f"Variable '{var}' array shape {arr.shape} does not match expected ({n},)"
                    )
                if self.strict and not np.all(np.isfinite(arr)):
                    raise MissingVariableError(f"Missing variable: {var}")
                prepared_vars[var] = arr

        with np.errstate(all="ignore"):
            values = self._eval_vec(self.ast, prepared_vars, n)
            finite_mask = np.isfinite(values)

        return values, finite_mask

    def _eval_scalar(self, node: ASTNode, v: dict[str, float]) -> float:
        if isinstance(node, NumberNode):
            return node.value

        if isinstance(node, VariableNode):
            if node.name == "pi":
                return math.pi
            if node.name == "e":
                return math.e
            if self.strict:
                if node.name not in v or v[node.name] is None:
                    raise MissingVariableError(f"Missing variable: {node.name}")
                val = float(v[node.name])
                if not math.isfinite(val):
                    raise MissingVariableError(f"Missing variable: {node.name}")
                return val
            val_opt = v.get(node.name)
            return float(val_opt) if val_opt is not None else 0.0

        if isinstance(node, UnaryNode):
            child_val = self._eval_scalar(node.child, v)
            if node.op == "+":
                return +child_val
            if node.op == "-":
                return -child_val
            if node.op == "!":
                return 1.0 if child_val == 0.0 else 0.0
            raise ExpressionError(f"Invalid unary operator: {node.op}")

        if isinstance(node, BinaryNode):
            # Short-circuiting boolean operators
            if node.op == "&&":
                left_val = self._eval_scalar(node.left, v)
                if left_val == 0.0:
                    return 0.0
                right_val = self._eval_scalar(node.right, v)
                return 1.0 if right_val != 0.0 else 0.0

            if node.op == "||":
                left_val = self._eval_scalar(node.left, v)
                if left_val != 0.0:
                    return 1.0
                right_val = self._eval_scalar(node.right, v)
                return 1.0 if right_val != 0.0 else 0.0

            a = self._eval_scalar(node.left, v)
            b = self._eval_scalar(node.right, v)

            if node.op == "+":
                return a + b
            if node.op == "-":
                return a - b
            if node.op == "*":
                return a * b
            if node.op == "/":
                if b == 0.0:
                    raise NonFiniteError(
                        "Expression produced a non-finite value. Check division and function domains."
                    )
                return a / b
            if node.op == "%":
                if b == 0.0:
                    raise NonFiniteError(
                        "Expression produced a non-finite value. Check division and function domains."
                    )
                return math.fmod(a, b)
            if node.op == "^":
                try:
                    res = math.pow(a, b)
                    if not math.isfinite(res):
                        raise NonFiniteError(
                            "Expression produced a non-finite value. Check division and function domains."
                        )
                    return res
                except (ValueError, OverflowError) as e:
                    raise NonFiniteError(
                        "Expression produced a non-finite value. Check division and function domains."
                    ) from e
            if node.op == ">":
                return 1.0 if a > b else 0.0
            if node.op == "<":
                return 1.0 if a < b else 0.0
            if node.op == ">=":
                return 1.0 if a >= b else 0.0
            if node.op == "<=":
                return 1.0 if a <= b else 0.0
            if node.op == "==":
                return 1.0 if a == b else 0.0
            if node.op == "!=":
                return 1.0 if a != b else 0.0
            raise ExpressionError(f"Invalid operator: {node.op}")

        if isinstance(node, CallNode):
            if node.fn_name == "if":
                cond = self._eval_scalar(node.args[0], v)
                if cond != 0.0:
                    return self._eval_scalar(node.args[1], v)
                return self._eval_scalar(node.args[2], v)

            args = [self._eval_scalar(arg, v) for arg in node.args]
            fn = node.fn_name
            try:
                if fn == "sin":
                    return math.sin(args[0])
                if fn == "cos":
                    return math.cos(args[0])
                if fn == "tan":
                    return math.tan(args[0])
                if fn == "abs":
                    return abs(args[0])
                if fn == "sqrt":
                    if args[0] < 0:
                        raise NonFiniteError(
                            "Expression produced a non-finite value. Check division and function domains."
                        )
                    return math.sqrt(args[0])
                if fn == "exp":
                    return math.exp(args[0])
                if fn == "log":
                    if args[0] <= 0:
                        raise NonFiniteError(
                            "Expression produced a non-finite value. Check division and function domains."
                        )
                    return math.log(args[0])
                if fn == "log10":
                    if args[0] <= 0:
                        raise NonFiniteError(
                            "Expression produced a non-finite value. Check division and function domains."
                        )
                    return math.log10(args[0])
                if fn == "floor":
                    return float(math.floor(args[0]))
                if fn == "ceil":
                    return float(math.ceil(args[0]))
                if fn == "round":
                    return float(math.floor(args[0] + 0.5))
                if fn == "min":
                    return min(args[0], args[1])
                if fn == "max":
                    return max(args[0], args[1])
                if fn == "pow":
                    return math.pow(args[0], args[1])
                if fn == "clamp":
                    # clamp(x, a, b) => max(a, min(b, x))
                    x, a, b = args[0], args[1], args[2]
                    return max(a, min(b, x))
            except (ValueError, OverflowError) as e:
                raise NonFiniteError(
                    "Expression produced a non-finite value. Check division and function domains."
                ) from e
            raise ExpressionError(f"Unknown function: {fn}")

        raise ExpressionError(f"Unknown AST node type: {type(node)}")

    def _eval_vec(
        self,
        node: ASTNode,
        v: dict[str, np.ndarray],
        n: int,
    ) -> np.ndarray:
        if isinstance(node, NumberNode):
            return np.full(n, node.value, dtype=np.float64)

        if isinstance(node, VariableNode):
            if node.name == "pi":
                return np.full(n, np.pi, dtype=np.float64)
            if node.name == "e":
                return np.full(n, np.e, dtype=np.float64)
            return v[node.name]

        if isinstance(node, UnaryNode):
            child = self._eval_vec(node.child, v, n)
            if node.op == "+":
                return +child
            if node.op == "-":
                return -child
            if node.op == "!":
                return np.where(child == 0.0, 1.0, 0.0)
            raise ExpressionError(f"Invalid unary operator: {node.op}")

        if isinstance(node, BinaryNode):
            if node.op == "&&":
                left = self._eval_vec(node.left, v, n)
                left_cond = left != 0.0
                if not np.any(left_cond):
                    return np.zeros(n, dtype=np.float64)
                right = self._eval_vec(node.right, v, n)
                return np.where(left_cond, np.where(right != 0.0, 1.0, 0.0), 0.0)

            if node.op == "||":
                left = self._eval_vec(node.left, v, n)
                left_cond = left != 0.0
                if np.all(left_cond):
                    return np.ones(n, dtype=np.float64)
                right = self._eval_vec(node.right, v, n)
                return np.where(left_cond, 1.0, np.where(right != 0.0, 1.0, 0.0))

            left = self._eval_vec(node.left, v, n)
            right = self._eval_vec(node.right, v, n)

            if node.op == "+":
                return left + right
            if node.op == "-":
                return left - right
            if node.op == "*":
                return left * right
            if node.op == "/":
                return np.divide(left, right)
            if node.op == "%":
                return np.fmod(left, right)
            if node.op == "^":
                return np.power(left, right)
            if node.op in (">", "<", ">=", "<=", "==", "!="):
                finite = np.isfinite(left) & np.isfinite(right)
                if node.op == ">":
                    res = np.where(left > right, 1.0, 0.0)
                elif node.op == "<":
                    res = np.where(left < right, 1.0, 0.0)
                elif node.op == ">=":
                    res = np.where(left >= right, 1.0, 0.0)
                elif node.op == "<=":
                    res = np.where(left <= right, 1.0, 0.0)
                elif node.op == "==":
                    res = np.where(left == right, 1.0, 0.0)
                elif node.op == "!=":
                    res = np.where(left != right, 1.0, 0.0)
                return np.where(finite, res, np.nan)
            raise ExpressionError(f"Invalid operator: {node.op}")

        if isinstance(node, CallNode):
            if node.fn_name == "if":
                cond = self._eval_vec(node.args[0], v, n) != 0.0
                if np.all(cond):
                    return self._eval_vec(node.args[1], v, n)
                if not np.any(cond):
                    return self._eval_vec(node.args[2], v, n)
                t_val = self._eval_vec(node.args[1], v, n)
                f_val = self._eval_vec(node.args[2], v, n)
                return np.where(cond, t_val, f_val)

            args = [self._eval_vec(arg, v, n) for arg in node.args]
            fn = node.fn_name
            if fn == "sin":
                return np.sin(args[0])
            if fn == "cos":
                return np.cos(args[0])
            if fn == "tan":
                return np.tan(args[0])
            if fn == "abs":
                return np.abs(args[0])
            if fn == "sqrt":
                return np.sqrt(args[0])
            if fn == "exp":
                return np.exp(args[0])
            if fn == "log":
                return np.log(args[0])
            if fn == "log10":
                return np.log10(args[0])
            if fn == "floor":
                return np.floor(args[0])
            if fn == "ceil":
                return np.ceil(args[0])
            if fn == "round":
                return np.floor(args[0] + 0.5)
            if fn == "min":
                return np.minimum(args[0], args[1])
            if fn == "max":
                return np.maximum(args[0], args[1])
            if fn == "pow":
                return np.power(args[0], args[1])
            if fn == "clamp":
                x, a, b = args[0], args[1], args[2]
                return np.maximum(a, np.minimum(b, x))
            raise ExpressionError(f"Unknown function: {fn}")

        raise ExpressionError(f"Unknown AST node type: {type(node)}")


def compile_expression(
    source: str,
    variables: Sequence[str] | set[str] | None = None,
    strict: bool | None = None,
) -> CompiledExpression:
    """Compile an expression string into an executable CompiledExpression.

    Args:
        source: Expression text (max 500 characters).
        variables: Optional allowed variable names.
        strict: If True, missing variables at evaluation raise MissingVariableError.
                Defaults to True if variables is provided, else False.
    """
    has_custom_vars = variables is not None
    if has_custom_vars:
        for v in variables:  # type: ignore[union-attr]
            if v in FUNCTION_ARITIES:
                raise ExpressionError(f"Variable name collides with function: {v}")
        allowed_vars = set(variables) | {"pi", "e"}  # type: ignore[union-attr]
    else:
        allowed_vars = None

    is_strict = strict if strict is not None else has_custom_vars

    ast = parse_expression(source, allowed_vars=allowed_vars)
    return CompiledExpression(ast=ast, allowed_vars=allowed_vars, strict=is_strict)
