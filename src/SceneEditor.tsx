import { FieldMap } from "./FieldMap";
import type { Playback } from "./usePlayback";
import { L, message } from "./core/ka";
import { createEventVisuals } from "./EventVisuals";
import { buildTunnel } from "./TunnelWorld";
import { visibleSampleIndex } from "./core/tunnel-demo";
import { useEffect, useRef, useState, useMemo, useId } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
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
  Eye,
  EyeOff,
  Copy,
  Maximize2,
  Search,
  ChevronDown,
  ChevronRight,
  Focus,
  Grid,
  Cylinder,
  Circle,
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
  transformMode = "select",
  hiddenIds = new Set<string>(),
  wireframe = false,
  snapValue = null,
  onTransformObject,
  onTransformNode,
  cameraControlsRef,
}: {
  guides?: boolean;
  events: SceneEventConfig[];
  time: number;
  scene: SceneData;
  sensors: LabNode[];
  selected: string;
  onSelect: (id: string) => void;
  transformMode?: "select" | "translate" | "rotate" | "scale";
  hiddenIds?: Set<string>;
  wireframe?: boolean;
  snapValue?: number | null;
  onTransformObject?: (
    id: string,
    patch: Partial<Object3D>,
    record?: boolean,
  ) => void;
  onTransformNode?: (
    id: string,
    patch: { x: number; y: number; z: number },
    record?: boolean,
  ) => void;
  cameraControlsRef?: React.MutableRefObject<{
    setIso: () => void;
    setTop: () => void;
    setFront: () => void;
    focus: (id?: string) => void;
  } | null>;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<number[]>([]),
    target = useRef<number[]>([]);
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
    if (target.current.length) {
      controls.target.set(...(target.current as [number, number, number]));
    } else {
      controls.target.set(scene.width / 2, scene.height / 2, scene.depth / 2);
    }
    controls.minDistance = 1;
    controls.maxDistance = 250;

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

    // Scene Objects
    for (const o of scene.objects) {
      const isHidden = hiddenIds.has(o.id);
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
        geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
      } else {
        geometry = new THREE.BoxGeometry(1, 1, 1);
      }
      const material = new THREE.MeshStandardMaterial({
        color: o.id === selected ? "#71b8a2" : o.color,
        roughness: 0.5,
        metalness: 0.12,
        wireframe: wireframe,
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
      mesh.visible = !isHidden;
      world.add(mesh);
      if (!isHidden) pickable.push(mesh);
      if (o.id === selected && !isHidden) {
        world.add(new THREE.BoxHelper(mesh, 0x338d75));
      }
    }

    // Sensors
    for (const n of sensors) {
      const isHidden = hiddenIds.has(n.id);
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.32),
        new THREE.MeshStandardMaterial({
          color: n.id === selected ? 0xe5ab63 : 0x2e968d,
          wireframe: wireframe,
        }),
      );
      mesh.position.set(
        Number(n.params.x),
        Number(n.params.y),
        Number(n.params.z),
      );
      mesh.userData.id = n.id;
      mesh.visible = !isHidden;
      world.add(mesh);
      if (!isHidden) pickable.push(mesh);
      const stem = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(mesh.position.x, 0, mesh.position.z),
          mesh.position,
        ]),
        new THREE.LineBasicMaterial({ color: 0x438d83 }),
      );
      stem.visible = !isHidden;
      world.add(stem);
    }

    // Events
    const eventMeshes: {
      event: SceneEventConfig;
      mesh: THREE.Mesh;
      ring: THREE.Mesh;
    }[] = [];
    for (const event of events) {
      const isHidden = hiddenIds.has(event.id);
      const p = event.params,
        d = eventDefinition(event.kind)!;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 20, 16),
        new THREE.MeshStandardMaterial({
          color: d.color,
          transparent: true,
          wireframe: wireframe,
        }),
      );
      mesh.position.set(Number(p.x), Number(p.y), Number(p.z));
      mesh.userData.id = event.id;
      mesh.visible = !isHidden;
      world.add(mesh);
      if (!isHidden) pickable.push(mesh);
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
      ring.visible = !isHidden && guides;
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(Number(p.x), 0.03, Number(p.z));
      world.add(ring);
      if (event.id === selected && !isHidden) {
        world.add(new THREE.BoxHelper(mesh, 0xce885a));
      }
      eventMeshes.push({ event, mesh, ring });
    }

    const render = () => renderer.render(world, camera);

    // TransformControls Gizmo
    const tControls = new TransformControls(camera, renderer.domElement);
    tControls.size = 0.85;
    const tHelper = tControls.getHelper();
    world.add(tHelper);
    tHelper.visible = false;

    if (snapValue !== null && snapValue > 0) {
      tControls.setTranslationSnap(snapValue);
      tControls.setRotationSnap(THREE.MathUtils.degToRad(15));
      tControls.setScaleSnap(snapValue);
    } else {
      tControls.setTranslationSnap(null);
      tControls.setRotationSnap(null);
      tControls.setScaleSnap(null);
    }

    let isDraggingGizmo = false;
    tControls.addEventListener("dragging-changed", (e: any) => {
      controls.enabled = !e.value;
      isDraggingGizmo = !!e.value;
      if (!e.value) {
        // Drag finished: commit transform
        const targetMesh = tControls.object;
        if (!targetMesh) return;
        const id = targetMesh.userData.id;
        if (!id) return;
        const isObj = scene.objects.some((o) => o.id === id);
        if (isObj) {
          const px = Math.round(targetMesh.position.x * 100) / 100;
          const py = Math.round(targetMesh.position.y * 100) / 100;
          const pz = Math.round(targetMesh.position.z * 100) / 100;
          const sx = Math.max(0.01, Math.round(targetMesh.scale.x * 100) / 100);
          const sy = Math.max(0.01, Math.round(targetMesh.scale.y * 100) / 100);
          const sz = Math.max(0.01, Math.round(targetMesh.scale.z * 100) / 100);
          const ry = Math.round(THREE.MathUtils.radToDeg(targetMesh.rotation.y));
          const rx = Math.round(THREE.MathUtils.radToDeg(targetMesh.rotation.x));
          const rz = Math.round(THREE.MathUtils.radToDeg(targetMesh.rotation.z));
          onTransformObject?.(
            id,
            {
              position: { x: px, y: py, z: pz },
              size: { x: sx, y: sy, z: sz },
              rotation: ry,
              rotationVec: { x: rx, y: ry, z: rz },
            },
            true,
          );
        } else {
          const px = Math.round(targetMesh.position.x * 100) / 100;
          const py = Math.round(targetMesh.position.y * 100) / 100;
          const pz = Math.round(targetMesh.position.z * 100) / 100;
          onTransformNode?.(id, { x: px, y: py, z: pz }, true);
        }
      }
    });

    tControls.addEventListener("change", render);

    // Attach gizmo to selected object if applicable
    const selectedMesh = pickable.find((m) => m.userData.id === selected);
    if (
      selected &&
      selectedMesh &&
      transformMode !== "select" &&
      !hiddenIds.has(selected)
    ) {
      const isNode = !scene.objects.some((o) => o.id === selected);
      if (isNode && (transformMode === "rotate" || transformMode === "scale")) {
        tControls.detach();
        tHelper.visible = false;
      } else {
        tControls.setMode(
          transformMode === "rotate"
            ? "rotate"
            : transformMode === "scale"
            ? "scale"
            : "translate",
        );
        tControls.attach(selectedMesh);
        tHelper.visible = true;
      }
    } else {
      tControls.detach();
      tHelper.visible = false;
    }

    // Camera control presets callback
    if (cameraControlsRef) {
      cameraControlsRef.current = {
        setIso: () => {
          const cx = scene.width / 2,
            cy = scene.height / 2,
            cz = scene.depth / 2;
          const d = Math.max(scene.width, scene.depth, scene.height) * 1.3;
          camera.position.set(cx + d * 0.8, cy + d * 0.7, cz + d * 0.9);
          camera.up.set(0, 1, 0);
          controls.target.set(cx, cy, cz);
          controls.update();
          render();
        },
        setTop: () => {
          const cx = scene.width / 2,
            cy = scene.height / 2,
            cz = scene.depth / 2;
          const d = Math.max(scene.width, scene.depth) * 1.5;
          camera.position.set(cx, cy + d, cz + 0.001);
          camera.up.set(0, 0, -1);
          controls.target.set(cx, cy, cz);
          controls.update();
          render();
        },
        setFront: () => {
          const cx = scene.width / 2,
            cy = scene.height / 2,
            cz = scene.depth / 2;
          const d = Math.max(scene.width, scene.height) * 1.6;
          camera.position.set(cx, cy, cz + d);
          camera.up.set(0, 1, 0);
          controls.target.set(cx, cy, cz);
          controls.update();
          render();
        },
        focus: (targetId?: string) => {
          const id = targetId || selected;
          const targetMesh = pickable.find((m) => m.userData.id === id);
          if (targetMesh) {
            const pos = new THREE.Vector3();
            targetMesh.getWorldPosition(pos);
            controls.target.copy(pos);
            const maxDim = Math.max(
              targetMesh.scale.x,
              targetMesh.scale.y,
              targetMesh.scale.z,
              2,
            );
            const dist = maxDim * 2.8;
            const dir = camera.position.clone().sub(controls.target).normalize();
            if (dir.lengthSq() < 0.01) dir.set(1, 1, 1).normalize();
            camera.position.copy(pos).addScaledVector(dir, dist);
            controls.update();
            render();
          }
        },
      };
    }

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
      camera.updateProjectionMatrix();

      if (!view.current.length) {
        const direction = camera.position
          .clone()
          .sub(controls.target)
          .normalize();
        const right = new THREE.Vector3()
          .crossVectors(camera.up, direction)
          .normalize();
        const up = new THREE.Vector3()
          .crossVectors(direction, right)
          .normalize();
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
      }
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
      if (isDraggingGizmo) return;
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
      tControls.dispose();
      tHelper.removeFromParent();
      eventEffects.dispose();
      cleanupTunnel();
      animateEvents.current = () => {};
      view.current = camera.position.toArray();
      target.current = controls.target.toArray();
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
    transformMode,
    wireframe,
    snapValue,
    Array.from(hiddenIds).sort().join(","),
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
  hiddenIds = new Set<string>(),
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
  hiddenIds?: Set<string>;
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
        const isHidden = hiddenIds.has(event.id);
        const radius = Number(p.radius) * scale;
        return (
          <g
            key={event.id}
            opacity={isHidden ? 0.25 : 1}
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
      ].map((o) => {
        const isHidden = hiddenIds.has(o.id);
        return (
          <g
            key={o.id}
            opacity={isHidden ? 0.25 : 1}
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
        );
      })}
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
    [eventKind, setEventKind] = useState("wavePulse"),
    [transformMode, setTransformMode] = useState<
      "select" | "translate" | "rotate" | "scale"
    >("translate"),
    [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set()),
    [wireframe, setWireframe] = useState(false),
    [snapValue, setSnapValue] = useState<number | null>(null),
    [searchQuery, setSearchQuery] = useState(""),
    [objectsExpanded, setObjectsExpanded] = useState(true),
    [sensorsExpanded, setSensorsExpanded] = useState(true),
    [eventsExpanded, setEventsExpanded] = useState(true);

  const cameraControlsRef = useRef<{
    setIso: () => void;
    setTop: () => void;
    setFront: () => void;
    focus: (id?: string) => void;
  } | null>(null);

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

  const toggleHide = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const duplicateObject = (o: Object3D) => {
    if (scene.objects.length >= 40) {
      setError("სცენაში მაქსიმუმ 40 ობიექტი");
      return;
    }
    const id = crypto.randomUUID();
    const dup: Object3D = {
      ...o,
      id,
      name: `${o.name} (Copy)`,
      position: {
        x: Math.min(scene.width, Math.round((o.position.x + 0.3) * 100) / 100),
        y: o.position.y,
        z: Math.min(scene.depth, Math.round((o.position.z + 0.3) * 100) / 100),
      },
    };
    onPatch(node.id, {
      objects: [...scene.objects, dup],
    });
    setSelected(id);
  };

  const deleteObject = (id: string) => {
    onPatch(node.id, {
      objects: scene.objects.filter((o) => o.id !== id),
    });
    if (selected === id) setSelected("");
  };

  // Keyboard shortcuts listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "q" || e.key === "Q") {
        setTransformMode("select");
      } else if (e.key === "w" || e.key === "W") {
        setTransformMode("translate");
      } else if (e.key === "e" || e.key === "E") {
        setTransformMode("rotate");
      } else if (e.key === "r" || e.key === "R") {
        setTransformMode("scale");
      } else if (e.key === "f" || e.key === "F") {
        if (selected) {
          cameraControlsRef.current?.focus(selected);
        }
      } else if (e.key === "h" || e.key === "H") {
        if (e.altKey) {
          setHiddenIds(new Set());
        } else if (selected) {
          toggleHide(selected);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selected && scene.objects.some((o) => o.id === selected)) {
          deleteObject(selected);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, scene.objects]);

  const add = (shape: "box" | "sphere" | "cylinder" | "source") => {
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
              : shape === "cylinder"
              ? "ცილინდრი"
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
          color:
            shape === "source"
              ? "#dda665"
              : shape === "cylinder"
              ? "#38bdf8"
              : "#85aaa1",
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

  // Search filtering
  const q = searchQuery.toLowerCase().trim();
  const filteredObjects = useMemo(
    () =>
      scene.objects.filter(
        (o) =>
          !q ||
          o.name.toLowerCase().includes(q) ||
          o.shape.toLowerCase().includes(q),
      ),
    [scene.objects, q],
  );
  const filteredSensors = useMemo(
    () =>
      sensors.filter(
        (s) =>
          !q ||
          s.label.toLowerCase().includes(q) ||
          s.kind.toLowerCase().includes(q),
      ),
    [sensors, q],
  );
  const filteredEvents = useMemo(
    () =>
      eventNodes.filter(
        (e) =>
          !q ||
          e.label.toLowerCase().includes(q) ||
          e.kind.toLowerCase().includes(q),
      ),
    [eventNodes, q],
  );

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
          <button onClick={() => add("cylinder")}>
            <Cylinder size={14} />
            ცილინდრი
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
              {mode === "3d" && (
                <div className="viewport-floating-toolbar">
                  <div className="viewport-toolgroup">
                    <button
                      className={`viewport-tool-btn ${transformMode === "select" ? "active" : ""}`}
                      title="მონიშვნა · Select (Q)"
                      onClick={() => setTransformMode("select")}
                    >
                      <MousePointer2 size={13} />
                      <span>Select</span>
                    </button>
                    <button
                      className={`viewport-tool-btn ${transformMode === "translate" ? "active" : ""}`}
                      title="გადაადგილება · Move (W)"
                      onClick={() => setTransformMode("translate")}
                    >
                      <Move3D size={13} />
                      <span>Move</span>
                    </button>
                    <button
                      className={`viewport-tool-btn ${transformMode === "rotate" ? "active" : ""}`}
                      title="ბრუნვა · Rotate (E)"
                      onClick={() => setTransformMode("rotate")}
                    >
                      <RotateCcw size={13} />
                      <span>Rotate</span>
                    </button>
                    <button
                      className={`viewport-tool-btn ${transformMode === "scale" ? "active" : ""}`}
                      title="მასშტაბი · Scale (R)"
                      onClick={() => setTransformMode("scale")}
                    >
                      <Maximize2 size={13} />
                      <span>Scale</span>
                    </button>
                  </div>

                  <div className="viewport-tool-separator" />

                  <div className="viewport-toolgroup">
                    <button
                      className={`viewport-tool-btn ${snapValue !== null ? "active" : ""}`}
                      title="ბადეზე მიბმა · Grid Snap"
                      onClick={() => {
                        if (snapValue === null) setSnapValue(0.1);
                        else if (snapValue === 0.1) setSnapValue(0.5);
                        else if (snapValue === 0.5) setSnapValue(1.0);
                        else setSnapValue(null);
                      }}
                    >
                      <Grid size={13} />
                      <span>{snapValue !== null ? `${snapValue}m` : "Snap Off"}</span>
                    </button>
                  </div>

                  <div className="viewport-tool-separator" />

                  <div className="viewport-toolgroup">
                    <button
                      className="viewport-tool-btn"
                      title="იზომეტრიული ხედი · Isometric View"
                      onClick={() => cameraControlsRef.current?.setIso()}
                    >
                      <span>ISO</span>
                    </button>
                    <button
                      className="viewport-tool-btn"
                      title="ზედხედი · Top View"
                      onClick={() => cameraControlsRef.current?.setTop()}
                    >
                      <span>Top</span>
                    </button>
                    <button
                      className="viewport-tool-btn"
                      title="წინა ხედი · Front View"
                      onClick={() => cameraControlsRef.current?.setFront()}
                    >
                      <span>Front</span>
                    </button>
                    <button
                      className="viewport-tool-btn"
                      title="კამერის ფოკუსი მონიშნულზე · Focus (F)"
                      disabled={!selected}
                      onClick={() => cameraControlsRef.current?.focus(selected)}
                    >
                      <Focus size={13} />
                      <span>Focus</span>
                    </button>
                  </div>

                  <div className="viewport-tool-separator" />

                  <div className="viewport-toolgroup">
                    <button
                      className={`viewport-tool-btn ${wireframe ? "active" : ""}`}
                      title="კარკასული რეჟიმი · Wireframe Mode"
                      onClick={() => setWireframe(!wireframe)}
                    >
                      <Box size={13} />
                      <span>Wire</span>
                    </button>
                    {hiddenIds.size > 0 && (
                      <button
                        className="viewport-tool-btn"
                        title="ყველას გამოჩენა · Unhide All (Alt+H)"
                        onClick={() => setHiddenIds(new Set())}
                      >
                        <Eye size={13} />
                        <span>Show ({hiddenIds.size})</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {mode === "3d" ? (
                <View3D
                  scene={scene}
                  events={events}
                  time={time}
                  sensors={sensors}
                  selected={selected}
                  onSelect={setSelected}
                  transformMode={transformMode}
                  hiddenIds={hiddenIds}
                  wireframe={wireframe}
                  snapValue={snapValue}
                  onTransformObject={(id, patch, rec) =>
                    onPatch(
                      node.id,
                      {
                        objects: scene.objects.map((o) =>
                          o.id === id ? { ...o, ...patch } : o,
                        ),
                      },
                      rec,
                    )
                  }
                  onTransformNode={(id, patch, rec) => {
                    if (controlled(id)) {
                      setError(
                        "პოზიციას 3D ვექტორის ნოუდი მართავს. გადაადგილებისთვის შეცვალეთ ის ნოუდი.",
                      );
                      return;
                    }
                    onPatch(id, patch, rec);
                  }}
                  cameraControlsRef={cameraControlsRef}
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
                  hiddenIds={hiddenIds}
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
                  ? "W (გადაადგილება) · E (ბრუნვა) · R (მასშტაბი) · F (ფოკუსი) · H (დამალვა) · ბორბლით მიახლოება"
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
            {/* TOP HALF: OUTLINER / OBJECT EXPLORER */}
            <div className="scene-outliner">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <h4
                  style={{
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#244d3c",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  <Layers size={14} />
                  <span>ობიექტების ხე</span>
                </h4>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {hiddenIds.size > 0 && (
                    <button
                      className="viewport-tool-btn"
                      style={{ fontSize: "10px", padding: "2px 5px", height: "20px" }}
                      title="ყველას გამოჩენა (Alt+H)"
                      onClick={() => setHiddenIds(new Set())}
                    >
                      <Eye size={11} />
                      <span>{hiddenIds.size} დამალული</span>
                    </button>
                  )}
                  <span className="outliner-group-badge">
                    {scene.objects.length + sensors.length + eventNodes.length}
                  </span>
                </div>
              </div>

              {/* Search Bar */}
              <div className="outliner-search-box">
                <Search size={13} color="#7c9688" />
                <input
                  placeholder="ძიება ობიექტებში…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    onClick={() => setSearchQuery("")}
                  >
                    <X size={12} color="#7c9688" />
                  </button>
                )}
              </div>

              {/* Group: 3D Objects */}
              <div className="outliner-group">
                <button
                  className="outliner-group-header"
                  onClick={() => setObjectsExpanded(!objectsExpanded)}
                >
                  {objectsExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <span>3D ობიექტები</span>
                  <span className="outliner-group-badge">
                    {scene.objects.length}
                  </span>
                </button>
                {objectsExpanded &&
                  filteredObjects.map((o) => {
                    const isHidden = hiddenIds.has(o.id);
                    const isSelected = selected === o.id;
                    return (
                      <div
                        key={o.id}
                        className={`outliner-row ${isSelected ? "selected" : ""} ${isHidden ? "is-hidden" : ""}`}
                        onClick={() => setSelected(o.id)}
                      >
                        <button
                          className="outliner-visibility-btn"
                          title={isHidden ? "გამოჩენა" : "დამალვა (H)"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleHide(o.id);
                          }}
                        >
                          {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        {o.shape === "cylinder" ? (
                          <Cylinder size={13} color={o.color} />
                        ) : o.shape === "sphere" ? (
                          <Circle size={13} color={o.color} />
                        ) : o.shape === "source" ? (
                          <Sun size={13} color={o.color} />
                        ) : (
                          <Box size={13} color={o.color} />
                        )}
                        <span className="outliner-row-name" title={o.name}>
                          {o.name}
                        </span>
                        <span className="outliner-row-badge">{o.shape}</span>
                        <div className="outliner-row-actions">
                          <button
                            className="outliner-action-btn"
                            title="დუბლირება"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateObject(o);
                            }}
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            className="outliner-action-btn danger"
                            title="წაშლა"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteObject(o.id);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Group: Sensors */}
              {sensors.length > 0 && (
                <div className="outliner-group">
                  <button
                    className="outliner-group-header"
                    onClick={() => setSensorsExpanded(!sensorsExpanded)}
                  >
                    {sensorsExpanded ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                    <span>სენსორები</span>
                    <span className="outliner-group-badge">{sensors.length}</span>
                  </button>
                  {sensorsExpanded &&
                    filteredSensors.map((s) => {
                      const isHidden = hiddenIds.has(s.id);
                      const isSelected = selected === s.id;
                      return (
                        <div
                          key={s.id}
                          className={`outliner-row ${isSelected ? "selected" : ""} ${isHidden ? "is-hidden" : ""}`}
                          onClick={() => setSelected(s.id)}
                        >
                          <button
                            className="outliner-visibility-btn"
                            title={isHidden ? "გამოჩენა" : "დამალვა"}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleHide(s.id);
                            }}
                          >
                            {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                          <Radio size={13} color="#2e968d" />
                          <span className="outliner-row-name" title={s.label}>
                            {s.label}
                          </span>
                          <span className="outliner-row-badge">{s.kind}</span>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Group: Events */}
              {eventNodes.length > 0 && (
                <div className="outliner-group">
                  <button
                    className="outliner-group-header"
                    onClick={() => setEventsExpanded(!eventsExpanded)}
                  >
                    {eventsExpanded ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                    <span>მოვლენები</span>
                    <span className="outliner-group-badge">
                      {eventNodes.length}
                    </span>
                  </button>
                  {eventsExpanded &&
                    filteredEvents.map((ev) => {
                      const isHidden = hiddenIds.has(ev.id);
                      const isSelected = selected === ev.id;
                      const def = eventDefinition(ev.kind);
                      return (
                        <div
                          key={ev.id}
                          className={`outliner-row ${isSelected ? "selected" : ""} ${isHidden ? "is-hidden" : ""}`}
                          onClick={() => setSelected(ev.id)}
                        >
                          <button
                            className="outliner-visibility-btn"
                            title={isHidden ? "გამოჩენა" : "დამალვა"}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleHide(ev.id);
                            }}
                          >
                            {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                          <Zap size={13} color={def?.color || "#eab308"} />
                          <span className="outliner-row-name" title={ev.label}>
                            {ev.label}
                          </span>
                          <span className="outliner-row-badge">
                            {ev.params.enabled === "Off" ? "off" : "evt"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* BOTTOM HALF: PROPERTIES INSPECTOR */}
            <div className="scene-inspector">
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
              ) : object ? (
                <div className="inspector-content">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 12,
                    }}
                  >
                    <h4
                      style={{
                        margin: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#1e4d3c",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      <Move3D size={14} />
                      <span>თვისებები</span>
                    </h4>
                    <div className="viewport-toolgroup">
                      <button
                        className={`viewport-tool-btn ${transformMode === "translate" ? "active" : ""}`}
                        title="გადაადგილება (W)"
                        onClick={() => setTransformMode("translate")}
                      >
                        <Move3D size={11} />
                      </button>
                      <button
                        className={`viewport-tool-btn ${transformMode === "rotate" ? "active" : ""}`}
                        title="ბრუნვა (E)"
                        onClick={() => setTransformMode("rotate")}
                      >
                        <RotateCcw size={11} />
                      </button>
                      <button
                        className={`viewport-tool-btn ${transformMode === "scale" ? "active" : ""}`}
                        title="მასშტაბი (R)"
                        onClick={() => setTransformMode("scale")}
                      >
                        <Maximize2 size={11} />
                      </button>
                    </div>
                  </div>

                  <label
                    style={{
                      display: "block",
                      marginBottom: 8,
                      fontSize: "11px",
                      color: "#546e60",
                    }}
                  >
                    სახელი
                    <input
                      type="text"
                      style={{
                        width: "100%",
                        padding: "4px 8px",
                        border: "1px solid #dbe6d5",
                        borderRadius: 4,
                        marginTop: 3,
                        boxSizing: "border-box",
                      }}
                      value={object.name}
                      onChange={(e) =>
                        patchObject({ name: e.target.value.slice(0, 100) })
                      }
                    />
                  </label>

                  <div style={{ marginBottom: 10 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "11px",
                        color: "#546e60",
                      }}
                    >
                      ფორმა
                      <select
                        style={{
                          width: "100%",
                          padding: "4px 6px",
                          border: "1px solid #dbe6d5",
                          borderRadius: 4,
                          marginTop: 3,
                          boxSizing: "border-box",
                        }}
                        value={object.shape}
                        onChange={(e) =>
                          patchObject({ shape: e.target.value as any })
                        }
                      >
                        <option value="box">ყუთი (Box)</option>
                        <option value="cylinder">ცილინდრი (Cylinder)</option>
                        <option value="sphere">სფერო (Sphere)</option>
                        <option value="source">ტალღის წყარო (Source)</option>
                        {object.vertices && (
                          <option value="mesh">მოდელი (Mesh)</option>
                        )}
                      </select>
                    </label>
                  </div>

                  {/* POSITION X, Y, Z */}
                  <div style={{ marginBottom: 10 }}>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 600,
                        color: "#4f6859",
                        display: "block",
                        marginBottom: 4,
                      }}
                    >
                      პოზიცია (Position · m)
                    </span>
                    <div className="transform-matrix-row">
                      {(["x", "y", "z"] as const).map((axis) => (
                        <div key={axis} className="axis-input-group">
                          <span className={`axis-label ${axis}`}>
                            {axis.toUpperCase()}
                          </span>
                          <input
                            type="number"
                            step="0.05"
                            value={object.position[axis]}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v)) {
                                patchObject({
                                  position: {
                                    ...object.position,
                                    [axis]: v,
                                  },
                                });
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* SIZE X, Y, Z */}
                  <div style={{ marginBottom: 10 }}>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 600,
                        color: "#4f6859",
                        display: "block",
                        marginBottom: 4,
                      }}
                    >
                      ზომა (Dimensions · m)
                    </span>
                    <div className="transform-matrix-row">
                      {(["x", "y", "z"] as const).map((axis) => (
                        <div key={axis} className="axis-input-group">
                          <span className={`axis-label ${axis}`}>
                            {axis.toUpperCase()}
                          </span>
                          <input
                            type="number"
                            step="0.05"
                            min="0.01"
                            value={object.size[axis]}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v) && v >= 0.01) {
                                patchObject({
                                  size: { ...object.size, [axis]: v },
                                });
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ROTATION */}
                  <div style={{ marginBottom: 10 }}>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 600,
                        color: "#4f6859",
                        display: "block",
                        marginBottom: 4,
                      }}
                    >
                      ბრუნვა (Rotation · °)
                    </span>
                    <div className="transform-matrix-row">
                      {(["x", "y", "z"] as const).map((axis) => (
                        <div key={axis} className="axis-input-group">
                          <span className={`axis-label ${axis}`}>
                            {axis.toUpperCase()}
                          </span>
                          <input
                            type="number"
                            step="5"
                            value={
                              axis === "y"
                                ? object.rotationVec?.y ?? object.rotation ?? 0
                                : object.rotationVec?.[axis] ?? 0
                            }
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v)) {
                                const curVec = object.rotationVec || {
                                  x: 0,
                                  y: object.rotation || 0,
                                  z: 0,
                                };
                                const newVec = { ...curVec, [axis]: v };
                                patchObject({
                                  rotation: axis === "y" ? v : object.rotation,
                                  rotationVec: newVec,
                                });
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* COLOR & PALETTE */}
                  <div style={{ marginBottom: 12 }}>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 600,
                        color: "#4f6859",
                        display: "block",
                        marginBottom: 4,
                      }}
                    >
                      ფერი და მასალა
                    </span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <input
                        type="color"
                        style={{
                          width: 28,
                          height: 26,
                          padding: 0,
                          border: "1px solid #c9d8c8",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                        value={object.color}
                        onChange={(e) => patchObject({ color: e.target.value })}
                      />
                      <input
                        type="text"
                        style={{
                          width: 75,
                          padding: "3px 6px",
                          border: "1px solid #dbe6d5",
                          borderRadius: 4,
                          fontSize: "11px",
                          fontFamily: "var(--mono)",
                        }}
                        value={object.color}
                        onChange={(e) => patchObject({ color: e.target.value })}
                      />
                    </div>
                    <div className="palette-swatches">
                      {[
                        { color: "#d97736", title: "Copper (სპილენძი)" },
                        { color: "#38bdf8", title: "Coolant (სითხე)" },
                        { color: "#0f766e", title: "Teal (ფირუზისფერი)" },
                        { color: "#334155", title: "Silicon (სილიციუმი)" },
                        { color: "#f59e0b", title: "Warm (თბილი)" },
                        { color: "#ef4444", title: "Hotspot (ცხელი წერტილი)" },
                        { color: "#94a3b8", title: "Clear (გამჭვირვალე)" },
                        { color: "#10b981", title: "Emerald (ზურმუხტისფერი)" },
                      ].map((swatch) => (
                        <button
                          key={swatch.color}
                          className="palette-swatch-btn"
                          style={{ background: swatch.color }}
                          title={swatch.title}
                          onClick={() => patchObject({ color: swatch.color })}
                        />
                      ))}
                    </div>
                  </div>

                  {/* ACTIONS */}
                  <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                    <button
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        padding: "5px 8px",
                        fontSize: "11px",
                        background: "#f2f7ef",
                        border: "1px solid #d5e2d1",
                        borderRadius: 5,
                        cursor: "pointer",
                        color: "#2d5442",
                      }}
                      onClick={() => duplicateObject(object)}
                    >
                      <Copy size={12} />
                      დუბლირება
                    </button>
                    <button
                      className="danger"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        padding: "5px 8px",
                        fontSize: "11px",
                      }}
                      onClick={() => deleteObject(object.id)}
                    >
                      <Trash2 size={12} />
                      წაშლა
                    </button>
                  </div>
                </div>
              ) : sensor ? (
                <div className="inspector-content">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 12,
                    }}
                  >
                    <Radio size={16} color="#2e968d" />
                    <h4
                      style={{
                        margin: 0,
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#1e4d3c",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      სენსორი: {sensor.label}
                    </h4>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 600,
                        color: "#4f6859",
                        display: "block",
                        marginBottom: 4,
                      }}
                    >
                      პოზიცია (Position · m)
                    </span>
                    {controlled(sensor.id) && (
                      <small
                        style={{
                          display: "block",
                          color: "#b45309",
                          marginBottom: 4,
                          fontSize: "10px",
                        }}
                      >
                        პოზიციას 3D ვექტორის ნოუდი მართავს.
                      </small>
                    )}
                    <div className="transform-matrix-row">
                      {(["x", "y", "z"] as const).map((axis) => (
                        <div key={axis} className="axis-input-group">
                          <span className={`axis-label ${axis}`}>
                            {axis.toUpperCase()}
                          </span>
                          <input
                            type="number"
                            step="0.1"
                            disabled={controlled(sensor.id)}
                            value={Number(sensor.params[axis]) || 0}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v)) {
                                onPatch(sensor.id, { [axis]: v });
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    className="primary-soft"
                    style={{
                      width: "100%",
                      marginTop: 10,
                      fontSize: "11px",
                      padding: "6px",
                    }}
                    onClick={() => {
                      onSelectNode(sensor.id);
                      onClose();
                    }}
                  >
                    სენსორის პარამეტრები →
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    padding: "16px 8px",
                    textAlign: "center",
                    color: "#6a8577",
                  }}
                >
                  <MousePointer2
                    size={24}
                    style={{ margin: "0 auto 8px auto", opacity: 0.5 }}
                  />
                  <p
                    style={{
                      margin: "0 0 6px 0",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "#385647",
                    }}
                  >
                    აირჩიეთ ობიექტი
                  </p>
                  <p
                    style={{
                      margin: "0 0 12px 0",
                      fontSize: "10px",
                      lineHeight: 1.4,
                      color: "#5d786a",
                    }}
                  >
                    დააწკაპუნეთ ობიექტს 3D ხედში ან აირჩიეთ ზედა ხიდან.
                  </p>
                  <div
                    style={{
                      textAlign: "left",
                      background: "#f4f8f2",
                      padding: "8px 10px",
                      borderRadius: 6,
                      fontSize: "9.5px",
                      color: "#456353",
                    }}
                  >
                    <b
                      style={{
                        display: "block",
                        marginBottom: 4,
                        color: "#234938",
                      }}
                    >
                      კლავიატურის ღილაკები:
                    </b>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "2px 8px",
                      }}
                    >
                      <code>W</code> <span>გადაადგილება (Move)</span>
                      <code>E</code> <span>ბრუნვა (Rotate)</span>
                      <code>R</code> <span>მასშტაბი (Scale)</span>
                      <code>Q</code> <span>მონიშვნა (Select)</span>
                      <code>F</code> <span>კამერის ფოკუსი</span>
                      <code>H</code> <span>დამალვა / გამოჩენა</span>
                      <code>Alt+H</code> <span>ყველას გამოჩენა</span>
                      <code>Del</code> <span>ობიექტის წაშლა</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
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
