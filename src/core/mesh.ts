import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
export function parseOBJMesh(text: string): number[] {
  if (text.length > 2e6) throw Error("OBJ file limit: 2 MB");
  const loaded = new OBJLoader().parse(text);
  loaded.updateMatrixWorld(true);
  const vertices: number[] = [];
  loaded.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      const a = g.getAttribute("position");
      for (let i = 0; i < a.count; i++) {
        const v = new THREE.Vector3()
          .fromBufferAttribute(a, i)
          .applyMatrix4(o.matrixWorld);
        vertices.push(v.x, v.y, v.z);
      }
    }
  });
  if (
    !vertices.length ||
    vertices.length > 90000 ||
    vertices.length % 9 ||
    vertices.some((x) => !Number.isFinite(x))
  )
    throw Error("Use a valid mesh with up to 10,000 triangles");
  const box = new THREE.Box3().setFromArray(vertices),
    center = box.getCenter(new THREE.Vector3()),
    size = box.getSize(new THREE.Vector3()),
    scale = 1 / Math.max(size.x, size.y, size.z, 0.00001);
  for (let i = 0; i < vertices.length; i += 3) {
    vertices[i] = (vertices[i] - center.x) * scale;
    vertices[i + 1] = (vertices[i + 1] - center.y) * scale;
    vertices[i + 2] = (vertices[i + 2] - center.z) * scale;
  }
  return vertices;
}
