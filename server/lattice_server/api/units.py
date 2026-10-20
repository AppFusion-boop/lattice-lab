"""API router for physical unit conversion and validation."""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from lattice_server.errors import ApiHttpError
from lattice_server.schemas import (
    CompatibleUnitsResponse,
    UnitConvertRequest,
    UnitConvertResponse,
)
from lattice_server.units import (
    convert_unit,
    get_compatible_units,
    get_unit_dimension,
    validate_unit,
)

router = APIRouter(prefix="/units", tags=["units"])


@router.post("/convert", response_model=UnitConvertResponse)
def convert_physical_unit(req: UnitConvertRequest) -> UnitConvertResponse:
    """Convert numeric value between two physical units using authoritative Pint UnitRegistry."""
    from_u = req.from_unit.strip()
    to_u = req.to_unit.strip()

    if not from_u or not to_u or from_u == to_u:
        return UnitConvertResponse(
            value=req.value,
            from_unit=from_u,
            to_unit=to_u,
            converted_value=req.value,
            compatible=True,
        )

    try:
        validate_unit(from_u)
    except ValueError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_from_unit",
            message=str(exc),
            field="from_unit",
        ) from exc

    try:
        validate_unit(to_u)
    except ValueError as exc:
        raise ApiHttpError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_to_unit",
            message=str(exc),
            field="to_unit",
        ) from exc

    try:
        converted = convert_unit(req.value, from_u, to_u)
        return UnitConvertResponse(
            value=req.value,
            from_unit=from_u,
            to_unit=to_u,
            converted_value=converted,
            compatible=True,
        )
    except ValueError as exc:
        return UnitConvertResponse(
            value=req.value,
            from_unit=from_u,
            to_unit=to_u,
            converted_value=req.value,
            compatible=False,
            message=str(exc),
        )


@router.get("/compatible", response_model=CompatibleUnitsResponse)
def get_compatible_units_endpoint(
    unit: str = Query(..., description="Target unit notation to find compatible alternatives for"),
) -> CompatibleUnitsResponse:
    """Return compatible physical units sharing the same dimension."""
    clean_u = unit.strip()
    dimension = get_unit_dimension(clean_u)
    compatible = get_compatible_units(clean_u)
    return CompatibleUnitsResponse(
        unit=clean_u,
        dimension=dimension,
        compatible=compatible,
    )

