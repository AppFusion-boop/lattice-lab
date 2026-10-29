/**
 * Physical unit conversion & compatibility engine for Lattice Lab.
 * Supports pressure, length, flow, temperature, time, mass, velocity, force,
 * frequency, energy, power, angle, and dimensionless ratios.
 */

export interface UnitDefinition {
  symbol: string;
  label: string;
  factor: number; // Multiplier to canonical base unit
  offset?: number; // Additive offset (e.g. for temperature)
}

export interface UnitDimension {
  name: string;
  baseUnit: string;
  units: UnitDefinition[];
}

export const UNIT_DIMENSIONS: Record<string, UnitDimension> = {
  pressure: {
    name: "Pressure",
    baseUnit: "Pa",
    units: [
      { symbol: "Pa", label: "Pascal (Pa)", factor: 1 },
      { symbol: "kPa", label: "Kilopascal (kPa)", factor: 1e3 },
      { symbol: "MPa", label: "Megapascal (MPa)", factor: 1e6 },
      { symbol: "GPa", label: "Gigapascal (GPa)", factor: 1e9 },
      { symbol: "bar", label: "Bar (bar)", factor: 1e5 },
      { symbol: "mbar", label: "Millibar (mbar)", factor: 100 },
      { symbol: "psi", label: "Pound-force / sq in (psi)", factor: 6894.7572931683635 },
      { symbol: "atm", label: "Standard Atmosphere (atm)", factor: 101325 },
      { symbol: "torr", label: "Torr / mmHg (torr)", factor: 133.32236842105263 },
    ],
  },
  length: {
    name: "Length / Diameter",
    baseUnit: "m",
    units: [
      { symbol: "µm", label: "Micrometer / SMD (µm)", factor: 1e-6 },
      { symbol: "um", label: "Micron (um)", factor: 1e-6 },
      { symbol: "nm", label: "Nanometer (nm)", factor: 1e-9 },
      { symbol: "mm", label: "Millimeter (mm)", factor: 1e-3 },
      { symbol: "cm", label: "Centimeter (cm)", factor: 1e-2 },
      { symbol: "m", label: "Meter (m)", factor: 1 },
      { symbol: "km", label: "Kilometer (km)", factor: 1e3 },
      { symbol: "in", label: "Inch (in)", factor: 0.0254 },
      { symbol: "ft", label: "Foot (ft)", factor: 0.3048 },
      { symbol: "thou", label: "Thousandth of an inch / mil (thou)", factor: 2.54e-5 },
    ],
  },
  flow: {
    name: "Volumetric Flow Rate",
    baseUnit: "L/min",
    units: [
      { symbol: "L/min", label: "Liters per minute (L/min)", factor: 1 },
      { symbol: "L/s", label: "Liters per second (L/s)", factor: 60 },
      { symbol: "mL/s", label: "Milliliters per second (mL/s)", factor: 0.06 },
      { symbol: "m^3/s", label: "Cubic meters per sec (m³/s)", factor: 60000 },
      { symbol: "m^3/h", label: "Cubic meters per hr (m³/h)", factor: 16.666666666666668 },
      { symbol: "gpm", label: "US Gallons per min (gpm)", factor: 3.785411784 },
      { symbol: "cfs", label: "Cubic feet per sec (cfs)", factor: 1699.0107955 },
    ],
  },
  temperature: {
    name: "Temperature",
    baseUnit: "K",
    units: [
      { symbol: "K", label: "Kelvin (K)", factor: 1, offset: 0 },
      { symbol: "°C", label: "Celsius (°C)", factor: 1, offset: 273.15 },
      { symbol: "degC", label: "Degrees Celsius (degC)", factor: 1, offset: 273.15 },
      { symbol: "°F", label: "Fahrenheit (°F)", factor: 5 / 9, offset: 459.67 * (5 / 9) },
      { symbol: "degF", label: "Degrees Fahrenheit (degF)", factor: 5 / 9, offset: 459.67 * (5 / 9) },
    ],
  },
  time: {
    name: "Time",
    baseUnit: "s",
    units: [
      { symbol: "s", label: "Seconds (s)", factor: 1 },
      { symbol: "ms", label: "Milliseconds (ms)", factor: 1e-3 },
      { symbol: "µs", label: "Microseconds (µs)", factor: 1e-6 },
      { symbol: "us", label: "Microseconds (us)", factor: 1e-6 },
      { symbol: "ns", label: "Nanoseconds (ns)", factor: 1e-9 },
      { symbol: "min", label: "Minutes (min)", factor: 60 },
      { symbol: "h", label: "Hours (h)", factor: 3600 },
    ],
  },
  velocity: {
    name: "Velocity",
    baseUnit: "m/s",
    units: [
      { symbol: "m/s", label: "Meters per second (m/s)", factor: 1 },
      { symbol: "km/h", label: "Kilometers per hour (km/h)", factor: 1 / 3.6 },
      { symbol: "mph", label: "Miles per hour (mph)", factor: 0.44704 },
      { symbol: "ft/s", label: "Feet per second (ft/s)", factor: 0.3048 },
      { symbol: "knot", label: "Knots (knot)", factor: 0.5144444444444445 },
    ],
  },
  mass: {
    name: "Mass",
    baseUnit: "kg",
    units: [
      { symbol: "kg", label: "Kilograms (kg)", factor: 1 },
      { symbol: "g", label: "Grams (g)", factor: 1e-3 },
      { symbol: "mg", label: "Milligrams (mg)", factor: 1e-6 },
      { symbol: "µg", label: "Micrograms (µg)", factor: 1e-9 },
      { symbol: "ug", label: "Micrograms (ug)", factor: 1e-9 },
      { symbol: "lb", label: "Pounds (lb)", factor: 0.45359237 },
      { symbol: "oz", label: "Ounces (oz)", factor: 0.028349523125 },
    ],
  },
  force: {
    name: "Force",
    baseUnit: "N",
    units: [
      { symbol: "N", label: "Newtons (N)", factor: 1 },
      { symbol: "kN", label: "Kilonewtons (kN)", factor: 1e3 },
      { symbol: "MN", label: "Meganewtons (MN)", factor: 1e6 },
      { symbol: "lbf", label: "Pound-force (lbf)", factor: 4.4482216152605 },
      { symbol: "dyn", label: "Dynes (dyn)", factor: 1e-5 },
    ],
  },
  frequency: {
    name: "Frequency",
    baseUnit: "Hz",
    units: [
      { symbol: "Hz", label: "Hertz (Hz)", factor: 1 },
      { symbol: "kHz", label: "Kilohertz (kHz)", factor: 1e3 },
      { symbol: "MHz", label: "Megahertz (MHz)", factor: 1e6 },
      { symbol: "GHz", label: "Gigahertz (GHz)", factor: 1e9 },
      { symbol: "rpm", label: "Revolutions per minute (rpm)", factor: 1 / 60 },
    ],
  },
  angle: {
    name: "Angle",
    baseUnit: "rad",
    units: [
      { symbol: "rad", label: "Radians (rad)", factor: 1 },
      { symbol: "deg", label: "Degrees (deg)", factor: Math.PI / 180 },
      { symbol: "degree", label: "Degrees", factor: Math.PI / 180 },
    ],
  },
  energy: {
    name: "Energy / Work",
    baseUnit: "J",
    units: [
      { symbol: "J", label: "Joules (J)", factor: 1 },
      { symbol: "kJ", label: "Kilojoules (kJ)", factor: 1e3 },
      { symbol: "MJ", label: "Megajoules (MJ)", factor: 1e6 },
      { symbol: "cal", label: "Calories (cal)", factor: 4.184 },
      { symbol: "kcal", label: "Kilocalories (kcal)", factor: 4184 },
      { symbol: "BTU", label: "British Thermal Units (BTU)", factor: 1055.05585262 },
      { symbol: "Wh", label: "Watt-hours (Wh)", factor: 3600 },
      { symbol: "kWh", label: "Kilowatt-hours (kWh)", factor: 3.6e6 },
    ],
  },
  power: {
    name: "Power",
    baseUnit: "W",
    units: [
      { symbol: "W", label: "Watts (W)", factor: 1 },
      { symbol: "kW", label: "Kilowatts (kW)", factor: 1e3 },
      { symbol: "MW", label: "Megawatts (MW)", factor: 1e6 },
      { symbol: "mW", label: "Milliwatts (mW)", factor: 1e-3 },
      { symbol: "hp", label: "Mechanical Horsepower (hp)", factor: 745.6998715822702 },
    ],
  },
  optical_attenuation: {
    name: "Linear Optical Attenuation",
    baseUnit: "1/µm",
    units: [
      { symbol: "1/µm", label: "Inverse Micrometers (1/µm)", factor: 1 },
      { symbol: "1/um", label: "Inverse Microns (1/um)", factor: 1 },
      { symbol: "1/mm", label: "Inverse Millimeters (1/mm)", factor: 1e-3 },
      { symbol: "1/cm", label: "Inverse Centimeters (1/cm)", factor: 1e-4 },
      { symbol: "1/m", label: "Inverse Meters (1/m)", factor: 1e-6 },
    ],
  },
  molar_absorptivity: {
    name: "Molar Absorptivity",
    baseUnit: "m²/mol",
    units: [
      { symbol: "m²/mol", label: "Square meters per mole (m²/mol)", factor: 1 },
      { symbol: "m^2/mol", label: "Square meters per mole (m^2/mol)", factor: 1 },
      { symbol: "cm²/mol", label: "Square cm per mole (cm²/mol)", factor: 1e-4 },
      { symbol: "L/(mol*cm)", label: "Molar attenuation (L/(mol·cm))", factor: 0.1 },
    ],
  },
  dimensionless: {
    name: "Dimensionless / Ratio",
    baseUnit: "",
    units: [
      { symbol: "", label: "Dimensionless (pure number)", factor: 1 },
      { symbol: "1", label: "Pure scalar ratio", factor: 1 },
      { symbol: "OD", label: "Optical Density (OD)", factor: 1 },
      { symbol: "×", label: "Magnification (×)", factor: 1 },
      { symbol: "px", label: "Pixels (px)", factor: 1 },
      { symbol: "%", label: "Percentage (%)", factor: 0.01 },
      { symbol: "percent", label: "Percentage", factor: 0.01 },
      { symbol: "ppm", label: "Parts per million (ppm)", factor: 1e-6 },
    ],
  },
};

