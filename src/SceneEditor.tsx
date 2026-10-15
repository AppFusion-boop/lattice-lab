import { FieldMap } from "./FieldMap";
import type { Playback } from "./usePlayback";
import { L, message } from "./core/ka";
import { createEventVisuals } from "./EventVisuals";
import { buildTunnel } from "./TunnelWorld";
import { visibleSampleIndex } from "./core/tunnel-demo";
import { useEffect, useRef, useState, useMemo, useId } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseOBJMesh } from "./core/mesh";
import {
  X,
  Plus,
  Box,
  Upload,
  Radio,
  MousePointer2,
  Move3D,
  Trash2,
  Layers,
  RotateCcw,
  Info,
  Sun,
  Zap,
  Play,
} from "lucide-react";
import type {
  LabNode,
  Project,
  Object3D,
  SceneData,
  Vec3,
  SceneEventConfig,
  Run,
} from "./core/types";
import { eventDefinition, eventConfig, eventEnd } from "./core/scene-events";
import { EventProperties, EventTimeline } from "./SceneEventTools";
import { sceneEvents } from "./core/scene-events";
import {
  getDefinition,
  attachedEvents,
  attachedSensors,
} from "./core/registry";
function View3D({
  scene,
  sensors,
  selected,
  onSelect,
  events,
  time,
  guides = true,
}: {
  guides?: boolean;
  events: SceneEventConfig[];
  time: number;
  scene: SceneData;
  sensors: LabNode[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<number[]>([]);
  const animateEvents = useRef<(t: number) => void>(() => {});
  useEffect(() => animateEvents.current(time), [time]);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError("WebGL მიუწვდომელია. სცენის შესაცვლელად გამოიყენეთ 2D ხედი.");
      return;
    }
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(
      scene.environment === "Tunnel"
        ? "#14252b"
        : scene.environment === "Molecular"
        ? "#090d16"
        : "#f1f4f2",
    );
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    el.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    world.add(new THREE.HemisphereLight(0xffffff, 0x698581, 2.7));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(10, 25, 10);
    world.add(light);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    camera.position.set(
      ...((view.current.length
        ? view.current
        : [
            scene.width / 2 + Math.max(scene.width, scene.depth) * 0.45,
            Math.max(scene.width, scene.depth) * 0.7,
            scene.depth / 2 + Math.max(scene.width, scene.depth),
          ]) as [number, number, number]),
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(scene.width / 2, scene.height / 2, scene.depth / 2);
    controls.minDistance = 3;
    controls.maxDistance = 180;
    const grid = new THREE.GridHelper(
      Math.max(scene.width, scene.depth),
      20,
      0x99b4ad,
      0xd8e1dc,
    );
    grid.position.set(scene.width / 2, -0.02, scene.depth / 2);
    if (scene.environment !== "Tunnel" && scene.environment !== "Molecular") {
      world.add(grid);
    } else if (scene.environment === "Molecular") {
      const molGrid = new THREE.GridHelper(
        Math.max(scene.width, scene.depth),
        24,
        0x1e293b,
        0x0f172a,
      );
      molGrid.position.set(scene.width / 2, -0.02, scene.depth / 2);
      world.add(molGrid);
    }
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(scene.width, scene.depth),
      new THREE.MeshStandardMaterial({
        color: 0xe8efea,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(scene.width / 2, -0.03, scene.depth / 2);
    if (scene.environment !== "Tunnel" && scene.environment !== "Molecular") {
      world.add(floor);
    }
    const pickable: THREE.Object3D[] = [];
    for (const o of scene.objects) {
      let geometry: THREE.BufferGeometry;
      if (o.shape === "mesh" && o.vertices) {
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(o.vertices, 3),
        );
        geometry.computeVertexNormals();
      } else if (o.shape === "sphere" || o.shape === "source") {
        geometry = new THREE.SphereGeometry(0.5, 24, 18);
      } else if (o.shape === "cylinder") {
        geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
      } else {
        geometry = new THREE.BoxGeometry(1, 1, 1);
      }
      const material = new THREE.MeshStandardMaterial({
        color: o.id === selected ? "#71b8a2" : o.color,
        roughness: 0.5,
        metalness: 0.12,
        transparent: o.shape === "source",
        opacity: o.shape === "source" ? 0.85 : 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(o.position.x, o.position.y, o.position.z);
      mesh.scale.set(o.size.x, o.size.y, o.size.z);
      if (o.rotationVec) {
        mesh.rotation.set(
          (o.rotationVec.x * Math.PI) / 180,
          (o.rotationVec.y * Math.PI) / 180,
          (o.rotationVec.z * Math.PI) / 180,
        );
      } else {
        mesh.rotation.y = (o.rotation * Math.PI) / 180;
      }
      mesh.userData.id = o.id;
      world.add(mesh);
      pickable.push(mesh);
      if (o.id === selected) world.add(new THREE.BoxHelper(mesh, 0x338d75));
    }
    for (const n of sensors) {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.32),
        new THREE.MeshStandardMaterial({
          color: n.id === selected ? 0xe5ab63 : 0x2e968d,
        }),
      );
      mesh.position.set(
        Number(n.params.x),
        Number(n.params.y),
        Number(n.params.z),
      );
      mesh.userData.id = n.id;
      world.add(mesh);
      pickable.push(mesh);
      const stem = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(mesh.position.x, 0, mesh.position.z),
          mesh.position,
        ]),
        new THREE.LineBasicMaterial({ color: 0x438d83 }),
      );
      world.add(stem);
    }
    const eventMeshes: {
      event: SceneEventConfig;
      mesh: THREE.Mesh;
      ring: THREE.Mesh;
    }[] = [];
    for (const event of events) {
      const p = event.params,
        d = eventDefinition(event.kind)!;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 20, 16),
        new THREE.MeshStandardMaterial({ color: d.color, transparent: true }),
      );
      mesh.position.set(Number(p.x), Number(p.y), Number(p.z));
      mesh.userData.id = event.id;
      world.add(mesh);
      pickable.push(mesh);
      const radius = Number(p.radius);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.985, radius, 80),
        new THREE.MeshBasicMaterial({
          color: d.color,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        }),
      );
      ring.visible = guides;
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(Number(p.x), 0.03, Number(p.z));
      world.add(ring);
      if (event.id === selected) world.add(new THREE.BoxHelper(mesh, 0xce885a));
      eventMeshes.push({ event, mesh, ring });
    }
    const render = () => renderer.render(world, camera);
    const cleanupTunnel =
      scene.environment === "Tunnel"
        ? buildTunnel(world, scene, render)
        : () => {};
    const eventEffects = createEventVisuals(world, events, scene);
    animateEvents.current = (t) => {
      eventEffects.update(t);
      for (const { event, mesh, ring } of eventMeshes) {
        const active = event.starts.some(
          (s) => t >= s && t <= eventEnd(event, s),
        );
        (mesh.material as THREE.MeshStandardMaterial).opacity = active
          ? 1
          : 0.35;
        (ring.material as THREE.MeshBasicMaterial).opacity = active
          ? 0.55
          : event.id === selected
            ? 0.25
            : 0.07;
      }
      render();
    };
    animateEvents.current(time);
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect =
        Math.max(1, el.clientWidth) / Math.max(1, el.clientHeight);
      const direction = camera.position
        .clone()
        .sub(controls.target)
        .normalize();
      const right = new THREE.Vector3()
        .crossVectors(camera.up, direction)
        .normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      let distance = 3;
      for (const x of [0, scene.width])
        for (const y of [0, scene.height])
          for (const z of [0, scene.depth]) {
            const corner = new THREE.Vector3(x, y, z).sub(controls.target);
            distance = Math.max(
              distance,
              corner.dot(direction) +
                Math.abs(corner.dot(right)) / (tangent * camera.aspect),
              corner.dot(direction) + Math.abs(corner.dot(up)) / tangent,
            );
          }
      camera.position
        .copy(controls.target)
        .addScaledVector(direction, distance * 1.12);
      camera.updateProjectionMatrix();
      controls.update();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    controls.addEventListener("change", render);
    controls.update();
    resize();
    let down = { x: 0, y: 0 };
    const pointerdown = (e: PointerEvent) =>
      (down = { x: e.clientX, y: e.clientY });
    const pick = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const b = el.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - b.left) / b.width) * 2 - 1,
          (-(e.clientY - b.top) / b.height) * 2 + 1,
        ),
        camera,
      );
      const item = ray.intersectObjects(pickable, false)[0];
      if (item) onSelect(item.object.userData.id);
    };
    renderer.domElement.addEventListener("pointerdown", pointerdown);
    renderer.domElement.addEventListener("pointerup", pick);
    return () => {
      eventEffects.dispose();
      cleanupTunnel();
      animateEvents.current = () => {};
      view.current = camera.position.toArray();
      observer.disconnect();
      controls.dispose();
      world.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((x) => x.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [
    JSON.stringify(scene),
    JSON.stringify(sensors.map((n) => ({ id: n.id, params: n.params }))),
    selected,
  ]);
  return (
    <div className="three-view" ref={host}>
      {error && <p>{message(error)}</p>}
    </div>
  );
}
function View2D({
  scene,
  sensors,
  selected,
  onSelect,
  onMove,
  onStart,
  onEnd,
  events,
  time,
}: {
  events: SceneEventConfig[];
  time: number;
  scene: SceneData;
  sensors: LabNode[];
  selected: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, z: number) => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const gridId = useId();
  const drag = useRef<string | null>(null),
    ref = useRef<SVGSVGElement>(null);
  const w = 800,
    h = 480,
    pad = 45,
    scale = Math.min((w - pad * 2) / scene.width, (h - pad * 2) / scene.depth),
    width = scene.width * scale,
    depth = scene.depth * scale,
    left = (w - width) / 2,
    top = (h - depth) / 2;
  return (
    <svg
      ref={ref}
      className="plan-view"
      viewBox={"0 0 " + w + " " + h}
      aria-label="2D სცენა: გადაათრიეთ ობიექტები და სენსორები"
      onPointerMove={(e) => {
        if (!drag.current) return;
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
          ref.current!.getScreenCTM()!.inverse(),
        );
        onMove(
          drag.current,
          Math.round(
            Math.max(0, Math.min(scene.width, (pt.x - left) / scale)) * 10,
          ) / 10,
          Math.round(
            Math.max(0, Math.min(scene.depth, (pt.y - top) / scale)) * 10,
          ) / 10,
        );
      }}
      onPointerUp={() => {
        if (drag.current) onEnd();
        drag.current = null;
      }}
      onPointerCancel={() => {
        if (drag.current) onEnd();
        drag.current = null;
      }}
    >
      <defs>
        <pattern
          id={gridId}
          width={scale}
          height={scale}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={"M " + scale + " 0 L 0 0 0 " + scale}
            fill="none"
            stroke="#d9e2dc"
            strokeWidth=".6"
          />
        </pattern>
      </defs>
      <rect
        x={left}
        y={top}
        width={width}
        height={depth}
        fill="#eef3ef"
        stroke="#a9bdb2"
      />
      <rect
        x={left}
        y={top}
        width={width}
        height={depth}
        fill={"url(#" + gridId + ")"}
      />
      <text x={left} y={top - 15}>
        ზედხედი · X / Z
      </text>
      <text x={left + width / 2} y={top + depth + 27} textAnchor="middle">
        {scene.width} მ
      </text>
      <text x={left - 12} y={top + depth / 2} textAnchor="end">
        {scene.depth} მ
      </text>
      {events.map((event) => {
        const p = event.params,
          d = eventDefinition(event.kind)!;
        const start = [...event.starts]
          .reverse()
          .find((s) => time >= s && time <= eventEnd(event, s));
        const active = start !== undefined;
        const radius = Number(p.radius) * scale;
        return (
          <g
            key={event.id}
            transform={
              "translate(" +
              (left + Number(p.x) * scale) +
              " " +
              (top + Number(p.z) * scale) +
              ")"
            }
            className="scene-draggable"
            onPointerDown={(e) => {
              e.stopPropagation();
              onStart();
              onSelect(event.id);
              drag.current = event.id;
              ref.current!.setPointerCapture(e.pointerId);
            }}
          >
            <circle
              r={radius}
              fill={d.color + (active ? "13" : "06")}
              stroke={d.color}
              strokeOpacity={active ? 0.6 : 0.2}
              strokeDasharray="5 5"
            />
            {active && d.front && (
              <circle
                r={d.front(p, time - start) * scale}
                fill="none"
                stroke={d.color}
                strokeWidth="2"
              />
            )}
            <circle
              r="10"
              fill={d.color}
              opacity={active ? 1 : 0.5}
              stroke={selected === event.id ? "#374e45" : "white"}
              strokeWidth="2"
            />
            <path d="M-2 -5 L3 -5 L0 0 L4 0 L-3 6 L-1 1 L-4 1 Z" fill="white" />
            <text y="-18" textAnchor="middle">
              {event.label}
            </text>
          </g>
        );
      })}
      {[
        ...scene.objects.map((o) => ({
          id: o.id,
          label: o.name,
          x: o.position.x,
          z: o.position.z,
          shape: o.shape,
          color: o.color,
          sx: o.size.x,
          sz: o.size.z,
        })),
        ...sensors.map((n) => ({
          id: n.id,
          label: n.label,
          x: Number(n.params.x),
          z: Number(n.params.z),
          shape: "sensor",
          color: "#318f85",
          sx: 0.5,
          sz: 0.5,
        })),
      ].map((o) => (
        <g
          key={o.id}
          transform={
            "translate(" +
            (left + o.x * scale) +
            " " +
            (top + o.z * scale) +
            ")"
          }
          className="scene-draggable"
          onPointerDown={(e) => {
            e.stopPropagation();
            onStart();
            onSelect(o.id);
            drag.current = o.id;
            ref.current!.setPointerCapture(e.pointerId);
          }}
        >
          {o.shape === "source" &&
            [18, 28, 38].map((r) => (
              <circle key={r} r={r} fill="none" stroke="#d7af7840" />
            ))}
          {o.shape === "box" || o.shape === "mesh" || o.shape === "cylinder" ? (
            <rect
              x={(-o.sx * scale) / 2}
              y={(-o.sz * scale) / 2}
              width={o.sx * scale}
              height={o.sz * scale}
              rx="3"
              fill={o.color + "60"}
              stroke={o.id === selected ? "#246e5c" : o.color}
              strokeWidth={o.id === selected ? 3 : 1.5}
            />
          ) : (
            <circle
              r={o.shape === "sensor" ? 8 : Math.max(7, (o.sx * scale) / 2)}
              fill={o.color}
              stroke={selected === o.id ? "#224f42" : "white"}
              strokeWidth="2"
            />
          )}
          <text
            y={o.shape === "box" ? (o.sz * scale) / 2 + 15 : -16}
            textAnchor="middle"
          >
            {o.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
export function SceneEditor({
  node,
  project,
  ka,
  onClose,
  onPatch,
  onSelectNode,
  onAddSensor,
  onAddEvent,
  onDetach,
  run,
  onRun,
  playback,
  running,
  onEventTrigger,
  onRename,
  onStart,
  onEnd,
}: {
  node: LabNode;
  project: Project;
  ka: boolean;
  onClose: () => void;
  onPatch: (id: string, p: Record<string, unknown>, record?: boolean) => void;
  onSelectNode: (id: string) => void;
  onAddSensor: (kind: string, scene: string) => void;
  onEventTrigger: (id: string, value: string) => void;
  onRename: (id: string, label: string) => void;
  onAddEvent: (kind: string, scene: string) => string | undefined;
  onDetach: (id: string) => void;
  run: Run | null;
  onRun: () => void;
  playback: Playback;
  running: boolean;
  onStart: () => void;
  onEnd: () => void;
}) {
  const [mode, setMode] = useState(node.kind === "scene3d" ? "3d" : "2d"),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [sensorKind, setSensorKind] = useState("pressure"),
    [eventKind, setEventKind] = useState("wavePulse");
  const { time, playing } = playback;
  const file = useRef<HTMLInputElement>(null);
  const scene = useMemo(
    () =>
      ({
        ...node.params,
        dimension: node.kind === "scene3d" ? 3 : 2,
      }) as SceneData,
    [node.params, node.kind],
  );
  const eventNodes = useMemo(
    () => attachedEvents(project, node.id),
    [project, node.id],
  );
  const events = useMemo(
    () =>
      eventNodes.map((n) => {
        const wire = project.edges.find(
            (e) => e.target === n.id && e.targetHandle === "trigger",
          ),
          packet = wire
            ? run?.results[wire.source]?.outputs[wire.sourceHandle]
            : undefined;
        return eventConfig(
          n,
          wire ? (packet?.type === "event" ? packet.value : []) : undefined,
        );
      }),
    [eventNodes, project.edges, run],
  );
  const unresolved = eventNodes.filter(
    (n) =>
      project.edges.some(
        (e) => e.target === n.id && e.targetHandle === "trigger",
      ) && !run,
  ).length;
  const eventNode = eventNodes.find((n) => n.id === selected);
  const controlled = (id: string) =>
    project.edges.some((e) => e.target === id && e.targetHandle === "position");
  const sensors = useMemo(
    () =>
      project.nodes
        .filter(
          (n) =>
            getDefinition(n.kind, project.tools)?.category === "Sensors" &&
            project.edges.some(
              (e) =>
                e.target === node.id &&
                e.source === n.id &&
                e.targetHandle === "sensors",
            ),
        )
        .map((n) => {
          const e = project.edges.find(
              (e) => e.target === n.id && e.targetHandle === "position",
            ),
            v = project.nodes.find((v) => v.id === e?.source);
          return v?.kind === "vector"
            ? {
                ...n,
                params: {
                  ...n.params,
                  x: v.params.x,
                  y: v.params.y,
                  z: v.params.z,
                },
              }
            : n;
        }),
    [project, node.id],
  );
  const object = scene.objects.find((o) => o.id === selected),
    sensor = sensors.find((n) => n.id === selected);
  const patchObject = (patch: Partial<Object3D>, record = true) =>
    onPatch(
      node.id,
      {
        objects: scene.objects.map((o) =>
          o.id === selected ? { ...o, ...patch } : o,
        ),
      },
      record,
    );
  const add = (shape: "box" | "sphere" | "source") => {
    if (scene.objects.length >= 40) {
      setError("სცენაში მაქსიმუმ 40 ობიექტი");
      return;
    }
    const id = crypto.randomUUID();
    onPatch(node.id, {
      objects: [
        ...scene.objects,
        {
          id,
          name:
            shape === "source"
              ? "ტალღის წყარო"
              : shape === "box"
                ? "ყუთი"
                : "სფერო",
          shape,
          position: { x: scene.width / 2, y: 1, z: scene.depth / 2 },
          size: {
            x: shape === "source" ? 0.5 : 2,
            y: shape === "source" ? 0.5 : 2,
            z: shape === "source" ? 0.5 : 2,
          },
          color: shape === "source" ? "#dda665" : "#85aaa1",
          rotation: 0,
        },
      ],
    });
    setSelected(id);
  };
  const importOBJ = async (f: File) => {
    try {
      if (f.size > 2e6) throw Error("OBJ file limit: 2 MB");
      if (scene.objects.length >= 40) throw Error("მაქსიმუმ 40 ობიექტი");
      const vertices = parseOBJMesh(await f.text());
      const id = crypto.randomUUID();
      onPatch(node.id, {
        objects: [
          ...scene.objects,
          {
            id,
            name: f.name.slice(0, 80),
            shape: "mesh",
            position: { x: scene.width / 2, y: 1.5, z: scene.depth / 2 },
            size: { x: 3, y: 3, z: 3 },
            rotation: 0,
            color: "#89a8b7",
            vertices,
          },
        ],
      });
      setSelected(id);
      setMode("3d");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="modal-shade">
      <section
        className="scene-modal"
        role="dialog"
        aria-modal="true"
        aria-label="სცენის რედაქტორი"
      >
        <header>
          <span className="icon-tile scene">
            <Box size={20} />
          </span>
          <div>
            <h2>{node.label}</h2>
            <p>
              {ka
                ? "სივრცე, ობიექტები და სენსორები"
                : "სივრცე, სენსორები და დაგეგმილი მოვლენები"}
            </p>
          </div>
          <div className="segmented">
            <button
              className={mode === "2d" ? "active" : ""}
              onClick={() => setMode("2d")}
            >
              2D გეგმა
            </button>
            <button
              className={mode === "3d" ? "active" : ""}
              onClick={() => setMode("3d")}
            >
              3D ხედი
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="სცენის რედაქტორის დახურვა"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="scene-toolbar">
          <button onClick={() => add("box")}>
            <Plus size={14} />
            ყუთი
          </button>
          <button onClick={() => add("sphere")}>
            <Plus size={14} />
            სფერო
          </button>
          <button onClick={() => add("source")}>
            <Sun size={14} />
            ტალღის წყარო
          </button>
          <button onClick={() => file.current?.click()}>
            <Upload size={14} />
            OBJ-ის იმპორტი
          </button>
          <input
            ref={file}
            type="file"
            accept=".obj"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importOBJ(f);
              e.target.value = "";
            }}
          />
          <span />
          <select
            aria-label="დასამატებელი სენსორი"
            value={sensorKind}
            onChange={(e) => setSensorKind(e.target.value)}
          >
            {[
              "pressure",
              "temperature",
              "accelerometer",
              "microphone",
              "light",
            ].map((k) => (
              <option key={k} value={k}>
                {getDefinition(k)!.title}
              </option>
            ))}
          </select>
          <button onClick={() => onAddSensor(sensorKind, node.id)}>
            <Radio size={14} />
            {ka ? "სენსორის დამატება" : "სენსორის დამატება"}
          </button>
        </div>
        <div className="scene-event-toolbar">
          <span>
            <Zap size={14} />
            სცენის მოვლენები
          </span>
          <select
            aria-label="დასამატებელი მოვლენა"
            value={eventKind}
            onChange={(e) => setEventKind(e.target.value)}
          >
            {sceneEvents.map((d) => (
              <option value={d.id} key={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <button
            className="event-add"
            onClick={() => {
              const id = onAddEvent(eventKind, node.id);
              if (id) setSelected(id);
            }}
          >
            <Plus size={14} />
            {ka ? "მოვლენის დამატება" : "მოვლენის დამატება"}
          </button>
          <small>
            {events.length} მოვლენა · {sensors.length} სენსორის გამომავალი
          </small>
          <button
            onClick={() => (playing ? playback.pause() : onRun())}
            disabled={running}
          >
            <Play size={13} />
            {running ? "მზადდება…" : playing ? "პაუზა" : "სიმულაციის დაკვრა"}
          </button>
        </div>
        <div className="scene-body">
          <div className="scene-stage">
            <div className="scene-viewport">
              {mode === "3d" ? (
                <View3D
                  scene={scene}
                  events={events}
                  time={time}
                  sensors={sensors}
                  selected={selected}
                  onSelect={setSelected}
                />
              ) : (
                <View2D
                  events={events}
                  time={time}
                  scene={scene}
                  sensors={sensors}
                  selected={selected}
                  onSelect={setSelected}
                  onStart={onStart}
                  onEnd={onEnd}
                  onMove={(id, x, z) => {
                    const o = scene.objects.find((o) => o.id === id);
                    if (o)
                      onPatch(
                        node.id,
                        {
                          objects: scene.objects.map((o) =>
                            o.id === id
                              ? { ...o, position: { ...o.position, x, z } }
                              : o,
                          ),
                        },
                        false,
                      );
                    else if (!controlled(id)) onPatch(id, { x, z }, false);
                    else
                      setError(
                        "პოზიციას 3D ვექტორის ნოუდი მართავს. გადაადგილებისთვის შეცვალეთ ის ნოუდი.",
                      );
                  }}
                />
              )}
              <div className="scene-viewport-note">
                <MousePointer2 size={13} />
                {mode === "3d"
                  ? "გადაათრიეთ მოსაბრუნებლად · მიახლოება ბორბლით · მონიშვნა დაჭერით"
                  : "გადაათრიეთ ობიექტი, სენსორი ან მოვლენა · კოორდინატები მეტრებში"}
              </div>
            </div>
            <div className="scene-live-readings">
              <span>პირდაპირი ჩვენება · {time.toFixed(2)} წმ</span>
              {sensors.map((s) => {
                const packet = run?.results[node.id]?.outputs["sensor:" + s.id];
                const signal =
                  packet?.type === "signal" ? packet.value : undefined;
                const index = signal
                  ? visibleSampleIndex(signal.times, time)
                  : -1;
                return (
                  <span key={s.id}>
                    {s.label}:{" "}
                    <b>
                      {index >= 0 && signal
                        ? signal.values[index].toFixed(2)
                        : "—"}{" "}
                      {signal?.unit}
                    </b>
                  </span>
                );
              })}
            </div>
            <EventTimeline
              events={events}
              duration={project.duration}
              time={time}
              onTime={playback.seek}
              playing={playing}
              onPlaying={(value) => (value ? onRun() : playback.pause())}
              speed={playback.speed}
              onSpeed={playback.setSpeed}
              preparing={running}
              selected={selected}
              onSelect={setSelected}
              onPatch={onPatch}
              onStart={onStart}
              onEnd={onEnd}
              unresolved={unresolved}
            />
          </div>
          <aside className="scene-properties">
            <h4>
              <Layers size={14} />
              {ka ? "სცენის ობიექტები" : "სცენის შემადგენლობა"}
            </h4>
            {scene.objects.map((o) => (
              <button
                className={
                  "hierarchy-row " + (o.id === selected ? "selected" : "")
                }
                key={o.id}
                onClick={() => setSelected(o.id)}
              >
                <Box size={14} />
                {o.name}
                <small>{L(o.shape)}</small>
              </button>
            ))}
            {sensors.map((n) => (
              <button
                key={n.id}
                className={
                  "hierarchy-row " + (n.id === selected ? "selected" : "")
                }
                onClick={() => setSelected(n.id)}
              >
                <Radio size={14} />
                {n.label}
                <small>სენსორი</small>
              </button>
            ))}
            {eventNodes.map((n) => (
              <button
                key={n.id}
                className={
                  "hierarchy-row " + (selected === n.id ? "selected" : "")
                }
                onClick={() => setSelected(n.id)}
              >
                <Zap size={14} color={eventDefinition(n.kind)?.color} />
                {n.label}
                <small>
                  {n.params.enabled === "Off" ? "გამორთული" : "მოვლენა"}
                </small>
              </button>
            ))}
            {eventNode ? (
              <EventProperties
                node={eventNode}
                scene={scene}
                project={project}
                onTrigger={(value) => onEventTrigger(eventNode.id, value)}
                onRename={(label) => onRename(eventNode.id, label)}
                onPatch={onPatch}
                onStart={onStart}
                onEnd={onEnd}
                onDetach={() => {
                  onDetach(eventNode.id);
                  setSelected("");
                }}
              />
            ) : object || sensor ? (
              <div className="transform-panel">
                <h4>
                  <Move3D size={14} />
                  {ka ? "ტრანსფორმაცია" : "გარდაქმნა"}
                </h4>
                <label>
                  სახელი
                  <input
                    value={object?.name || sensor!.label}
                    readOnly={!!sensor}
                    onChange={(e) =>
                      patchObject({ name: e.target.value.slice(0, 100) })
                    }
                  />
                </label>
                {(["x", "y", "z"] as const).map((k) => (
                  <label key={k}>
                    პოზიცია {k.toUpperCase()} · m
                    <input
                      aria-label={"ობიექტის პოზიცია " + k.toUpperCase()}
                      disabled={!!sensor && controlled(sensor.id)}
                      type="number"
                      min="0"
                      max={
                        k === "x"
                          ? scene.width
                          : k === "y"
                            ? scene.height
                            : scene.depth
                      }
                      step=".1"
                      value={
                        object ? object.position[k] : Number(sensor!.params[k])
                      }
                      onChange={(e) => {
                        const v = Number(e.target.value),
                          limit =
                            k === "x"
                              ? scene.width
                              : k === "y"
                                ? scene.height
                                : scene.depth;
                        if (!Number.isFinite(v) || v < 0 || v > limit) return;
                        if (object)
                          patchObject({
                            position: { ...object.position, [k]: v },
                          });
                        else onPatch(sensor!.id, { [k]: v });
                      }}
                    />
                  </label>
                ))}
                {object && (
                  <>
                    {(["x", "y", "z"] as const).map((k) => (
                      <label key={k}>
                        ზომა {k.toUpperCase()}
                        <input
                          type="number"
                          min=".01"
                          max="100"
                          step=".1"
                          value={object.size[k]}
                          onChange={(e) => {
                            const v = +e.target.value;
                            if (v >= 0.01 && v <= 100)
                              patchObject({ size: { ...object.size, [k]: v } });
                          }}
                        />
                      </label>
                    ))}
                    <label>
                      ბრუნვა Y · °
                      <input
                        type="number"
                        min="-360"
                        max="360"
                        value={object.rotation}
                        onChange={(e) => {
                          const v = +e.target.value;
                          if (v >= -360 && v <= 360)
                            patchObject({ rotation: v });
                        }}
                      />
                    </label>
                    <label>
                      ფერი
                      <input
                        type="color"
                        value={object.color}
                        onChange={(e) => patchObject({ color: e.target.value })}
                      />
                    </label>
                    <button
                      className="danger"
                      onClick={() => {
                        onPatch(node.id, {
                          objects: scene.objects.filter(
                            (o) => o.id !== selected,
                          ),
                        });
                        setSelected("");
                      }}
                    >
                      <Trash2 size={13} />
                      ობიექტის წაშლა
                    </button>
                  </>
                )}
                {sensor && (
                  <button
                    className="primary-soft"
                    onClick={() => {
                      onSelectNode(sensor.id);
                      onClose();
                    }}
                  >
                    სენსორის პარამეტრები →
                  </button>
                )}
              </div>
            ) : (
              <p className="muted scene-select-help">
                აირჩიეთ ობიექტი, სენსორი ან მოვლენა. 2D გეგმაში ნიშნულები
                გადაათრიეთ.
              </p>
            )}
          </aside>
        </div>
        <footer>
          <Info size={14} />
          {error ||
            "საილუსტრაციო მოდელი · მოვლენები ცვლის საწყის წყაროს · გეომეტრია ტალღებს არ აირეკლავს."}
        </footer>
      </section>
    </div>
  );
}

const noSceneMove = () => {};
export function ScenePreview({
  node,
  project,
  run,
  time,
  onSelect,
  compact = false,
}: {
  node: LabNode;
  project: Project;
  run: Run | null;
  time: number;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const [mode, setMode] = useState(node.kind === "scene2d" ? "2d" : "3d");
  const scene = useMemo(() => {
    const packet = Object.values(run?.results[node.id]?.outputs ?? {}).find(
      (p) => p.type === "scene",
    );
    if (packet?.type === "scene") return packet.value;
    return {
      ...node.params,
      dimension: node.kind === "scene2d" ? 2 : 3,
      events: attachedEvents(project, node.id).map((n) =>
        eventConfig(
          n,
          project.edges.some(
            (e) => e.target === n.id && e.targetHandle === "trigger",
          )
            ? []
            : undefined,
        ),
      ),
    } as SceneData;
  }, [node, project, run]);
  const sensors = useMemo(
    () =>
      attachedSensors(project, node.id).map((n) => {
        const packet = run?.results[n.id]?.outputs.sensor;
        return packet?.type === "sensor"
          ? { ...n, params: { ...n.params, ...packet.value.position } }
          : n;
      }),
    [node.id, project, run],
  );
  return (
    <div className="monitor-scene">
      <div className="monitor-view-options">
        <button
          className={mode === "2d" ? "active" : ""}
          onClick={() => setMode("2d")}
        >
          2D
        </button>
        <button
          className={mode === "3d" ? "active" : ""}
          onClick={() => setMode("3d")}
        >
          3D
        </button>
        <span>
          {time.toFixed(2)} წმ · {sensors.length} სენსორი
        </span>
      </div>
      <div className="monitor-viewport">
        {mode === "3d" ? (
          <View3D
            guides={false}
            scene={scene}
            sensors={sensors}
            selected=""
            onSelect={onSelect}
            events={scene.events ?? []}
            time={time}
          />
        ) : (
          <View2D
            scene={scene}
            sensors={sensors}
            selected=""
            onSelect={onSelect}
            onMove={noSceneMove}
            onStart={noSceneMove}
            onEnd={noSceneMove}
            events={scene.events ?? []}
            time={time}
          />
        )}
      </div>
      {!compact && <FieldMap scene={scene} time={time} />}
    </div>
  );
}
