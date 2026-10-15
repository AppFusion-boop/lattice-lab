"""Unit validation and normalization using pint."""

from __future__ import annotations

import pint

ureg = pint.UnitRegistry()


def normalize_unit(unit_str: str) -> str:
    """Normalize common unit notation before validation:

    - 'µ' -> 'u'
    - '°C' -> 'degC'
    - '²' -> '**2'
    - '³' -> '**3'
    - '%' -> 'percent'
    """
    if not unit_str:
        return ""
    s = unit_str.strip()
    if not s:
        return ""
    s = s.replace("µ", "u")
    s = s.replace("°C", "degC")
    s = s.replace("²", "**2")
    s = s.replace("³", "**3")
    s = s.replace("%", "percent")
    return s


def validate_unit(unit_str: str) -> str:
    """Validate a unit string against the pint UnitRegistry.

    Returns the normalized unit string (or empty string for dimensionless).
    Raises ValueError with a friendly message if the unit is invalid.
    """
    if not unit_str or not unit_str.strip():
        return ""

    normalized = normalize_unit(unit_str)
    try:
        ureg.parse_units(normalized)
    except Exception as exc:
        raise ValueError(f"Unknown or invalid unit '{unit_str}': {exc}") from exc

    return normalized


def convert_unit(value: float, from_unit: str, to_unit: str) -> float:
    """Convert a numeric value between compatible units using pint."""
    if not from_unit or not to_unit or from_unit.strip() == to_unit.strip():
        return value
    f_norm = normalize_unit(from_unit)
    t_norm = normalize_unit(to_unit)
    if f_norm == t_norm:
        return value
    try:
        qty = ureg.Quantity(value, f_norm)
        return float(qty.to(t_norm).magnitude)
    except Exception as exc:
        raise ValueError(f"Cannot convert '{from_unit}' to '{to_unit}': {exc}") from exc
