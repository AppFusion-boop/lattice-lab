import * as THREE from "three";
import type { SceneData, SceneEventConfig } from "./core/types";
import { eventDefinition, eventEnd } from "./core/scene-events";
const seed = (i: number, k: number) => {
  const n = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
function sprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!,
    g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,.85)");
  g.addColorStop(0.7, "rgba(255,255,255,.24)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function particles(count: number, map: THREE.Texture, additive = false) {
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3),
    color = new Float32Array(count * 3),
    alpha = new Float32Array(count),
    size = new Float32Array(count);
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1));
  geometry.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: map } },
    vertexShader:
      "attribute float alpha;attribute float size;attribute vec3 color;varying float vAlpha;varying vec3 vColor;void main(){vAlpha=alpha;vColor=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(size*380./max(1.,-mv.z),1.,160.);gl_Position=projectionMatrix*mv;}",
    fragmentShader:
      "uniform sampler2D map;varying float vAlpha;varying vec3 vColor;void main(){vec4 c=texture2D(map,gl_PointCoord);gl_FragColor=vec4(vColor,c.a*vAlpha);}",
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    position,
    color,
    alpha,
    size,
    count,
    flush: () => {
      for (const a of Object.values(geometry.attributes)) a.needsUpdate = true;
    },
  };
}
export function createEventVisuals(
  world: THREE.Scene,
  events: SceneEventConfig[],
  scene: SceneData,
) {
  const texture = sprite();
  const group = new THREE.Group();
  world.add(group);
  const updates: ((t: number) => void)[] = [];
  for (const event of events) {
    const d = eventDefinition(event.kind);
    if (!d) continue;
    const p = event.params,
      pos = new THREE.Vector3(Number(p.x), Number(p.y), Number(p.z));
    const kind = d.visual ?? "wave";
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.012, 5, 100),
      new THREE.MeshBasicMaterial({
        color: d.color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        clippingPlanes: [
          new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), scene.width),
          new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
          new THREE.Plane(new THREE.Vector3(0, 0, -1), scene.depth),
        ],
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(pos.x, 0.08, pos.z);
    group.add(ring);
    const fog = particles(
      kind === "mist" ? 1500 : kind === "fire" ? 350 : 90,
      texture,
      kind === "fire" || kind === "light",
    );
    group.add(fog.points);
    const smoke =
      kind === "fire" || kind === "mist" ? particles(170, texture) : null;
    if (smoke) group.add(smoke.points);
    const flash =
      kind === "fire" ? new THREE.PointLight("#ff9a42", 0, 22, 2) : null;
    if (flash) {
      flash.position.copy(pos);
      group.add(flash);
    }
    let nozzles: THREE.Group | undefined;
    if (kind === "mist") {
      nozzles = new THREE.Group();
      const count = Math.round(Number(p.nozzles));
      for (let i = 0; i < count; i++) {
        const n = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.09, 0.11, 8),
          new THREE.MeshStandardMaterial({
            color: "#80a5a9",
            metalness: 0.8,
            roughness: 0.3,
          }),
        );
        n.position.set(
          Math.max(
            0.3,
            Math.min(
              scene.width - 0.3,
              pos.x + ((i + 0.5) / count - 0.5) * Number(p.radius) * 2,
            ),
          ),
          pos.y,
          pos.z,
        );
        nozzles.add(n);
      }
      group.add(nozzles);
    }
    updates.push((time) => {
      const starts = event.starts.filter((s) => time >= s);
      const start = starts.at(-1);
      const age = start === undefined ? -1 : time - start;
      const active = age >= 0 && time <= eventEnd(event, start!);
      const fireAlive =
        kind === "fire" && age >= 0 && age < Math.max(Number(p.duration), 3);
      fog.points.visible = active || fireAlive;
      if (smoke) smoke.points.visible = kind === "mist" ? active : fireAlive;
      if (flash)
        flash.intensity = age >= 0 && age < 0.8 ? 90 * Math.exp(-age * 6) : 0;
      const r = active ? (d.front ? d.front(p, age) : Number(p.radius)) : 0;
      ring.scale.setScalar(Math.max(0.001, r));
      (ring.material as THREE.MeshBasicMaterial).opacity =
        active && kind !== "mist"
          ? kind === "fire" || kind === "wave"
            ? 0.55
            : 0.12
          : 0;
      ring.visible = active;
      if (!active && !fireAlive) return;
      for (let i = 0; i < fog.count; i++) {
        const a = seed(i, 1) * Math.PI * 2,
          b = seed(i, 2),
          c = seed(i, 3);
        let x = 0,
          y = 0,
          z = 0,
          opacity = 0,
          sz = 0.2;
        let red = 1,
          green = 0.5,
          blue = 0.15;
        if (kind === "mist") {
          const flow = Number(p.flow),
            fall = Number(p.fallSpeed),
            life = Math.max(0.1, pos.y / fall),
            offset = seed(i, 4) * life;
          const local = (age + offset) % life;
          const emitted = age >= offset;
          const nozzle = i % Math.round(Number(p.nozzles));
          const spread =
            Math.tan((Number(p.angle) * Math.PI) / 360) * local * fall * 0.35;
          const nx = Math.max(
            0.3,
            Math.min(
              scene.width - 0.3,
              pos.x +
                ((nozzle + 0.5) / Number(p.nozzles) - 0.5) *
                  Number(p.radius) *
                  2,
            ),
          );
          x = nx - pos.x + Math.cos(a) * spread * b;
          y = -local * fall;
          z = Math.sin(a) * spread * b;
          sz =
            p.mode === "Mist"
              ? 0.2 + Number(p.droplet) / 2000
              : p.mode === "Rain"
                ? 0.05
                : 0.1;
          opacity = emitted && b < Math.min(1, flow / 20) ? 0.5 : 0;
          red = 0.55;
          green = 0.86;
          blue = 1;
        } else if (kind === "fire") {
          const expand = Math.min(1, age * 4) * Number(p.fireSize);
          x = Math.cos(a) * b * expand;
          y = (c - 0.25) * expand + age * 0.3;
          z = Math.sin(a) * b * expand;
          sz = (0.4 + b * 0.7) * Math.max(0.05, 1 - age * 0.8);
          opacity = Math.max(0, 1 - age / 1.15) * (1 - b * 0.3);
          green = 0.25 + b * 0.55;
          blue = 0.025 + b * 0.1;
        } else {
          const radius = Number(p.radius);
          x = Math.cos(a) * b * radius;
          z = Math.sin(a) * b * radius;
          y = (c - 0.5) * 0.6 + Math.sin(time * 2 + i) * 0.15;
          sz = kind === "light" ? 0.35 : 0.22;
          opacity = kind === "wave" ? 0.2 : kind === "vibration" ? 0.25 : 0.12;
          const col = new THREE.Color(d.color);
          red = col.r;
          green = col.g;
          blue = col.b;
          if (kind === "wave") {
            x = Math.cos(a) * r;
            z = Math.sin(a) * r;
          }
        }
        const k = i * 3;
        fog.position[k] = pos.x + x;
        fog.position[k + 1] = Math.max(0.02, pos.y + y);
        fog.position[k + 2] = Math.max(
          0.1,
          Math.min(scene.depth - 0.1, pos.z + z),
        );
        fog.color[k] = red;
        fog.color[k + 1] = green;
        fog.color[k + 2] = blue;
        fog.alpha[i] = opacity;
        fog.size[i] = sz;
      }
      fog.flush();
      if (smoke && kind === "mist") {
        for (let i = 0; i < smoke.count; i++) {
          const k = i * 3,
            spread = Number(p.radius),
            fall = Number(p.fallSpeed),
            u = seed(i, 11);
          smoke.position[k] = Math.max(
            0.1,
            Math.min(
              scene.width - 0.1,
              pos.x + (seed(i, 12) - 0.5) * spread * 2,
            ),
          );
          smoke.position[k + 1] = Math.max(
            0.2,
            pos.y - u * Math.min(pos.y, age * fall),
          );
          smoke.position[k + 2] = Math.max(
            0.1,
            Math.min(
              scene.depth - 0.1,
              pos.z + (seed(i, 13) - 0.5) * scene.depth,
            ),
          );
          smoke.color[k] = 0.55;
          smoke.color[k + 1] = 0.82;
          smoke.color[k + 2] = 0.9;
          smoke.alpha[i] =
            Math.min(0.13, Number(p.flow) / 250) * Math.min(1, age * 2);
          smoke.size[i] = 1.1 + seed(i, 14);
        }
        smoke.flush();
      }
      if (smoke && kind === "fire") {
        for (let i = 0; i < smoke.count; i++) {
          const a = seed(i, 8) * Math.PI * 2,
            b = seed(i, 9),
            ageSmoke = Math.max(0, age - 0.15);
          const k = i * 3,
            rad = Math.min(3, ageSmoke) * Number(p.fireSize) * 0.55;
          smoke.position[k] = pos.x + Math.cos(a) * b * rad;
          smoke.position[k + 1] = Math.min(
            scene.height - 0.2,
            pos.y + ageSmoke * 0.6 + seed(i, 6) * rad * 0.5,
          );
          smoke.position[k + 2] = Math.max(
            0.2,
            Math.min(scene.depth - 0.2, pos.z + Math.sin(a) * b * rad),
          );
          smoke.color[k] = 0.18;
          smoke.color[k + 1] = 0.19;
          smoke.color[k + 2] = 0.18;
          smoke.alpha[i] =
            Math.min(0.5, ageSmoke) *
            Math.max(0, 1 - age / 3) *
            Number(p.smoke);
          smoke.size[i] = 0.7 + ageSmoke * 0.8;
        }
        smoke.flush();
      }
    });
  }
  return {
    update: (t: number) => updates.forEach((f) => f(t)),
    dispose: () => {
      world.remove(group);
      texture.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
    },
  };
}
