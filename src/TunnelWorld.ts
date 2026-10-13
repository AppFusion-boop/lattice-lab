import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { SceneData } from "./core/types";
let modelPromise: Promise<THREE.Group> | undefined;
export function tunnelModel() {
  return (modelPromise ??= new GLTFLoader()
    .loadAsync("/models/tunnel-section.glb")
    .then((g) => g.scene));
}
export function buildTunnel(
  world: THREE.Scene,
  scene: SceneData,
  onLoad: () => void = () => {},
) {
  const root = new THREE.Group();
  world.add(root);
  let disposed = false;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!,
    pixels = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4;
      const noise = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const value =
        110 +
        (noise - Math.floor(noise)) * 60 +
        Math.sin(x * 0.21) * Math.cos(y * 0.17) * 14;
      pixels.data[i] = value;
      pixels.data[i + 1] = value;
      pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
  const stone = new THREE.CanvasTexture(canvas);
  stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
  stone.repeat.set(2, 2);
  const rock = new THREE.MeshStandardMaterial({
    map: stone,
    bumpMap: stone,
    bumpScale: 0.08,
    color: "#74766f",
    roughness: 0.98,
    metalness: 0.04,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: "#525b59",
    roughness: 0.45,
    metalness: 0.75,
  });
  const ground = new THREE.MeshStandardMaterial({
    color: "#343c39",
    roughness: 0.96,
  });
  const addBox = (
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  addBox(
    scene.width,
    0.25,
    scene.depth,
    scene.width / 2,
    -0.15,
    scene.depth / 2,
    ground,
  );
  const stripe = new THREE.MeshStandardMaterial({
    color: "#a9995c",
    roughness: 0.7,
  });
  for (let x = 1; x < scene.width; x += 3) {
    addBox(1.2, 0.015, 0.045, x, 0.006, 0.55, stripe);
    addBox(1.2, 0.015, 0.045, x, 0.006, scene.depth - 0.55, stripe);
  }
  // The downloaded open corridor walls form a cutaway, preserving a view of the instruments.
  tunnelModel()
    .then((model) => {
      if (disposed) return;
      const bounds = new THREE.Box3().setFromObject(model),
        size = bounds.getSize(new THREE.Vector3()),
        center = bounds.getCenter(new THREE.Vector3());
      for (let x = 0; x < scene.width; x += 6) {
        const section = model.clone(true);
        section.rotation.y = Math.PI / 2;
        section.scale.set(
          scene.depth / size.x,
          (scene.height * 0.57) / size.y,
          Math.min(6, scene.width - x) / size.z,
        );
        section.position.set(
          x + Math.min(6, scene.width - x) / 2 + center.z * section.scale.z,
          -bounds.min.y * section.scale.y,
          scene.depth / 2 - center.x * section.scale.x,
        );
        section.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry = o.geometry.clone();
            const pos = o.geometry.getAttribute("position"),
              norm = o.geometry.getAttribute("normal"),
              uv = new Float32Array(pos.count * 2);
            for (let i = 0; i < pos.count; i++) {
              const vertical = Math.abs(norm?.getY(i) ?? 0) < 0.7;
              uv[i * 2] = pos.getX(i) * 0.3;
              uv[i * 2 + 1] = (vertical ? pos.getY(i) : pos.getZ(i)) * 0.3;
            }
            o.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
            o.material = rock;
            o.receiveShadow = true;
          }
        });
        root.add(section);
      }
      onLoad();
    })
    .catch(() => {
      if (!disposed) {
        addBox(
          scene.width,
          scene.height * 0.45,
          0.25,
          scene.width / 2,
          scene.height * 0.225,
          scene.depth,
          rock,
        );
        onLoad();
      }
    });
  // Structural arches are added above the downloaded rock walls.
  for (let x = 0.3; x < scene.width; x += 4) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI;
      pts.push(
        new THREE.Vector3(
          x,
          scene.height * 0.45 + Math.sin(a) * scene.height * 0.55,
          scene.depth / 2 + (Math.cos(a) * scene.depth) / 2,
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const arch = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.07, 6, false),
      steel,
    );
    root.add(arch);
    addBox(
      0.14,
      scene.height * 0.46,
      0.14,
      x,
      scene.height * 0.23,
      0.08,
      steel,
    );
    addBox(
      0.14,
      scene.height * 0.46,
      0.14,
      x,
      scene.height * 0.23,
      scene.depth - 0.08,
      steel,
    );
  }
  const pipeMat = new THREE.MeshStandardMaterial({
    color: "#6e898c",
    metalness: 0.65,
    roughness: 0.42,
  });
  for (const z of [scene.depth * 0.27, scene.depth * 0.73]) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, scene.width, 8),
      pipeMat,
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(scene.width / 2, scene.height * 0.91, z);
    root.add(pipe);
  }
  for (let x = 2; x < scene.width; x += 6) {
    const fixture = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.035, 0.12),
      new THREE.MeshStandardMaterial({
        color: "#e2edc5",
        emissive: "#d7f4c9",
        emissiveIntensity: 2,
      }),
    );
    fixture.position.set(x, scene.height * 0.66, scene.depth - 0.14);
    root.add(fixture);
    const light = new THREE.PointLight("#c6e8cd", 16, 9, 2);
    light.position.set(x, scene.height * 0.62, scene.depth * 0.68);
    root.add(light);
  }
  return () => {
    disposed = true;
    world.remove(root);
    const materials = new Set<THREE.Material>();
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          materials.add(m),
        );
      }
    });
    materials.forEach((m) => m.dispose());
    stone.dispose();
  };
}
export function addObserver(world: THREE.Scene, x: number, z: number) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const suit = new THREE.MeshStandardMaterial({
    color: "#dfb95c",
    roughness: 0.8,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: "#263e40",
    roughness: 0.7,
  });
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 0.55, 6, 12),
    suit,
  );
  body.position.y = 1;
  root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), suit);
  head.position.y = 1.64;
  root.add(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.5, 4, 8),
      dark,
    );
    leg.position.set(side * 0.12, 0.38, 0);
    root.add(leg);
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07, 0.42, 4, 8),
      suit,
    );
    arm.position.set(side * 0.29, 1.02, 0);
    arm.rotation.z = side * 0.15;
    root.add(arm);
  }
  world.add(root);
  return root;
}
