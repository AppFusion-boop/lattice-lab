import type { Object3D, Vec3 } from "../types";

export interface DxfOptions {
  units?: "mm" | "cm" | "m" | "inch";
  scale?: number;
  plane?: "xy" | "xz" | "yz";
  sliceOffset?: number; // Offset along perpendicular axis
}

/**
 * Generates an AutoCAD R12 compliant ASCII DXF file representing the 2D cross-section
 * or projection of the 3D physical assembly.
 */
export function exportSceneToDxf(objects: Object3D[], options: DxfOptions = {}): string {
  const scale = options.scale ?? 1.0;
  const plane = options.plane ?? "xz"; // For microchannel cold plates, X-Z is the top-down substrate plane

  const lines: string[] = [];

  // 1. Header Section
  lines.push("0", "SECTION", "2", "HEADER");
  lines.push("9", "$ACADVER", "1", "AC1009"); // AutoCAD R12 ASCII
  lines.push("9", "$INSUNITS", "70", options.units === "inch" ? "1" : "4"); // 4 = mm
  lines.push("0", "ENDSEC");

  // 2. Tables Section (Layer definitions)
  lines.push("0", "SECTION", "2", "TABLES");
  lines.push("0", "TABLE", "2", "LAYER", "70", "4");

  const addLayer = (name: string, color: number) => {
    lines.push("0", "LAYER", "2", name, "70", "0", "62", color.toString(), "6", "CONTINUOUS");
  };

  addLayer("0", 7); // Default White
  addLayer("SUBSTRATE", 3); // Green
  addLayer("CHANNELS", 4); // Cyan
  addLayer("FINS", 1); // Red
  addLayer("MANIFOLD", 5); // Blue

  lines.push("0", "ENDTAB");
  lines.push("0", "ENDSEC");

  // 3. Blocks Section (Empty for standard R12)
  lines.push("0", "SECTION", "2", "BLOCKS");
  lines.push("0", "ENDSEC");

  // 4. Entities Section
  lines.push("0", "SECTION", "2", "ENTITIES");

  const writeLine = (
    layer: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ) => {
    lines.push("0", "LINE");
    lines.push("8", layer);
    lines.push("10", (x1 * scale).toFixed(4));
    lines.push("20", (y1 * scale).toFixed(4));
    lines.push("30", "0.0");
    lines.push("11", (x2 * scale).toFixed(4));
    lines.push("21", (y2 * scale).toFixed(4));
    lines.push("31", "0.0");
  };

  const writeRect = (
    layer: string,
    cx: number,
    cy: number,
    width: number,
    height: number
  ) => {
    const hw = width / 2;
    const hh = height / 2;
    const x1 = cx - hw;
    const x2 = cx + hw;
    const y1 = cy - hh;
    const y2 = cy + hh;

    writeLine(layer, x1, y1, x2, y1);
    writeLine(layer, x2, y1, x2, y2);
    writeLine(layer, x2, y2, x1, y2);
    writeLine(layer, x1, y2, x1, y1);
  };

  for (const obj of objects) {
    let layer = "0";
    const nameLower = obj.name.toLowerCase();
    const idLower = obj.id.toLowerCase();

    if (idLower.includes("base") || idLower.includes("substrate") || nameLower.includes("base") || nameLower.includes("substrate")) {
      layer = "SUBSTRATE";
    } else if (idLower.includes("fin") || nameLower.includes("fin") || nameLower.includes("ფარფლ")) {
      layer = "FINS";
    } else if (idLower.includes("stream") || idLower.includes("channel") || nameLower.includes("stream") || nameLower.includes("ნაკად")) {
      layer = "CHANNELS";
    } else if (idLower.includes("manifold") || idLower.includes("port") || nameLower.includes("manifold")) {
      layer = "MANIFOLD";
    }

    let u = 0;
    let v = 0;
    let wU = 1;
    let wV = 1;

    if (plane === "xz") {
      u = obj.position.x;
      v = obj.position.z;
      wU = obj.size.x;
      wV = obj.size.z;
    } else if (plane === "xy") {
      u = obj.position.x;
      v = obj.position.y;
      wU = obj.size.x;
      wV = obj.size.y;
    } else {
      // yz
      u = obj.position.y;
      v = obj.position.z;
      wU = obj.size.y;
      wV = obj.size.z;
    }

    if (obj.shape === "box") {
      writeRect(layer, u, v, wU, wV);
    } else if (obj.shape === "cylinder") {
      // Circle entity
      const radius = Math.min(wU, wV) / 2;
      lines.push("0", "CIRCLE");
      lines.push("8", layer);
      lines.push("10", (u * scale).toFixed(4));
      lines.push("20", (v * scale).toFixed(4));
      lines.push("30", "0.0");
      lines.push("40", (radius * scale).toFixed(4));
    }
  }

  lines.push("0", "ENDSEC");

  // 5. EOF
  lines.push("0", "EOF");

  return lines.join("\r\n") + "\r\n";
}