/** Normalize common unicode/spelling differences */
export function normalizeUnitSymbol(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  s = s.replace(/^\[(.*)\]$/, "$1").replace(/^\((.*)\)$/, "$1").trim();
  s = s.replace(/µ/g, "µ").replace(/u(?=m\b)/g, "µ");
  s = s.replace(/degC/i, "°C");
  s = s.replace(/degF/i, "°F");
  s = s.replace(/m3/i, "m^3");
  s = s.replace(/m³/, "m^3");
  return s;
}

/** Detect which physical dimension family a unit belongs to */
export function getUnitDimension(unitStr: string): string | null {
  const norm = normalizeUnitSymbol(unitStr);
  if (!norm) return "dimensionless";

  for (const [dimKey, dim] of Object.entries(UNIT_DIMENSIONS)) {
    if (dim.units.some((u) => u.symbol.toLowerCase() === norm.toLowerCase() || u.symbol === norm)) {
      return dimKey;
    }
  }
  return null;
}

/** Return compatible unit options for a given target unit string */
export function getCompatibleUnits(unitStr: string): UnitDefinition[] {
  const dimKey = getUnitDimension(unitStr);
  if (dimKey && UNIT_DIMENSIONS[dimKey]) {
    return UNIT_DIMENSIONS[dimKey].units;
  }
  const clean = normalizeUnitSymbol(unitStr);
  return clean ? [{ symbol: clean, label: clean, factor: 1 }] : [{ symbol: "", label: "Unitless", factor: 1 }];
}

