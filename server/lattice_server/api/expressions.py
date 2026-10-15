"""API router for expression validation and checking."""

from __future__ import annotations

import re

from fastapi import APIRouter

from lattice_server.expr import ExpressionError, compile_expression, expression_variables
from lattice_server.schemas import ExpressionCheckRequest, ExpressionCheckResponse

router = APIRouter(prefix="/expressions", tags=["expressions"])

POS_RE = re.compile(r"\bat (\d+)\b", re.IGNORECASE)


@router.post("/check", response_model=ExpressionCheckResponse)
def check_expression(req: ExpressionCheckRequest) -> ExpressionCheckResponse:
    extracted_vars = expression_variables(req.expression)
    variables = req.variables if req.variables else None

    try:
        compile_expression(req.expression, variables=variables)
        return ExpressionCheckResponse(
            ok=True,
            variables=extracted_vars,
        )
    except ExpressionError as exc:
        msg = str(exc)
        pos = None
        match = POS_RE.search(msg)
        if match:
            pos = int(match.group(1))

        return ExpressionCheckResponse(
            ok=False,
            error=msg,
            position=pos,
            variables=extracted_vars,
        )
