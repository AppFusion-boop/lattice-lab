"""Unit validation and normalization using pint."""

from __future__ import annotations

import pint

ureg = pint.UnitRegistry()

# Custom engineering definitions
ureg.define("gpm = gallon / minute = gpm")
ureg.define("cfs = foot**3 / second = cfs")
ureg.define("thou = 0.001 * inch = mil = thou")

UNIT_FAMILIES: dict[str, list[str]] = {
    "pressure": ["Pa", "kPa", "MPa", "GPa", "bar", "mbar", "psi", "atm", "torr"],
    "length": ["µm", "um", "nm", "mm", "cm", "m", "km", "in", "ft", "thou"],
    "flow": ["L/min", "L/s", "mL/s", "m^3/s", "m^3/h", "gpm", "cfs"],
    "temperature": ["K", "°C", "degC", "°F", "degF"],
    "time": ["s", "ms", "µs", "us", "ns", "min", "h"],
    "velocity": ["m/s", "km/h", "mph", "ft/s", "knot"],
    "mass": ["kg", "g", "mg", "µg", "ug", "lb", "oz"],
    "force": ["N", "kN", "MN", "lbf", "dyn"],
    "frequency": ["Hz", "kHz", "MHz", "GHz", "rpm"],
    "angle": ["rad", "deg", "degree"],
    "energy": ["J", "kJ", "MJ", "cal", "kcal", "BTU", "Wh", "kWh"],
    "power": ["W", "kW", "MW", "mW", "hp"],
    "dimensionless": ["", "%", "percent", "ppm"],
}


def get_unit_dimension(unit_str: str) -> str:
    """Return the dimensional family name (e.g. 'pressure', 'length') or dimensionality string."""
    norm = normalize_unit(unit_str)
    if not norm:
        return "dimensionless"
    for fam_name, units in UNIT_FAMILIES.items():
        if norm in units or unit_str.strip() in units:
            return fam_name
    try:
        return str(ureg.parse_units(norm).dimensionality)
    except (pint.errors.PintError, ValueError, AttributeError):
        return "unknown"


def get_compatible_units(unit_str: str) -> list[str]:
    """Return a list of compatible units for the given unit."""
    norm = normalize_unit(unit_str)
    if not norm:
        return ["", "%"]
    fam = get_unit_dimension(unit_str)
    if fam in UNIT_FAMILIES:
        res = list(UNIT_FAMILIES[fam])
        clean = unit_str.strip()
        if clean not in res:
            res.insert(0, clean)
        return res

    compatible = [unit_str.strip()]
    for units in UNIT_FAMILIES.values():
        for candidate in units:
            if candidate and candidate != unit_str:
                try:
                    convert_unit(1.0, unit_str, candidate)
                    if candidate not in compatible:
                        compatible.append(candidate)
                except (pint.errors.PintError, ValueError):
                    continue
    return compatible


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