/** Convert a numeric value from one unit to another */
export function convertUnitValue(value: number, fromUnit: string, toUnit: string): number {
  if (isNaN(value)) return value;
  const normFrom = normalizeUnitSymbol(fromUnit);
  const normTo = normalizeUnitSymbol(toUnit);

  if (normFrom === normTo || (!normFrom && !normTo)) {
    return value;
  }

  const dimFrom = getUnitDimension(normFrom);
  const dimTo = getUnitDimension(normTo);

  if (!dimFrom || !dimTo || dimFrom !== dimTo) {
    throw new Error(`Incompatible units: cannot convert '${fromUnit}' to '${toUnit}'.`);
  }

  // Special temperature affine conversion
  if (dimFrom === "temperature") {
    // 1. Convert from source to Kelvin
    let kelvin = value;
    if (normFrom === "°C" || normFrom === "degC") {
      kelvin = value + 273.15;
    } else if (normFrom === "°F" || normFrom === "degF") {
      kelvin = (value - 32) * (5 / 9) + 273.15;
    }

    // 2. Convert from Kelvin to target
    if (normTo === "°C" || normTo === "degC") {
      return kelvin - 273.15;
    } else if (normTo === "°F" || normTo === "degF") {
      return (kelvin - 273.15) * (9 / 5) + 32;
    } else {
      return kelvin;
    }
  }

  // Linear scale conversion
  const dim = UNIT_DIMENSIONS[dimFrom];
  const uFrom = dim.units.find((u) => u.symbol.toLowerCase() === normFrom.toLowerCase() || u.symbol === normFrom);
  const uTo = dim.units.find((u) => u.symbol.toLowerCase() === normTo.toLowerCase() || u.symbol === normTo);

  if (!uFrom || !uTo) {
    throw new Error(`Unknown unit specification: '${fromUnit}' or '${toUnit}'.`);
  }

  const baseVal = value * uFrom.factor;
  return baseVal / uTo.factor;
}

/** Format a live conversion preview string (e.g., "1.5 bar → 150,000 Pa") */
export function formatUnitConversionPreview(
  value: number | string,
  fromUnit: string,
  canonicalUnit: string
): { converted: number; text: string; isDifferent: boolean; error?: string } {
  if (value === "" || value === undefined || value === null) {
    return { converted: 0, text: "", isDifferent: false };
  }
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(num)) {
    return { converted: 0, text: "", isDifferent: false, error: "Invalid number" };
  }

  const normFrom = normalizeUnitSymbol(fromUnit);
  const normCanon = normalizeUnitSymbol(canonicalUnit);

  if (!normFrom || !normCanon || normFrom === normCanon) {
    return {
      converted: num,
      text: `${num.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${normCanon || "canonical"}`,
      isDifferent: false,
    };
  }

  try {
    const converted = convertUnitValue(num, normFrom, normCanon);
    const formattedVal = Math.abs(converted) >= 10000 || (Math.abs(converted) < 0.001 && converted !== 0)
      ? converted.toExponential(3)
      : Number(converted.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 });

    return {
      converted,
      text: `${num} ${fromUnit} = ${formattedVal} ${canonicalUnit}`,
      isDifferent: true,
    };
  } catch (err) {
    return {
      converted: num,
      text: `${err instanceof Error ? err.message : String(err)}`,
      isDifferent: true,
      error: "Conversion error",
    };
  }
}

