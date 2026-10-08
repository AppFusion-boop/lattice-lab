import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import type { LabNode, Project, Object3D, SceneData, Vec3 } from "./core/types";
import { getDefinition } from "./core/registry";
function View3D({
  scene,
  sensors,
  selected,
  onSelect,
}: {
  scene: SceneData;
  sensors: LabNode[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<number[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError("WebGL is unavailable. Use the 2D view to edit this scene.");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor("#f1f4f2");
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
            scene.width * 1.15,
            Math.max(scene.width, scene.depth) * 0.95,
            scene.depth * 1.7,
          ]) as [number, number, number]),
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(scene.width / 2, 0, scene.depth / 2);
    controls.minDistance = 3;
    controls.maxDistance = 180;
    const grid = new THREE.GridHelper(
      Math.max(scene.width, scene.depth),
      20,
      0x99b4ad,
      0xd8e1dc,
    );
    grid.position.set(scene.width / 2, -0.02, scene.depth / 2);
    world.add(grid);
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
    world.add(floor);
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
      } else
        geometry =
          o.shape === "sphere" || o.shape === "source"
            ? new THREE.SphereGeometry(0.5, 24, 18)
            : new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({
        color: o.id === selected ? "#71b8a2" : o.color,
        roughness: 0.6,
        metalness: 0.08,
        transparent: o.shape === "source",
        opacity: o.shape === "source" ? 0.85 : 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(o.position.x, o.position.y, o.position.z);
      mesh.scale.set(o.size.x, o.size.y, o.size.z);
      mesh.rotation.y = (o.rotation * Math.PI) / 180;
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
    const render = () => renderer.render(world, camera);
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
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
      {error && <p>{error}</p>}
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
}: {
  scene: SceneData;
  sensors: LabNode[];
  selected: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, z: number) => void;
  onStart: () => void;
  onEnd: () => void;
}) {
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
      aria-label="2D scene: drag objects and sensors"
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
          id="scene-grid"
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
        fill="url(#scene-grid)"
      />
      <text x={left} y={top - 15}>
        TOP VIEW · X / Z
      </text>
      <text x={left + width / 2} y={top + depth + 27} textAnchor="middle">
        {scene.width} m
      </text>
      <text x={left - 12} y={top + depth / 2} textAnchor="end">
        {scene.depth} m
      </text>
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
          {o.shape === "box" || o.shape === "mesh" ? (
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
  onStart: () => void;
  onEnd: () => void;
}) {
  const [mode, setMode] = useState(node.kind === "scene3d" ? "3d" : "2d"),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [sensorKind, setSensorKind] = useState("pressure");
  const file = useRef<HTMLInputElement>(null);
  const scene = {
    ...node.params,
    dimension: node.kind === "scene3d" ? 3 : 2,
  } as SceneData;
  const controlled = (id: string) =>
    project.edges.some((e) => e.target === id && e.targetHandle === "position");
  const sensors = project.nodes
    .filter(
      (n) =>
        getDefinition(n.kind, project.tools)?.category === "Sensors" &&
        project.edges.some(
          (e) =>
            e.source === node.id &&
            e.target === n.id &&
            e.targetHandle === "scene",
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
    });
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
      setError("Maximum 40 scene objects");
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
              ? "Wave source"
              : shape === "box"
                ? "Box"
                : "Sphere",
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
      if (scene.objects.length >= 40) throw Error("Maximum 40 objects");
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
        aria-label="Scene editor"
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
                : "Space, objects and sensors"}
            </p>
          </div>
          <div className="segmented">
            <button
              className={mode === "2d" ? "active" : ""}
              onClick={() => setMode("2d")}
            >
              2D plan
            </button>
            <button
              className={mode === "3d" ? "active" : ""}
              onClick={() => setMode("3d")}
            >
              3D view
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Close scene editor"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="scene-toolbar">
          <button onClick={() => add("box")}>
            <Plus size={14} />
            Box
          </button>
          <button onClick={() => add("sphere")}>
            <Plus size={14} />
            Sphere
          </button>
          <button onClick={() => add("source")}>
            <Sun size={14} />
            Wave source
          </button>
          <button onClick={() => file.current?.click()}>
            <Upload size={14} />
            Import OBJ
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
            aria-label="Sensor to add"
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
            {ka ? "სენსორის დამატება" : "Add sensor"}
          </button>
        </div>
        <div className="scene-body">
          <div className="scene-viewport">
            {mode === "3d" ? (
              <View3D
                scene={scene}
                sensors={sensors}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <View2D
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
                      "Position is driven by a Vector 3 node. Edit that node to move this sensor.",
                    );
                }}
              />
            )}
            <div className="scene-viewport-note">
              <MousePointer2 size={13} />
              {mode === "3d"
                ? "Drag to orbit · scroll to zoom · click to select"
                : "Drag objects or sensors · coordinates in meters"}
            </div>
          </div>
          <aside className="scene-properties">
            <h4>
              <Layers size={14} />
              {ka ? "სცენის ობიექტები" : "SCENE HIERARCHY"}
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
                <small>{o.shape}</small>
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
                <small>sensor</small>
              </button>
            ))}
            {object || sensor ? (
              <div className="transform-panel">
                <h4>
                  <Move3D size={14} />
                  {ka ? "ტრანსფორმაცია" : "TRANSFORM"}
                </h4>
                <label>
                  Name
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
                    Position {k.toUpperCase()} · m
                    <input
                      aria-label={"Object position " + k.toUpperCase()}
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
                        Size {k.toUpperCase()}
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
                      Rotation Y · °
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
                      Color
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
                      Remove object
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
                    Sensor parameters →
                  </button>
                )}
              </div>
            ) : (
              <p className="muted scene-select-help">
                Select an object or sensor to edit its position and properties.
              </p>
            )}
          </aside>
        </div>
        <footer>
          <Info size={14} />
          {error ||
            "Analytical sensor fields · imported geometry is visual only · OBJ meshes are normalized on import."}
        </footer>
      </section>
    </div>
  );
}
