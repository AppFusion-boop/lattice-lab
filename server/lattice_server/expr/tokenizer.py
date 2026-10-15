"""Tokenizer for the Lattice expression compiler."""

from __future__ import annotations

import re

from lattice_server.expr.exceptions import (
    ExpressionParseError,
    TooLongError,
)

MAX_EXPRESSION_LENGTH = 500

# Regex matching numbers, identifiers, or punctuation/operators.
TOKEN_RE = re.compile(
    r"\s*(?:"
    r"(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)"
    r"|([a-zA-Z_][a-zA-Z0-9_]*)"
    r"|(>=|<=|==|!=|&&|\|\||[+*/^(),<>!%-])"
    r")"
)

IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
NUMBER_RE = re.compile(r"^(?:\d|\.)")


def tokenize(source: str) -> list[str]:
    """Tokenize the input expression string into a list of token strings.

    Raises:
        TooLongError: If source length exceeds 500 characters.
        ExpressionParseError: If source is blank or contains invalid characters.
    """
    if len(source) > MAX_EXPRESSION_LENGTH:
        raise TooLongError("Enter an expression (maximum 500 characters).")

    if not source.strip():
        raise ExpressionParseError("Enter an expression (maximum 500 characters).")

    tokens: list[str] = []
    end = 0
    length = len(source)

    while end < length:
        match = TOKEN_RE.match(source, end)
        if not match:
            if not source[end:].strip():
                break
            raise ExpressionParseError(f"Unexpected character at {end + 1}")
        tok = match.group(1) or match.group(2) or match.group(3)
        tokens.append(tok)
        end = match.end()

    return tokens
