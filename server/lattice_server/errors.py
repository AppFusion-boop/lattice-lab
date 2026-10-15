"""Standardized API error handling matching §6 contract."""

from __future__ import annotations

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from lattice_server.repo.parameters import ConflictError


class ApiHttpError(HTTPException):
    """Structured HTTP exception returning {'detail': {'code': ..., 'message': ..., 'field': ...}}."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        field: str | None = None,
    ) -> None:
        super().__init__(
            status_code=status_code,
            detail={"code": code, "message": message, "field": field},
        )
        self.code = code
        self.message = message
        self.field = field


async def api_http_error_handler(_request: Request, exc: ApiHttpError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": {"code": exc.code, "message": exc.message, "field": exc.field}},
    )


async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    first_err = exc.errors()[0] if exc.errors() else {}
    msg = str(first_err.get("msg", "Validation error"))
    loc = first_err.get("loc", ())
    field = str(loc[-1]) if loc else None
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": {
                "code": "validation_error",
                "message": msg,
                "field": field,
            }
        },
    )


async def conflict_error_handler(_request: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "detail": {
                "code": "conflict",
                "message": str(exc),
                "field": None,
            }
        },
    )


async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": {
                "code": "invalid_value",
                "message": str(exc),
                "field": None,
            }
        },
    )
