"""Pratt parser for the Lattice expression compiler."""

from __future__ import annotations

from dataclasses import dataclass

from lattice_server.expr.exceptions import (
    ArityError,
    ExpressionParseError,
    TooDeepError,
    UnknownFunctionError,
    UnknownVariableError,
)
from lattice_server.expr.tokenizer import NUMBER_RE, tokenize

MAX_PARSE_DEPTH = 35

FUNCTION_ARITIES: dict[str, int] = {
    "sin": 1,
    "cos": 1,
    "tan": 1,
    "abs": 1,
    "sqrt": 1,
    "exp": 1,
    "log": 1,
    "log10": 1,
    "floor": 1,
    "ceil": 1,
    "round": 1,
    "min": 2,
    "max": 2,
    "pow": 2,
    "clamp": 3,
    "if": 3,
}

PRECEDENCE: dict[str, int] = {
    "||": 1,
    "&&": 2,
    "==": 3,
    "!=": 3,
    ">": 4,
    "<": 4,
    ">=": 4,
    "<=": 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
    "%": 6,
    "^": 8,
}


@dataclass(frozen=True)
class ASTNode:
    """Base class for AST nodes."""


@dataclass(frozen=True)
class NumberNode(ASTNode):
    value: float


@dataclass(frozen=True)
class VariableNode(ASTNode):
    name: str


@dataclass(frozen=True)
class UnaryNode(ASTNode):
    op: str
    child: ASTNode


@dataclass(frozen=True)
class BinaryNode(ASTNode):
    op: str
    left: ASTNode
    right: ASTNode


@dataclass(frozen=True)
class CallNode(ASTNode):
    fn_name: str
    args: list[ASTNode]


class Parser:
    """Pratt parser for expressions."""

    def __init__(self, tokens: list[str], allowed_vars: set[str] | None = None) -> None:
        self.tokens = tokens
        self.allowed_vars = allowed_vars
        self.at = 0

    def parse(self) -> ASTNode:
        root = self._parse_sub(min_prec=0, depth=0)
        if self.at != len(self.tokens):
            raise ExpressionParseError(f"Unexpected token: {self.tokens[self.at]}")
        return root

    def _parse_sub(self, min_prec: int = 0, depth: int = 0) -> ASTNode:
        if depth > MAX_PARSE_DEPTH:
            raise TooDeepError("Expression is too deeply nested")

        if self.at >= len(self.tokens):
            raise ExpressionParseError("Incomplete expression")

        tok = self.tokens[self.at]
        self.at += 1

        tree: ASTNode
        if tok in ("-", "+", "!"):
            child = self._parse_sub(min_prec=7, depth=depth + 1)
            tree = UnaryNode(op=tok, child=child)
        elif tok == "(":
            tree = self._parse_sub(min_prec=0, depth=depth + 1)
            if self.at >= len(self.tokens) or self.tokens[self.at] != ")":
                raise ExpressionParseError("Missing closing parenthesis")
            self.at += 1
        elif NUMBER_RE.match(tok):
            tree = NumberNode(value=float(tok))
        elif tok[0].isalpha() or tok[0] == "_":
            if self.at < len(self.tokens) and self.tokens[self.at] == "(":
                # Function call
                fn_name = tok
                if fn_name not in FUNCTION_ARITIES:
                    raise UnknownFunctionError(f"Unknown function: {fn_name}")
                self.at += 1
                args: list[ASTNode] = []
                if self.at < len(self.tokens) and self.tokens[self.at] != ")":
                    args.append(self._parse_sub(min_prec=0, depth=depth + 1))
                    while self.at < len(self.tokens) and self.tokens[self.at] == ",":
                        self.at += 1
                        args.append(self._parse_sub(min_prec=0, depth=depth + 1))
                if self.at >= len(self.tokens) or self.tokens[self.at] != ")":
                    raise ExpressionParseError("Missing closing parenthesis")
                self.at += 1
                expected_arity = FUNCTION_ARITIES[fn_name]
                if len(args) != expected_arity:
                    raise ArityError(f"{fn_name} expects {expected_arity} arguments")
                tree = CallNode(fn_name=fn_name, args=args)
            else:
                # Variable
                if self.allowed_vars is not None:
                    if tok not in self.allowed_vars:
                        raise UnknownVariableError(f"Unknown variable: {tok}")
                else:
                    if tok not in ("a", "b", "t", "pi", "e"):
                        raise UnknownVariableError(f"Unknown variable: {tok}. Use a, b or t.")
                tree = VariableNode(name=tok)
        else:
            raise ExpressionParseError(f"Unexpected token: {tok}")

        while self.at < len(self.tokens):
            next_tok = self.tokens[self.at]
            if next_tok not in PRECEDENCE or PRECEDENCE[next_tok] < min_prec:
                break
            op = next_tok
            self.at += 1
            next_prec = PRECEDENCE[op] + (0 if op == "^" else 1)
            right = self._parse_sub(min_prec=next_prec, depth=depth + 1)
            tree = BinaryNode(op=op, left=tree, right=right)

        return tree


def parse_expression(source: str, allowed_vars: set[str] | None = None) -> ASTNode:
    """Tokenize and parse source string into an ASTNode."""
    tokens = tokenize(source)
    return Parser(tokens, allowed_vars=allowed_vars).parse()
