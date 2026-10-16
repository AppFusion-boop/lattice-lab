import type { Object3D, Vec3 } from "../types";

export interface StlOptions {
  name?: string;
  scale?: number;
  units?: "mm" | "cm" | "m" | "inch";
}

interface Triangle {
  normal: Vec3;
  v1: Vec3;
  v2: Vec3;
  v3: Vec3;
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalizeVec(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  const edge1 = subVec(v2, v1);
  const edge2 = subVec(v3, v1);
  return normalizeVec(crossVec(edge1, edge2));
}

/**
 * Generates triangles for a 3D box centered at `pos` with size `size`.
 */
function generateBoxTriangles(pos: Vec3, size: Vec3, scale: number): Triangle[] {
  const hx = (size.x / 2) * scale;
  const hy = (size.y / 2) * scale;
  const hz = (size.z / 2) * scale;

  const cx = pos.x * scale;
  const cy = pos.y * scale;
  const cz = pos.z * scale;

  // 8 vertices
  const p000: Vec3 = { x: cx - hx, y: cy - hy, z: cz - hz };
  const p100: Vec3 = { x: cx + hx, y: cy - hy, z: cz - hz };
  const p110: Vec3 = { x: cx + hx, y: cy + hy, z: cz - hz };
  const p010: Vec3 = { x: cx - hx, y: cy + hy, z: cz - hz };

  const p001: Vec3 = { x: cx - hx, y: cy - hy, z: cz + hz };
  const p101: Vec3 = { x: cx + hx, y: cy - hy, z: cz + hz };
  const p111: Vec3 = { x: cx + hx, y: cy + hy, z: cz + hz };
  const p011: Vec3 = { x: cx - hx, y: cy + hy, z: cz + hz };

  const tris: Triangle[] = [];

  const addQuad = (v1: Vec3, v2: Vec3, v3: Vec3, v4: Vec3) => {
    const n1 = computeNormal(v1, v2, v3);
    tris.push({ normal: n1, v1, v2, v3 });
    const n2 = computeNormal(v1, v3, v4);
    tris.push({ normal: n2, v1, v2: v3, v3: v4 });
  };

  // Front (+Z)
  addQuad(p001, p101, p111, p011);
  // Back (-Z)
  addQuad(p100, p000, p010, p110);
  // Top (+Y)
  addQuad(p010, p011, p111, p110);
  // Bottom (-Y)
  addQuad(p000, p100, p101, p001);
  // Right (+X)
  addQuad(p100, p110, p111, p101);
  // Left (-X)
  addQuad(p000, p001, p011, p010);

  return tris;
}

/**
 * Generates an ASCII STL file string representing the watertight 3D triangulated geometry.
 */
export function exportSceneToStl(objects: Object3D[], options: StlOptions = {}): string {
  const solidName = options.name ? options.name.replace(/[^a-zA-Z0-9_-]/g, "_") : "LatticeLab_Export";
  const scale = options.scale ?? 1.0;

  const triangles: Triangle[] = [];

  for (const obj of objects) {
    if (obj.shape === "box") {
      triangles.push(...generateBoxTriangles(obj.position, obj.size, scale));
    } else if (obj.shape === "cylinder") {
      // Approximate cylinder with 16-sided polygon prism
      const segments = 16;
      const radius = (Math.min(obj.size.x, obj.size.z) / 2) * scale;
      const hy = (obj.size.y / 2) * scale;
      const cx = obj.position.x * scale;
      const cy = obj.position.y * scale;
      const cz = obj.position.z * scale;

      const topCenter: Vec3 = { x: cx, y: cy + hy, z: cz };
      const botCenter: Vec3 = { x: cx, y: cy - hy, z: cz };

      const topRing: Vec3[] = [];
      const botRing: Vec3[] = [];

      for (let i = 0; i < segments; i++) {
        const theta = (i / segments) * 2 * Math.PI;
        const rx = Math.cos(theta) * radius;
        const rz = Math.sin(theta) * radius;
        topRing.push({ x: cx + rx, y: cy + hy, z: cz + rz });
        botRing.push({ x: cx + rx, y: cy - hy, z: cz + rz });
      }

      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        // Top cap
        triangles.push({
          normal: { x: 0, y: 1, z: 0 },
          v1: topCenter,
          v2: topRing[i],
          v3: topRing[next],
        });
        // Bottom cap
        triangles.push({
          normal: { x: 0, y: -1, z: 0 },
          v1: botCenter,
          v2: botRing[next],
          v3: botRing[i],
        });
        // Side quad
        const v1 = botRing[i];
        const v2 = botRing[next];
        const v3 = topRing[next];
        const v4 = topRing[i];
        const n1 = computeNormal(v1, v2, v3);
        triangles.push({ normal: n1, v1, v2, v3 });
        const n2 = computeNormal(v1, v3, v4);
        triangles.push({ normal: n2, v1, v2: v3, v3: v4 });
      }
    } else if (obj.vertices && obj.vertices.length >= 9) {
      // Arbitrary vertex array of triangles
      for (let i = 0; i + 8 < obj.vertices.length; i += 9) {
        const v1: Vec3 = {
          x: (obj.position.x + obj.vertices[i]) * scale,
          y: (obj.position.y + obj.vertices[i + 1]) * scale,
          z: (obj.position.z + obj.vertices[i + 2]) * scale,
        };
        const v2: Vec3 = {
          x: (obj.position.x + obj.vertices[i + 3]) * scale,
          y: (obj.position.y + obj.vertices[i + 4]) * scale,
          z: (obj.position.z + obj.vertices[i + 5]) * scale,
        };
        const v3: Vec3 = {
          x: (obj.position.x + obj.vertices[i + 6]) * scale,
          y: (obj.position.y + obj.vertices[i + 7]) * scale,
          z: (obj.position.z + obj.vertices[i + 8]) * scale,
        };
        const normal = computeNormal(v1, v2, v3);
        triangles.push({ normal, v1, v2, v3 });
      }
    }
  }

  // Build STL text stream
  const out: string[] = [];
  out.push(`solid ${solidName}`);

  for (const t of triangles) {
    out.push(
      `  facet normal ${t.normal.x.toFixed(6)} ${t.normal.y.toFixed(6)} ${t.normal.z.toFixed(6)}`
    );
    out.push("    outer loop");
    out.push(`      vertex ${t.v1.x.toFixed(6)} ${t.v1.y.toFixed(6)} ${t.v1.z.toFixed(6)}`);
    out.push(`      vertex ${t.v2.x.toFixed(6)} ${t.v2.y.toFixed(6)} ${t.v2.z.toFixed(6)}`);
    out.push(`      vertex ${t.v3.x.toFixed(6)} ${t.v3.y.toFixed(6)} ${t.v3.z.toFixed(6)}`);
    out.push("    endloop");
    out.push("  endfacet");
  }

  out.push(`endsolid ${solidName}`);
  return out.join("\r\n") + "\r\n";
}

