import { runAtTime } from "./core/playback-view";
import { PlaybackTransport } from "./PlaybackTransport";
import "./flow-monitor.css";
import { usePlayback } from "./usePlayback";
import { playbackLabel } from "./core/playback-clock";
import { L, message } from "./core/ka";
import { useLang } from "./i18n";
import {
  lazy,
  Suspense,
  useState,
  useRef,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import {
  ReactFlow,
  applyNodeChanges,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  type ReactFlowInstance,
  type NodeChange,
  type EdgeChange,
  type Connection,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Hexagon,
  ChevronDown,
  ChevronRight,
  Search,
  Plus,
  Play,
  Square,
  Save,
  Download,
  Upload,
  Undo2,
  Redo2,
  X,
  Settings2,
  Workflow,
  LayoutGrid,
  Box,
  PanelRightClose,
  PanelLeftClose,
  Activity,
  Check,
  CheckCircle2,
  AlertCircle,
  Info,
  ArrowUpRight,
  Trash2,
  Copy,
  FilePlus2,
  Layers,
  Clock3,
  Keyboard,
  Bookmark,
  BookOpen,
  Star,
  Filter,
  Grip,
  ChevronUp,
  Radio,
  SlidersHorizontal,
  Link2,
  Code2,
  FlaskConical,
} from "lucide-react";
import { BindingDialog } from "./study/components/BindingDialog";
import {
  categories,
  typeColors,
  blankProject,
  signature,
  type Project,
  type LabNode,
  type Run,
  type Packet,
  type Wire,
  type Field,
} from "./core/types";
import {
  definitions,
  getDefinition,
  defaultParams,
  nodeDefinition,
  pruneSceneConnections,
} from "./core/registry";
import {
  makeNode,
  exampleProject,
  parseProject,
  connectionError,
  inputPacket,
  outputTypes,
} from "./core/runtime";
import { compileExpression, formulaFunctions } from "./core/expression";
import { FlowContext, nodeTypes, NodeIcon, type FlowNode } from "./NodeCard";
import {
  reconcileCanvasNodes,
  retainExecutionProject,
} from "./core/canvas-state";
import { SignalPlot, PacketView, PlotClock } from "./Plots";
import { tunnelProject } from "./core/tunnel-demo";
import { autoLayoutProject } from "./core/auto-layout";
const FlowMonitor = lazy(() =>
  import("./FlowMonitor").then((m) => ({ default: m.FlowMonitor })),
);
const SceneDock = lazy(() =>
  import("./SceneDock").then((m) => ({ default: m.SceneDock })),
);
const SceneEditor = lazy(() =>
  import("./SceneEditor").then((m) => ({ default: m.SceneEditor })),
);
import "./workspace.css";
const STORAGE = "lattice-studio-v3";
const getSaved = () => {
  try {
    return parseProject(
      localStorage.getItem(STORAGE) ||
        localStorage.getItem("lattice-studio-v2") ||
        "",
    );
  } catch {
    return blankProject();
  }
};
function download(name: string, content: string, type = "application/json") {
  const u = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function exportPacket(packet: Packet, name: string) {
  if (packet.type === "signal")
    download(
      name + ".csv",
      "time_s,value_" +
        packet.value.unit +
        "\n" +
        packet.value.times
          .map((t, i) => t + "," + packet.value.values[i])
          .join("\n"),
      "text/csv",
    );
  else if (packet.type === "table") {
    const q = (v: unknown) => '"' + String(v).replaceAll('"', '""') + '"';
    download(
      name + ".csv",
      packet.value.columns.map(q).join(",") +
        "\n" +
        packet.value.rows.map((r) => r.map(q).join(",")).join("\n"),
      "text/csv",
    );
  } else download(name + ".json", JSON.stringify(packet, null, 2));
}
export interface WorkspaceProps {
  initialProject?: Project;
  studyId?: string;
  hideHeaderBrand?: boolean;
}

export default function Workspace({
  initialProject,
  studyId,
  hideHeaderBrand = false,
}: WorkspaceProps = {}) {
  const ka = useLang() === "ka";
  const [project, setProject] = useState<Project>(() => initialProject || getSaved()),
    [selected, setSelected] = useState("sensor"),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("All"),
    [favorites, setFavorites] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem("lattice-favorites") || "[]");
      } catch {
        return [];
      }
    }),
    [favoriteOnly, setFavoriteOnly] = useState(false),
    [leftOpen, setLeftOpen] = useState(() => innerWidth > 900),
    [rightOpen, setRightOpen] = useState(() => innerWidth > 1150),
    [run, setRun] = useState<Run | null>(null),
    [running, setRunning] = useState(false),
    [bottom, setBottom] = useState<"none" | "results" | "execution" | "types">(
      "none",
    ),
    [sceneId, setSceneId] = useState(""),
    [simulation, setSimulation] = useState(false),
    [scenesOpen, setScenesOpen] = useState(true),
    [menu, setMenu] = useState(false),
    [notice, setNotice] = useState(""),
    [history, setHistory] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]),
    [saved, setSaved] = useState(() => localStorage.getItem(STORAGE) || ""),
    [settings, setSettings] = useState(false),
    [guide, setGuide] = useState(false),
    [cursor, setCursor] = useState(1),
    [outputId, setOutputId] = useState("scope"),
    [showStudyBinding, setShowStudyBinding] = useState(false);

  useEffect(() => {
    if (initialProject) {
      setProject(initialProject);
    }
  }, [initialProject]);

  const activeStudyId =
    studyId ||
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.hash.split("?")[1] || "").get(
          "studyId",
        ) || undefined
      : undefined);
  const [canvasNodes, setCanvasNodes] = useState<FlowNode[]>(() =>
    reconcileCanvasNodes([], (initialProject || getSaved()).nodes, selected),
  );
  useEffect(() => {
    setCanvasNodes((previous) =>
      reconcileCanvasNodes(previous, project.nodes, selected),
    );
  }, [project.nodes, selected]);
  const executionProjectRef = useRef(project);
  executionProjectRef.current = retainExecutionProject(
    executionProjectRef.current,
    project,
  );
  const executionProject = executionProjectRef.current;
  const graphRef = useRef(project);
  graphRef.current = project;
  const historyRef = useRef<Project | null>(null),
    flow = useRef<ReactFlowInstance<FlowNode> | null>(null),
    worker = useRef<Worker | null>(null),
    file = useRef<HTMLInputElement>(null),
    csvFile = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null);
  const t = (a: string, b: string) => (ka ? a : b);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        !simulation && flow.current?.fitView({ padding: 0.17, duration: 200 }),
      100,
    );
    return () => clearTimeout(timer);
  }, [leftOpen, rightOpen, bottom]);
  const semantic = useMemo(
      () => signature(executionProject),
      [executionProject],
    ),
    fresh = run?.signature === semantic ? run : null,
    dirty = JSON.stringify(project) !== saved;
  const playback = usePlayback(project.duration, semantic);
  const visibleRun = useMemo(
    () => runAtTime(executionProject, fresh, playback.time),
    [executionProject, fresh, playback.time],
  );
  const current = project.nodes.find((n) => n.id === selected),
    definition = current && nodeDefinition(current, project),
    sceneNode = project.nodes.find((n) => n.id === sceneId);
  const commit = useCallback((next: Project) => {
    const before = graphRef.current;
    setHistory((h) => [...h.slice(-49), before]);
    setFuture([]);
    setProject(pruneSceneConnections(next));
  }, []);
  const startEdit = () => (historyRef.current = graphRef.current);
  const endEdit = () => {
    const before = historyRef.current;
    historyRef.current = null;
    if (before && JSON.stringify(before) !== JSON.stringify(graphRef.current)) {
      setHistory((h) => [...h.slice(-49), before]);
      setFuture([]);
    }
  };
  const handleAutoLayout = useCallback(() => {
    if (!project.nodes.length) return;
    const aligned = autoLayoutProject(project);
    commit(aligned);
    setNotice(t("ფლოუ გასწორდა", "Workflow nodes aligned"));
    setTimeout(() => {
      flow.current?.fitView({ padding: 0.18, duration: 400 });
    }, 50);
  }, [project, commit, t]);
  const patch = (
    id: string,
    params: Record<string, unknown>,
    record = true,
  ) => {
    const next = {
      ...graphRef.current,
      nodes: graphRef.current.nodes.map((n) =>
        n.id === id ? { ...n, params: { ...n.params, ...params } } : n,
      ),
    };
    record ? commit(next) : setProject(next);
  };
  const undo = () => {
    if (!history.length) return;
    setFuture((f) => [graphRef.current, ...f]);
    setProject(history.at(-1)!);
    setHistory((h) => h.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setHistory((h) => [...h, graphRef.current]);
    setProject(future[0]);
    setFuture((f) => f.slice(1));
  };
  const choose = (id: string) => {
    setSelected(id);
    setRightOpen(true);
  };
  const add = (kind: string, position?: { x: number; y: number }) => {
    if (project.nodes.length >= 100) {
      setNotice("მაქსიმუმ 100 ნოუდი ერთ ფლოუში");
      return;
    }
    const center = flow.current?.screenToFlowPosition({
      x: innerWidth * 0.48,
      y: innerHeight * 0.43,
    }) || { x: 300, y: 150 };
    const node = makeNode(
      kind,
      position?.x ?? center.x,
      position?.y ?? center.y,
      project.tools,
    );
    commit({ ...project, nodes: [...project.nodes, node] });
    choose(node.id);
    if (innerWidth < 1000) setLeftOpen(false);
  };
  const remove = (ids: string[]) => {
    commit({
      ...project,
      nodes: project.nodes.filter((n) => !ids.includes(n.id)),
      edges: project.edges.filter(
        (e) => !ids.includes(e.source) && !ids.includes(e.target),
      ),
    });
    setSelected("");
  };
  const duplicate = () => {
    if (!current || project.nodes.length >= 100) return;
    const node = {
      ...structuredClone(current),
      id: crypto.randomUUID(),
      label: current.label + " copy",
      position: { x: current.position.x + 45, y: current.position.y + 70 },
    };
    commit({ ...project, nodes: [...project.nodes, node] });
    choose(node.id);
  };
  const connect = (c: Connection) => {
    if (!c.sourceHandle || !c.targetHandle) return;
    const wire = {
      id: crypto.randomUUID(),
      source: c.source,
      sourceHandle: c.sourceHandle,
      target: c.target,
      targetHandle: c.targetHandle,
    };
    const error = connectionError(graphRef.current, wire);
    if (error) {
      setNotice(error);
      return;
    }
    commit({ ...graphRef.current, edges: [...graphRef.current.edges, wire] });
  };
  const setInput = (port: string, value: string) => {
    const multiple = definition?.inputs.find((p) => p.id === port)?.multiple;
    const [source, sourceHandle] = value.split("|");
    const existing = project.edges.find(
      (e) =>
        e.target === selected &&
        e.targetHandle === port &&
        e.source === source &&
        e.sourceHandle === sourceHandle,
    );
    const next = {
      ...project,
      edges: project.edges.filter((e) =>
        multiple
          ? e !== existing
          : !(e.target === selected && e.targetHandle === port),
      ),
    };
    if (value && (!multiple || !existing)) {
      const wire = {
        id: crypto.randomUUID(),
        source,
        sourceHandle,
        target: selected,
        targetHandle: port,
      };
      const err = connectionError(next, wire);
      if (err) {
        setNotice(err);
        return;
      }
      next.edges.push(wire);
    }
    commit(next);
  };
  const computeFlow = (forPlayback = false) => {
    if (running) {
      worker.current?.terminate();
      worker.current = null;
      setRunning(false);
      setNotice(t("შესრულება შეჩერებულია", "Execution stopped"));
      return;
    }
    try {
      const snapshot = parseProject(JSON.stringify(graphRef.current));
      if (!snapshot.nodes.length) {
        playback.prepared(false);
        setNotice(t("ჯერ დაამატეთ ნოუდი", "Add a node to start"));
        return;
      }
      setRunning(true);
      if (!forPlayback) setBottom("execution");
      worker.current?.terminate();
      const w = new Worker(
        new URL("./core/runner.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      w.onmessage = (e) => {
        setRunning(false);
        w.terminate();
        worker.current = null;
        if (
          signature(graphRef.current) !== e.data.run?.signature &&
          !e.data.error
        )
          return;
        if (e.data.error) {
          playback.prepared(false);
          setNotice(e.data.error);
        } else {
          setRun(e.data.run);
          setCursor(forPlayback ? 0 : 1);
          const errors = Object.values(
            e.data.run.results as Run["results"],
          ).filter((r) => r.status !== "ok").length;
          if (forPlayback) playback.prepared(errors === 0);
          setNotice(
            errors
              ? t(
                  "შესრულება დასრულდა — შეამოწმეთ " + errors + " ნოუდი",
                  "Run finished — " + errors + " nodes need attention",
                )
              : forPlayback
                ? ""
                : "მონაცემები გამოთვლილია",
          );
          if (!forPlayback || errors)
            setBottom(errors ? "execution" : "results");
        }
      };
      w.onerror = () => {
        setRunning(false);
        w.terminate();
        playback.prepared(false);
        setNotice("Execution failed. Check the workflow and try again.");
      };
      w.postMessage(snapshot);
    } catch (e) {
      playback.prepared(false);
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };
  const startPlayback = () => {
    setNotice("");
    setBottom("none");
    playback.play(Boolean(fresh));
    if (!fresh && !running) computeFlow(true);
  };
  const runFlow = () => {
    if (running || playback.playing || playback.phase === "preparing") {
      worker.current?.terminate();
      worker.current = null;
      setRunning(false);
      playback.pause();
      return;
    }
    startPlayback();
  };
  useEffect(() => () => worker.current?.terminate(), []);
  const save = () => {
    try {
      const raw = JSON.stringify(project);
      parseProject(raw);
      localStorage.setItem(STORAGE, raw);
      setSaved(raw);
      setNotice(t("შენახულია ამ ბრაუზერში", "Saved in this browser"));
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Browser storage is full. Export the JSON project.",
      );
    }
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName,
        editing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setLeftOpen(true);
        setTimeout(() => searchInput.current?.focus(), 50);
      } else if (
        !editing &&
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (!editing && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runFlow();
      } else if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        handleAutoLayout();
      } else if (e.key === "Escape") {
        setSceneId("");
        setGuide(false);
        setSettings(false);
        setMenu(false);
      }
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  });
  const edges = useMemo(
    () =>
      executionProject.edges.map((e) => {
        const types = outputTypes(executionProject, e.source, e.sourceHandle),
          color = typeColors[types[0]] || "#90a59f";
        return {
          ...e,
          type: "smoothstep",
          style: { stroke: color, strokeWidth: 1.5 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 12,
            height: 12,
          },
          animated: running,
        };
      }),
    [executionProject, running],
  );
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    setCanvasNodes((previous) => applyNodeChanges(changes, previous));
    const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
    if (removed.length) {
      remove(removed);
      return;
    }
    const positions = changes.filter((c) => c.type === "position");
    if (positions.length)
      setProject((p) => ({
        ...p,
        nodes: p.nodes.map((n) => {
          const c = positions.find((c) => c.id === n.id);
          return c?.position ? { ...n, position: c.position } : n;
        }),
      }));
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const ids = changes.filter((c) => c.type === "remove").map((c) => c.id);
    if (ids.length)
      commit({
        ...graphRef.current,
        edges: graphRef.current.edges.filter((e) => !ids.includes(e.id)),
      });
  };
  const catalog = [
    ...definitions,
    ...project.tools.map((tool) => getDefinition(tool.id, project.tools)!),
  ];
  const filtered = catalog.filter(
    (d) =>
      (category === "All" || d.category === category) &&
      (!favoriteOnly || favorites.includes(d.id)) &&
      (d.title + " " + d.description + " " + d.category)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const toggleFavorite = (id: string) => {
    const value = favorites.includes(id)
      ? favorites.filter((x) => x !== id)
      : [...favorites, id];
    setFavorites(value);
    try {
      localStorage.setItem("lattice-favorites", JSON.stringify(value));
    } catch {}
  };
  const newTemplate = (template: string) => {
    commit(
      template === "blank"
        ? blankProject()
        : template === "tunnel"
          ? tunnelProject()
          : exampleProject(template),
    );
    setSimulation(false);
    setSelected("");
    setRun(null);
    setMenu(false);
    setBottom("none");
    setTimeout(
      () => flow.current?.fitView({ padding: 0.2, duration: 300 }),
      100,
    );
  };
  const inputFile = async (f: File) => {
    try {
      if (f.size > 5e6) throw Error("პროექტის მაქსიმალური ზომაა 5 MB");
      const data = parseProject(await f.text());
      commit(data);
      setSelected("");
      setRun(null);
      setNotice("Workflow imported");
      setTimeout(() => flow.current?.fitView({ padding: 0.2 }), 100);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };
  const outNode =
    project.nodes.find((n) => n.id === outputId) ||
    project.nodes.find(
      (n) => getDefinition(n.kind, project.tools)?.category === "Outputs",
    ) ||
    current;
  const outDef = outNode && nodeDefinition(outNode, project);
  const packets = outNode
    ? outDef?.outputs.length
      ? Object.entries(visibleRun?.results[outNode.id]?.outputs || {})
      : outDef!.inputs
          .map(
            (p) =>
              [
                p.label,
                inputPacket(project, visibleRun, outNode.id, p.id),
              ] as const,
          )
          .filter(([, p]) => p)
    : [];
  const errorCount = fresh
    ? Object.values(fresh.results).filter((r) => r.status !== "ok").length
    : 0;
  const renderField = (f: Field) => {
    if (!current) return null;
    const val = current.params[f.key];
    const change = (value: unknown) =>
      patch(current.id, { [f.key]: value }, false);
    let error = "";
    if (f.kind === "expression")
      try {
        compileExpression(String(val));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    return (
      <label key={f.key} className={"field field-" + f.kind}>
        <span>
          {f.label}
          {f.unit && <small>{L(f.unit ?? "")}</small>}
        </span>
        {f.kind === "number" ? (
          <input
            aria-label={f.label}
            disabled={
              definition?.category === "Sensors" &&
              ["x", "y", "z"].includes(f.key) &&
              project.edges.some(
                (e) => e.target === selected && e.targetHandle === "position",
              )
            }
            type="number"
            min={f.min}
            max={f.max}
            step={f.step || "any"}
            value={Number(val)}
            onFocus={startEdit}
            onBlur={endEdit}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (
                Number.isFinite(v) &&
                v >= (f.min ?? -Infinity) &&
                v <= (f.max ?? Infinity)
              )
                change(v);
            }}
          />
        ) : f.kind === "select" ? (
          <select
            aria-label={f.label}
            value={String(val)}
            onChange={(e) => patch(current.id, { [f.key]: e.target.value })}
          >
            {f.options?.map((o) => (
              <option key={o} value={o}>
                {L(o)}
              </option>
            ))}
          </select>
        ) : f.kind === "expression" || f.kind === "csv" ? (
          <>
            <textarea
              aria-label={f.label}
              value={String(val)}
              spellCheck={false}
              rows={f.kind === "csv" ? 6 : 3}
              onFocus={startEdit}
              onBlur={endEdit}
              onChange={(e) =>
                change(e.target.value.slice(0, f.kind === "csv" ? 500000 : 500))
              }
            />
            {f.kind === "csv" && (
              <button
                type="button"
                className="secondary"
                onClick={() => csvFile.current?.click()}
              >
                <Upload size={13} />
                CSV ფაილის არჩევა
              </button>
            )}
            {f.kind === "expression" && (
              <>
                <small className={error ? "field-error" : "field-ok"}>
                  {error || "სწორი გამოსახულება · a, b, t, pi, e"}
                </small>
                <details>
                  <summary>ფუნქციები და სინტაქსი</summary>
                  <p>
                    {formulaFunctions.join(", ")}
                    <br />+ − * / ^ % · შედარება · && || !<br />
                    მაგალითი: if(a &gt; 0, sqrt(a), 0)
                  </p>
                </details>
              </>
            )}
          </>
        ) : (
          <input
            aria-label={f.label}
            value={String(val)}
            onFocus={startEdit}
            onBlur={endEdit}
            onChange={(e) => change(e.target.value.slice(0, 1000))}
          />
        )}
      </label>
    );
  };
  const openResults = useCallback((id: string) => {
    setOutputId(id);
    setBottom("results");
  }, []);
  const nodeRuntime = useMemo(
    () => ({
      project: executionProject,
      run: visibleRun,
      running: running || playback.playing,
      openScene: setSceneId,
      openResults,
    }),
    [executionProject, visibleRun, running, playback.playing, openResults],
  );
  return (
    <PlotClock.Provider
      value={{ time: playback.time, duration: project.duration }}
    >
      <FlowContext.Provider value={nodeRuntime}>
        <div className="studio">
          {hideHeaderBrand ? (
            <header className="studio-header" style={{ height: 42, padding: "0 14px", background: "#f8fafc" }}>
              <div className="project-heading" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="project-path" style={{ color: "#2563eb", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <FlaskConical size={14} color="#2563eb" />
                  <span>{t("კვლევის 3D ფლოუ მოდელი", "Study 3D Flow Simulation")}</span>
                </span>
                <input
                  aria-label="ფლოუს სახელი"
                  value={project.name}
                  onFocus={startEdit}
                  onBlur={endEdit}
                  onChange={(e) =>
                    setProject({
                      ...project,
                      name: e.target.value.slice(0, 100),
                    })
                  }
                  style={{ height: 26, fontSize: 12, width: 220 }}
                />
              </div>
              <div className="header-actions">
                <button
                  className="icon-button undo-header"
                  aria-label="უკან დაბრუნება"
                  disabled={!history.length}
                  onClick={undo}
                >
                  <Undo2 size={15} />
                </button>
                <button
                  className="icon-button undo-header"
                  aria-label="გამეორება"
                  disabled={!future.length}
                  onClick={redo}
                >
                  <Redo2 size={15} />
                </button>
                <button
                  className="icon-button undo-header"
                  aria-label={t("ავტომატური განლაგება", "Auto Align Nodes")}
                  title={t("ავტომატური განლაგება (Ctrl+L)", "Auto Align Nodes (Ctrl+L)")}
                  disabled={!project.nodes.length}
                  onClick={handleAutoLayout}
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  className="save-button"
                  style={{ background: "#2563eb", height: 28, fontSize: 11, padding: "0 12px" }}
                  onClick={() => setShowStudyBinding(true)}
                  title={t("მოდელის ვერსიის შენახვა", "Save Model Version")}
                >
                  <Save size={13} />
                  <span>{t("მოდელის ვერსიის შენახვა", "Save Model Version")}</span>
                </button>
                <button
                  className={
                    "run-button " + (running || playback.playing ? "stop" : "")
                  }
                  style={{ height: 28, fontSize: 11, padding: "0 12px" }}
                  onClick={runFlow}
                >
                  {running || playback.playing ? (
                    <Square size={13} fill="currentColor" />
                  ) : (
                    <Play size={13} fill="currentColor" />
                  )}
                  {running ? "მზადდება…" : playback.playing ? "პაუზა" : t("3D სიმულაციის გაშვება", "Run 3D Sim")}
                </button>
              </div>
            </header>
          ) : (
            <header className="studio-header">
              <a
                className="brand"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  flow.current?.fitView({ duration: 300, padding: 0.2 });
                }}
              >
                <span>
                  <Hexagon size={25} />
                  <i />
                </span>
                lattice<small>სტუდია</small>
              </a>
              <div className="header-divider" />
              <div className="project-heading">
                <span className="project-path">
                  {t("ჩემი სამუშაო სივრცე", "Personal workspace")}
                  <ChevronRight size={11} />
                  <span>ფლოუები</span>
                </span>
                <div>
                  <input
                    aria-label="ფლოუს სახელი"
                    value={project.name}
                    onFocus={startEdit}
                    onBlur={endEdit}
                    onChange={(e) =>
                      setProject({
                        ...project,
                        name: e.target.value.slice(0, 100),
                      })
                    }
                  />
                  <button
                    aria-label="ფლოუს მენიუ"
                    className="icon-button"
                    onClick={() => setMenu(!menu)}
                  >
                    <ChevronDown size={15} />
                  </button>
                  <span className={"saved-state " + (dirty ? "dirty" : "")}>
                    <i />
                    {dirty ? t("შეუნახავი", "Unsaved") : t("შენახული", "Saved")}
                  </span>
                </div>
              </div>
              <div className="header-actions">
                <button
                  className="icon-button undo-header"
                  aria-label="უკან დაბრუნება"
                  disabled={!history.length}
                  onClick={undo}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  className="icon-button undo-header"
                  aria-label="გამეორება"
                  disabled={!future.length}
                  onClick={redo}
                >
                  <Redo2 size={17} />
                </button>
                <button
                  className="icon-button undo-header"
                  aria-label={t("ავტომატური განლაგება", "Auto Align Nodes")}
                  title={t("ავტომატური განლაგება (Ctrl+L)", "Auto Align Nodes (Ctrl+L)")}
                  disabled={!project.nodes.length}
                  onClick={handleAutoLayout}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  className="save-button"
                  aria-label={t("შენახვა", "Save")}
                  onClick={save}
                >
                  <Save size={15} />
                  <span>{t("შენახვა", "Save")}</span>
                </button>
                <button
                  className={
                    "run-button " + (running || playback.playing ? "stop" : "")
                  }
                  aria-label={
                    running || playback.playing
                      ? "სიმულაციის შეჩერება"
                      : "სიმულაციის დაკვრა"
                  }
                  onClick={runFlow}
                >
                  {running || playback.playing ? (
                    <Square size={14} fill="currentColor" />
                  ) : (
                    <Play size={14} fill="currentColor" />
                  )}
                  {running ? "მზადდება…" : playback.playing ? "პაუზა" : "დაკვრა"}
                  <kbd>⌘ ↵</kbd>
                </button>
              </div>
            </header>
          )}
          {menu && (
            <>
              <div className="menu-backdrop" onClick={() => setMenu(false)} />
              <div className="project-menu">
                <span>ფლოუ</span>
                <button onClick={() => newTemplate("blank")}>
                  <FilePlus2 size={15} />
                  {t("ახალი ცარიელი ფლოუ", "New blank workflow")}
                </button>
                <button
                  onClick={() => {
                    file.current?.click();
                    setMenu(false);
                  }}
                >
                  <Upload size={15} />
                  {t("JSON-ის იმპორტი", "Import workflow JSON")}
                </button>
                <button
                  onClick={() => {
                    download(
                      project.name + ".json",
                      JSON.stringify(project, null, 2),
                    );
                    setMenu(false);
                  }}
                >
                  <Download size={15} />
                  {t("JSON-ის ექსპორტი", "Export workflow JSON")}
                </button>
                <button
                  onClick={() => {
                    handleAutoLayout();
                    setMenu(false);
                  }}
                  disabled={!project.nodes.length}
                >
                  <LayoutGrid size={15} />
                  {t("ნოუდების გასწორება", "Auto Align Nodes")}
                  <kbd style={{ marginLeft: "auto", fontSize: 10, opacity: 0.7 }}>Ctrl+L</kbd>
                </button>
                <hr />
                <span>დაიწყეთ შაბლონიდან</span>
                <button onClick={() => newTemplate("scene-events")}>
                  <Layers size={15} />
                  სცენის მოვლენები · ა/ბ შედარება
                </button>
                <button onClick={() => newTemplate("sensor")}>
                  <Radio size={15} />
                  სენსორი → სცენა → ფორმულა
                </button>
                <button onClick={() => newTemplate("data")}>
                  <Layers size={15} />
                  CSV → გარდაქმნა → ანალიზი
                </button>
                <button onClick={() => newTemplate("events")}>
                  <Clock3 size={15} />
                  მოვლენები → სიგნალის მართვა
                </button>
                <button onClick={() => newTemplate("tunnel")}>
                  <Box size={15} />
                  გვირაბი · მაგალითის ფლოუ
                </button>
                <small>ფლოუს ჩანაცვლების გაუქმება შესაძლებელია.</small>
              </div>
            </>
          )}
          <input
            ref={file}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void inputFile(f);
              e.target.value = "";
            }}
          />
          <input
            ref={csvFile}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0],
                id = selected;
              e.target.value = "";
              if (!f) return;
              if (f.size > 500000) {
                setNotice("CSV limit: 500 KB");
                return;
              }
              patch(id, { csv: await f.text() });
            }}
          />
          <div className="studio-body">
            {leftOpen && (
              <aside className="catalog-panel">
                <div className="panel-heading">
                  <div>
                    <h2>{t("ნოუდების კატალოგი", "Node library")}</h2>
                    <p>
                      {t(
                        "ააწყვეთ იდეა, კავშირით.",
                        "Build an idea. One connection at a time.",
                      )}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="კატალოგის დახურვა"
                    onClick={() => setLeftOpen(false)}
                  >
                    <PanelLeftClose size={17} />
                  </button>
                </div>
                <div className="catalog-search">
                  <Search size={15} />
                  <input
                    ref={searchInput}
                    aria-label="ნოუდის ძებნა"
                    placeholder={t("მოძებნეთ ნოუდი…", "Search nodes…")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>⌘ K</kbd>
                </div>
                <div className="library-tabs">
                  <button
                    className={!favoriteOnly ? "active" : ""}
                    onClick={() => setFavoriteOnly(false)}
                  >
                    {t("ყველა ნოუდი", "All nodes")}
                    <span>{catalog.length}</span>
                  </button>
                  <button
                    className={favoriteOnly ? "active" : ""}
                    onClick={() => setFavoriteOnly(true)}
                  >
                    <Star size={12} />
                    {t("რჩეული", "Favorites")}
                  </button>
                </div>
                <label className="category-select">
                  <Filter size={12} />
                  <select
                    aria-label="ნოუდის კატეგორია"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="All">
                      {t("ყველა კატეგორია", "All categories")}
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {ka ? c.ka : c.id}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="catalog-list">
                  {categories.map((c) => {
                    const nodes = filtered.filter((d) => d.category === c.id);
                    return nodes.length ? (
                      <section key={c.id}>
                        <h3>
                          <i style={{ background: c.color }} />
                          {ka ? c.ka : c.id}
                          <span>{nodes.length}</span>
                        </h3>
                        {nodes.map((d) => (
                          <div className="catalog-item" key={d.id}>
                            <button
                              className="catalog-add"
                              draggable
                              onDragStart={(e) =>
                                e.dataTransfer.setData(
                                  "application/lattice-node",
                                  d.id,
                                )
                              }
                              onClick={() => add(d.id)}
                            >
                              <span
                                className="catalog-icon"
                                style={{
                                  color: c.color,
                                  background: c.color + "12",
                                }}
                              >
                                <NodeIcon name={d.icon} />
                              </span>
                              <span>
                                <b>{d.title}</b>
                                <small>{d.description}</small>
                              </span>
                              <Plus size={12} />
                            </button>
                            <button
                              className={
                                "favorite " +
                                (favorites.includes(d.id) ? "active" : "")
                              }
                              aria-label={"რჩეული: " + d.title}
                              onClick={() => toggleFavorite(d.id)}
                            >
                              <Star
                                size={11}
                                fill={
                                  favorites.includes(d.id)
                                    ? "currentColor"
                                    : "none"
                                }
                              />
                            </button>
                          </div>
                        ))}
                      </section>
                    ) : null;
                  })}
                  {!filtered.length && (
                    <div className="catalog-empty">
                      <Search size={24} />
                      <p>{t("ნოუდი ვერ მოიძებნა", "No matching nodes")}</p>
                      <button
                        onClick={() => {
                          setSearch("");
                          setCategory("All");
                          setFavoriteOnly(false);
                        }}
                      >
                        ფილტრების გასუფთავება
                      </button>
                    </div>
                  )}
                </div>
                <footer className="library-footer">
                  <Grip size={14} />
                  <span>
                    {t(
                      "გადმოათრიეთ კანვასზე ან დააჭირეთ",
                      "Drag onto the canvas or click to add",
                    )}
                  </span>
                </footer>
              </aside>
            )}
            <section className="workspace-center">
              <div className="canvas-toolbar">
                <div>
                  {!leftOpen && (
                    <button
                      aria-label="კატალოგის გახსნა"
                      onClick={() => setLeftOpen(true)}
                    >
                      <Plus size={15} />
                      {t("კატალოგი", "Library")}
                    </button>
                  )}
                  <button
                    className={"canvas-tab " + (!simulation ? "active" : "")}
                    onClick={() => setSimulation(false)}
                  >
                    <Workflow size={15} />
                    {t("ფლოუს რედაქტორი", "Workflow editor")}
                  </button>
                  <button
                    className={"canvas-tab " + (simulation ? "active" : "")}
                    onClick={() => {
                      setSimulation(true);
                      setLeftOpen(false);
                      setBottom("none");
                    }}
                  >
                    <Play size={14} />
                  </button>
                  <button
                    className="canvas-tab"
                    onClick={() => setShowStudyBinding(true)}
                    title={t(
                      "ფლოუს კვლევასთან დაკავშირება (Model Version)",
                      "Link Flow to Study (Model Version)",
                    )}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: activeStudyId ? "rgba(37, 99, 235, 0.1)" : undefined,
                      borderColor: activeStudyId ? "#2563eb" : undefined,
                    }}
                  >
                    <FlaskConical size={14} color={activeStudyId ? "#2563eb" : undefined} />
                    <span>{t("კვლევასთან მიბმა", "Link to Study")}</span>
                  </button>
                  <span className="workflow-version">v3</span>
                </div>
                <div>
                  <span className="canvas-count">
                    {project.nodes.length} {t("ნოუდი", "nodes")}
                    <i />
                    {project.edges.length} {t("კავშირი", "connections")}
                  </span>
                  <button
                    aria-label="სცენების ხედების ჩვენება"
                    title="სცენების ცოცხალი ხედები"
                    className={scenesOpen ? "active" : ""}
                    onClick={() => setScenesOpen(!scenesOpen)}
                  >
                    <Box size={16} />
                  </button>
                  <button
                    aria-label="ფლოუს პარამეტრები"
                    onClick={() => setSettings(true)}
                  >
                    <Settings2 size={15} />
                  </button>
                  <button
                    aria-label="პარამეტრების პანელი"
                    className={rightOpen ? "active" : ""}
                    onClick={() => setRightOpen(!rightOpen)}
                  >
                    <PanelRightClose size={16} />
                  </button>
                </div>
              </div>
              {simulation && (
                <Suspense
                  fallback={
                    <div className="simulation-loading">
                      მონიტორინგი იტვირთება…
                    </div>
                  }
                >
                  <FlowMonitor
                    project={executionProject}
                    run={visibleRun}
                    fullRun={fresh}
                    time={playback.time}
                    onSelect={choose}
                    onOpenScene={setSceneId}
                  />
                </Suspense>
              )}
              {!simulation && (
                <div className="flow-canvas">
                  <ReactFlow<FlowNode>
                    ariaLabelConfig={{
                      "controls.ariaLabel": "ხედის მართვა",
                      "controls.zoomIn.ariaLabel": "მიახლოება",
                      "controls.zoomOut.ariaLabel": "დაშორება",
                      "controls.fitView.ariaLabel": "ფლოუს ჩატევა",
                      "minimap.ariaLabel": "ფლოუს მინირუკა",
                      "handle.ariaLabel": "პორტი",
                    }}
                    nodes={canvasNodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onInit={(instance) => (flow.current = instance)}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeClick={(_, n) => choose(n.id)}
                    onNodeDoubleClick={(_, n) => {
                      const d = getDefinition(n.data.node.kind, project.tools);
                      if (d?.category === "Scenes") setSceneId(n.id);
                      else {
                        setOutputId(n.id);
                        setBottom("results");
                      }
                    }}
                    onPaneClick={() => setSelected("")}
                    onConnect={connect}
                    isValidConnection={(c) =>
                      !!c.sourceHandle &&
                      !!c.targetHandle &&
                      !connectionError(project, {
                        source: c.source,
                        sourceHandle: c.sourceHandle,
                        target: c.target,
                        targetHandle: c.targetHandle,
                      })
                    }
                    onNodeDragStart={(_, node) => {
                      startEdit();
                      setSelected(node.id);
                    }}
                    onNodeDragStop={endEdit}
                    fitView
                    fitViewOptions={{ padding: 0.17 }}
                    minZoom={0.2}
                    maxZoom={1.7}
                    deleteKeyCode={["Backspace", "Delete"]}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const kind = e.dataTransfer.getData(
                        "application/lattice-node",
                      );
                      if (getDefinition(kind, project.tools))
                        add(
                          kind,
                          flow.current?.screenToFlowPosition({
                            x: e.clientX,
                            y: e.clientY,
                          }),
                        );
                    }}
                  >
                    <Background color="#bdcec5" gap={20} size={1} />
                    <Controls showInteractive={false} position="bottom-left">
                      <ControlButton
                        onClick={handleAutoLayout}
                        title={t("ავტომატური განლაგება (Ctrl+L)", "Auto Align Nodes (Ctrl+L)")}
                        aria-label={t("ავტომატური განლაგება", "Auto Align Nodes")}
                      >
                        <LayoutGrid size={14} />
                      </ControlButton>
                    </Controls>
                    <MiniMap
                      nodeColor={(n) =>
                        categories.find(
                          (c) =>
                            c.id ===
                            getDefinition(
                              (n.data as { node: LabNode }).node.kind,
                              project.tools,
                            )?.category,
                        )?.color || "#888"
                      }
                      maskColor="#f3f6f1bb"
                      pannable
                      zoomable
                    />
                    <div className="canvas-hint">
                      <span>
                        <i />
                        {running
                          ? t("მიმდინარეობს შესრულება", "Executing workflow")
                          : fresh
                            ? t("გამოთვლილი შედეგები", "Computed results")
                            : t("მზადაა ასაწყობად", "Ready to build")}
                      </span>
                      <small>
                        {t(
                          "შეაერთეთ პორტები · ორმაგი კლიკი ხსნის დეტალებს",
                          "Connect matching ports · double-click a node to inspect",
                        )}
                      </small>
                      {project.nodes.length > 1 && (
                        <button
                          className="canvas-align-btn"
                          onClick={handleAutoLayout}
                          title={t("ნოუდების გასწორება (Ctrl+L)", "Auto Align Nodes (Ctrl+L)")}
                        >
                          <LayoutGrid size={12} />
                          <span>{t("ნოუდების გასწორება", "Auto Align")}</span>
                        </button>
                      )}
                    </div>
                    {!project.nodes.length && (
                      <div className="empty-canvas">
                        <span>
                          <Workflow size={33} />
                        </span>
                        <h2>
                          {t(
                            "ყველაფერი კავშირით იწყება.",
                            "Everything starts with a connection.",
                          )}
                        </h2>
                        <p>
                          {t(
                            "აირჩიეთ ნოუდი კატალოგიდან ან დაიწყეთ მზა მაგალითით.",
                            "Add a node from the library or start with a working template.",
                          )}
                        </p>
                        <button onClick={() => newTemplate("sensor")}>
                          სენსორი → სცენა → ფორმულა
                          <ArrowUpRight size={14} />
                        </button>
                      </div>
                    )}
                  </ReactFlow>
                </div>
              )}
              {!simulation &&
                scenesOpen &&
                project.nodes.some(
                  (n) => n.kind === "scene2d" || n.kind === "scene3d",
                ) && (
                  <Suspense
                    fallback={
                      <div className="scene-dock-loading">
                        სცენები იტვირთება…
                      </div>
                    }
                  >
                    <SceneDock
                      key={project.nodes
                        .filter(
                          (n) => n.kind === "scene2d" || n.kind === "scene3d",
                        )
                        .map((n) => n.id)
                        .join()}
                      project={executionProject}
                      run={fresh}
                      time={playback.time}
                      onOpen={setSceneId}
                      onSelect={choose}
                      onClose={() => setScenesOpen(false)}
                      onReady={() =>
                        flow.current?.fitView({ padding: 0.15, duration: 200 })
                      }
                    />
                  </Suspense>
                )}
              <PlaybackTransport
                playback={playback}
                duration={project.duration}
                ready={Boolean(fresh)}
                running={running}
                onPlay={startPlayback}
                onSettings={() => setSettings(true)}
              />
              <div className="bottom-tabs">
                <div>
                  <button
                    className={bottom === "results" ? "active" : ""}
                    onClick={() =>
                      setBottom(bottom === "results" ? "none" : "results")
                    }
                  >
                    <Activity size={14} />
                    {t("შედეგები", "Results")}
                    {fresh && (
                      <span>
                        {
                          project.nodes.filter(
                            (n) =>
                              getDefinition(n.kind, project.tools)?.category ===
                              "Outputs",
                          ).length
                        }
                      </span>
                    )}
                  </button>
                  <button
                    className={bottom === "execution" ? "active" : ""}
                    onClick={() =>
                      setBottom(bottom === "execution" ? "none" : "execution")
                    }
                  >
                    <CheckCircle2 size={14} />
                    {t("შესრულება", "Execution")}
                    {errorCount > 0 && (
                      <span className="error-count">{errorCount}</span>
                    )}
                  </button>
                  <button
                    className={bottom === "types" ? "active" : ""}
                    onClick={() =>
                      setBottom(bottom === "types" ? "none" : "types")
                    }
                  >
                    <Code2 size={14} />
                    {t("ტიპები", "Types")}
                  </button>
                </div>
                <span>
                  {fresh
                    ? fresh.durationMs.toFixed(1) + " მწმ"
                    : run
                      ? t("პარამეტრები შეცვლილია", "Changes need a new run")
                      : t("ჯერ არ გაშვებულა", "Not run yet")}
                </span>
                <button
                  className="icon-button"
                  aria-label="შედეგების პანელი"
                  onClick={() =>
                    setBottom(bottom === "none" ? "results" : "none")
                  }
                >
                  {bottom === "none" ? (
                    <ChevronUp size={15} />
                  ) : (
                    <ChevronDown size={15} />
                  )}
                </button>
              </div>
              {bottom !== "none" && (
                <section className="results-panel">
                  {bottom === "types" ? (
                    <div className="types-panel">
                      <h3>ტიპიზებული მონაცემები.</h3>
                      <p>
                        {t(
                          "კავშირი მოწმდება შეერთებისას და შესრულებისას. ერთეულები აშკარად მიეთითება; ავტომატური კონვერტაცია არ ხდება.",
                          "Connections are checked at edit time and runtime. Units are explicit metadata; conversions are never implicit.",
                        )}
                      </p>
                      <div>
                        {Object.entries(typeColors).map(([type, color]) => (
                          <span key={type}>
                            <i style={{ background: color }} />
                            <code>{L(type)}</code>
                          </span>
                        ))}
                      </div>
                      <small>
                        რიცხვი ვრცელდება სიგნალის ყველა ათვლაზე. სიგნალების
                        შესაერთებლად დროითი ბადეები უნდა ემთხვეოდეს. ფორმულის
                        შედეგის ტიპი მის შემავალ კავშირებს მიჰყვება.
                      </small>
                    </div>
                  ) : !fresh ? (
                    <div className="results-empty">
                      <Activity size={26} />
                      <h3>
                        {run
                          ? t(
                              "ცვლილებებს ახალი გაშვება სჭირდება",
                              "Your changes need a fresh run",
                            )
                          : t(
                              "ნახეთ თქვენი ფლოუ მოქმედებაში",
                              "See your workflow in action",
                            )}
                      </h3>
                      <p>
                        {t(
                          "გაშვებისას მონაცემები გაივლის შეერთებულ ნოუდებს.",
                          "Run to pass typed data through the connected nodes.",
                        )}
                      </p>
                      <button className="primary-soft" onClick={runFlow}>
                        <Play size={13} />
                        {t("ფლოუს გაშვება", "ფლოუს გაშვება")}
                      </button>
                    </div>
                  ) : bottom === "execution" ? (
                    <div className="execution-table">
                      <table>
                        <thead>
                          <tr>
                            <th>ნოუდი</th>
                            <th>მდგომარეობა</th>
                            <th>დეტალი</th>
                            <th>დრო</th>
                          </tr>
                        </thead>
                        <tbody>
                          {project.nodes.map((n) => {
                            const r = fresh.results[n.id];
                            return (
                              <tr key={n.id} onClick={() => choose(n.id)}>
                                <td>{n.label}</td>
                                <td>
                                  <span className={"status-chip " + r.status}>
                                    {L(r.status)}
                                  </span>
                                </td>
                                <td>{message(r.message)}</td>
                                <td>{r.ms.toFixed(2)} მწმ</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <>
                      <div className="result-toolbar">
                        <select
                          aria-label="შედეგის ნოუდი"
                          value={outNode?.id || ""}
                          onChange={(e) => setOutputId(e.target.value)}
                        >
                          {project.nodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.label}
                            </option>
                          ))}
                        </select>
                        <span className="result-caption">
                          გაშვება {fresh.id.slice(0, 6)} ·{" "}
                          {new Date(fresh.at).toLocaleTimeString()}
                        </span>
                        <button
                          onClick={() =>
                            download(
                              "lattice-run.json",
                              JSON.stringify(
                                {
                                  project,
                                  time: playback.time,
                                  run: visibleRun,
                                },
                                null,
                                2,
                              ),
                            )
                          }
                        >
                          <Download size={13} />
                          შედეგის JSON
                        </button>
                      </div>
                      <div className="result-content">
                        {outDef?.id === "scope" ? (
                          (() => {
                            const a = inputPacket(
                                project,
                                visibleRun,
                                outNode!.id,
                                "ch1",
                              ),
                              b = inputPacket(
                                project,
                                visibleRun,
                                outNode!.id,
                                "ch2",
                              );
                            return (
                              <>
                                <div className="result-legend">
                                  <span>
                                    <i />
                                    არხი 1 ·{" "}
                                    {a?.type === "signal"
                                      ? a.value.name + " · " + a.value.unit
                                      : "არ არის დაკავშირებული"}
                                  </span>
                                  <span>
                                    <i />
                                    არხი 2 ·{" "}
                                    {b?.type === "signal"
                                      ? b.value.name + " · " + b.value.unit
                                      : "არ არის დაკავშირებული"}
                                  </span>
                                  {[a, b].map(
                                    (p, i) =>
                                      p && (
                                        <button
                                          key={i}
                                          onClick={() =>
                                            exportPacket(
                                              p,
                                              "channel-" + (i + 1),
                                            )
                                          }
                                        >
                                          <Download size={12} />
                                          არხი {i + 1}
                                        </button>
                                      ),
                                  )}
                                </div>
                                <SignalPlot
                                  signals={[
                                    a?.type === "signal" ? a.value : undefined,
                                    b?.type === "signal" ? b.value : undefined,
                                  ]}
                                  cursor={cursor}
                                />
                                <label className="time-cursor">
                                  დროის კურსორი
                                  <input
                                    aria-label="შედეგის დროის კურსორი"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step=".001"
                                    value={playback.time / project.duration}
                                    onChange={(e) =>
                                      playback.seek(
                                        +e.target.value * project.duration,
                                      )
                                    }
                                  />
                                  <span>
                                    {(
                                      (a?.type === "signal"
                                        ? a.value.times.at(-1)
                                        : b?.type === "signal"
                                          ? b.value.times.at(-1)
                                          : project.duration)! * cursor
                                    ).toFixed(3)}{" "}
                                    წმ
                                  </span>
                                </label>
                              </>
                            );
                          })()
                        ) : packets.length ? (
                          packets.map(
                            ([key, p]) =>
                              p && (
                                <div className="packet-result" key={key}>
                                  <header>
                                    <span>
                                      {key}
                                      <code>{L(p.type)}</code>
                                    </span>
                                    <button
                                      onClick={() =>
                                        exportPacket(
                                          p,
                                          outNode!.label + "-" + key,
                                        )
                                      }
                                    >
                                      <Download size={13} />
                                      ექსპორტი
                                    </button>
                                  </header>
                                  <PacketView packet={p} />
                                </div>
                              ),
                          )
                        ) : (
                          <p className="muted">
                            {fresh.results[outNode?.id || ""]?.message ||
                              "No output data"}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </section>
              )}
            </section>
            {rightOpen && (
              <aside className="inspector-panel">
                {current && definition ? (
                  <>
                    <header className="inspector-header">
                      <span
                        className="catalog-icon"
                        style={{
                          color: categories.find(
                            (c) => c.id === definition.category,
                          )?.color,
                        }}
                      >
                        <NodeIcon name={definition.icon} size={20} />
                      </span>
                      <div>
                        <h2>{current.label}</h2>
                        <span>{definition.title}</span>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="პარამეტრების დახურვა"
                        onClick={() => setRightOpen(false)}
                      >
                        <X size={16} />
                      </button>
                    </header>
                    <div className="inspector-tabs">
                      <span>
                        <SlidersHorizontal size={13} />
                        {t("პარამეტრები", "Parameters")}
                      </span>
                      <small>{L(definition.category)}</small>
                    </div>
                    <div className="inspector-scroll">
                      <label className="field">
                        <span>{t("ნოუდის სახელი", "ნოუდის სახელი")}</span>
                        <input
                          aria-label="ნოუდის სახელი"
                          value={current.label}
                          onFocus={startEdit}
                          onBlur={endEdit}
                          onChange={(e) =>
                            setProject({
                              ...project,
                              nodes: project.nodes.map((n) =>
                                n.id === selected
                                  ? {
                                      ...n,
                                      label: e.target.value.slice(0, 100),
                                    }
                                  : n,
                              ),
                            })
                          }
                        />
                      </label>
                      {definition.inputs.length > 0 && (
                        <section className="inspector-section">
                          <h3>
                            <Link2 size={13} />
                            {t("შემავალი კავშირები", "INPUT CONNECTIONS")}
                          </h3>
                          {definition.inputs.map((port) => {
                            if (port.multiple) {
                              const options = project.nodes
                                .filter((n) => n.id !== selected)
                                .flatMap((n) =>
                                  nodeDefinition(n, project)!
                                    .outputs.filter((o) =>
                                      o.types.some((type) =>
                                        port.types.includes(type),
                                      ),
                                    )
                                    .map((o) => ({ n, o })),
                                );
                              return (
                                <div
                                  className="multi-connections"
                                  key={port.id}
                                >
                                  <h4>
                                    {port.label}
                                    <code>
                                      {port.types.map(L).join(" | ")}[]
                                    </code>
                                  </h4>
                                  {options.length ? (
                                    options.map(({ n, o }) => (
                                      <label key={n.id + o.id}>
                                        <input
                                          aria-label={"დაკავშირება: " + n.label}
                                          type="checkbox"
                                          checked={project.edges.some(
                                            (e) =>
                                              e.source === n.id &&
                                              e.sourceHandle === o.id &&
                                              e.target === selected &&
                                              e.targetHandle === port.id,
                                          )}
                                          onChange={() =>
                                            setInput(port.id, n.id + "|" + o.id)
                                          }
                                        />
                                        <span>{n.label}</span>
                                        <small>{o.label}</small>
                                      </label>
                                    ))
                                  ) : (
                                    <p>
                                      დაამატეთ შესაბამისი ნოუდი კატალოგიდან და
                                      აქ დააკავშირეთ.
                                    </p>
                                  )}
                                </div>
                              );
                            }
                            const edge = project.edges.find(
                              (e) =>
                                e.target === selected &&
                                e.targetHandle === port.id,
                            );
                            return (
                              <label
                                className="field connection-field"
                                key={port.id}
                              >
                                <span>
                                  {port.label}
                                  <code
                                    style={{ color: typeColors[port.types[0]] }}
                                  >
                                    {port.types.length > 3
                                      ? "any"
                                      : port.types.map(L).join(" | ")}
                                  </code>
                                </span>
                                <select
                                  aria-label={"დაკავშირება: " + port.label}
                                  value={
                                    edge
                                      ? edge.source + "|" + edge.sourceHandle
                                      : ""
                                  }
                                  onChange={(e) =>
                                    setInput(port.id, e.target.value)
                                  }
                                >
                                  <option value="">
                                    {port.optional
                                      ? "არ არის დაკავშირებული · არჩევითი"
                                      : "აირჩიეთ გამომავალი…"}
                                  </option>
                                  {project.nodes
                                    .filter((n) => n.id !== selected)
                                    .flatMap((n) =>
                                      nodeDefinition(n, project)!
                                        .outputs.filter((o) =>
                                          o.types.some((type) =>
                                            port.types.includes(type),
                                          ),
                                        )
                                        .map((o) => (
                                          <option
                                            key={n.id + o.id}
                                            value={n.id + "|" + o.id}
                                          >
                                            {n.label} → {o.label}
                                          </option>
                                        )),
                                    )}
                                </select>
                              </label>
                            );
                          })}
                        </section>
                      )}
                      {definition.fields.length > 0 && (
                        <section className="inspector-section">
                          <h3>
                            <Settings2 size={13} />
                            {t("კონფიგურაცია", "CONFIGURATION")}
                          </h3>
                          {definition.fields.map(renderField)}
                        </section>
                      )}
                      {definition.category === "Scenes" && (
                        <button
                          className="open-scene-button"
                          onClick={() => setSceneId(current.id)}
                        >
                          <Box size={16} />
                          {t("სცენის რედაქტორი", "სცენის რედაქტორის გახსნა")}
                          <ArrowUpRight size={14} />
                        </button>
                      )}
                      {definition.category === "Sensors" && (
                        <button
                          className="secondary full-width"
                          onClick={() => {
                            const e = project.edges.find(
                              (e) =>
                                e.target === selected &&
                                e.targetHandle === "scene",
                            );
                            if (e) setSceneId(e.target);
                            else setNotice("ჯერ დააკავშირეთ სენსორი სცენასთან");
                          }}
                        >
                          <Radio size={14} />
                          {t("სცენაში განთავსება", "სცენაში განთავსება")}
                        </button>
                      )}
                      {current.kind === "formula" && (
                        <button
                          className="secondary full-width"
                          onClick={() => {
                            try {
                              compileExpression(
                                String(current.params.expression),
                              );
                              if (project.tools.length >= 30)
                                throw Error("მაქსიმუმ 30 მრავალჯერადი ფორმულა");
                              const id = "custom-" + crypto.randomUUID();
                              commit({
                                ...project,
                                tools: [
                                  ...project.tools,
                                  {
                                    id,
                                    label:
                                      current.label === "Formula"
                                        ? "ჩემი ფორმულა"
                                        : current.label,
                                    expression: String(
                                      current.params.expression,
                                    ),
                                    unit: String(current.params.unit),
                                  },
                                ],
                              });
                              setNotice(
                                "დაემატა კატალოგის დამუშავების კატეგორიას",
                              );
                            } catch (e) {
                              setNotice(
                                e instanceof Error ? e.message : String(e),
                              );
                            }
                          }}
                        >
                          <Bookmark size={14} />
                          {t("კატალოგში შენახვა", "Save as reusable node")}
                        </button>
                      )}
                      <div className="node-help">
                        <Info size={14} />
                        <p>{definition.help}</p>
                      </div>
                      {fresh?.results[selected] && (
                        <div
                          className={
                            "validation-note " + fresh.results[selected].status
                          }
                        >
                          {fresh.results[selected].status === "ok" ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <AlertCircle size={14} />
                          )}
                          <span>
                            {message(fresh.results[selected].message)}
                          </span>
                        </div>
                      )}
                      <div className="node-actions">
                        <button onClick={duplicate}>
                          <Copy size={13} />
                          {t("დუბლირება", "Duplicate")}
                        </button>
                        <button
                          className="danger"
                          onClick={() => remove([selected])}
                        >
                          <Trash2 size={13} />
                          {t("წაშლა", "Delete")}
                        </button>
                      </div>
                      <code className="node-id">{current.id}</code>
                    </div>
                  </>
                ) : (
                  <div className="inspector-placeholder">
                    <span>
                      <MousePointerIcon />
                    </span>
                    <h3>{t("აირჩიეთ ნოუდი", "Make it your own.")}</h3>
                    <p>
                      {t(
                        "აირჩიეთ ნოუდი კონფიგურაციისა და შემავალი კავშირების სამართავად.",
                        "Select a node to configure its parameters, connect inputs and inspect its data contract.",
                      )}
                    </p>
                    <div>
                      <Link2 size={14} />
                      <span>ტიპიზებული კავშირები</span>
                    </div>
                    <div>
                      <SlidersHorizontal size={14} />
                      <span>აღწერით განსაზღვრული პარამეტრები</span>
                    </div>
                    <div>
                      <Activity size={14} />
                      <span>შესრულების დათვალიერება</span>
                    </div>
                  </div>
                )}
              </aside>
            )}
          </div>
          <footer className="statusbar">
            <span className="status-brand">
              <i />
              {running
                ? "სიმულაცია მზადდება…"
                : errorCount
                  ? errorCount + " ნოუდი შესამოწმებელია"
                  : playbackLabel(playback.phase)}
              {
                <>
                  {" "}
                  · {playback.time.toFixed(2)} / {project.duration.toFixed(2)}{" "}
                  წმ
                </>
              }
            </span>
            <span className="status-model">
              {project.duration} წმ · {project.sampleRate} Hz ·{" "}
              {Math.round(project.duration * project.sampleRate) + 1} ათვლა
            </span>
            <button onClick={() => setGuide(true)}>
              <Keyboard size={13} />
              {t("გზამკვლევი", "Quick guide")}
            </button>
            <span className="status-version">LATTICE სტუდია / 2.2</span>
          </footer>
        </div>
        {notice && (
          <div className="toast" role="status">
            <Info size={17} />
            <span>{message(notice)}</span>
            <button
              aria-label="შეტყობინების დახურვა"
              onClick={() => setNotice("")}
            >
              <X size={15} />
            </button>
          </div>
        )}

        {sceneNode && (
          <Suspense
            fallback={
              <div className="modal-shade">
                <div className="small-modal">სცენის რედაქტორი იტვირთება…</div>
              </div>
            }
          >
            <SceneEditor
              node={sceneNode}
              project={project}
              ka={ka}
              onClose={() => setSceneId("")}
              onPatch={patch}
              onSelectNode={choose}
              onStart={startEdit}
              onEnd={endEdit}
              onRename={(id, label) =>
                commit({
                  ...project,
                  nodes: project.nodes.map((n) =>
                    n.id === id ? { ...n, label } : n,
                  ),
                })
              }
              onEventTrigger={(id, value) => {
                const next = {
                  ...project,
                  edges: project.edges.filter(
                    (e) => !(e.target === id && e.targetHandle === "trigger"),
                  ),
                };
                if (value) {
                  const [source, sourceHandle] = value.split("|");
                  const wire = {
                    id: crypto.randomUUID(),
                    source,
                    sourceHandle,
                    target: id,
                    targetHandle: "trigger",
                  };
                  const error = connectionError(next, wire);
                  if (error) {
                    setNotice(error);
                    return;
                  }
                  next.edges.push(wire);
                }
                commit(next);
              }}
              onAddEvent={(kind, id) => {
                if (project.nodes.length >= 100) {
                  setNotice("მაქსიმუმ 100 ნოუდი");
                  return;
                }
                const n = makeNode(
                  kind,
                  sceneNode.position.x - 330,
                  sceneNode.position.y + project.nodes.length * 30,
                  project.tools,
                );
                n.params = {
                  ...n.params,
                  x: Number(sceneNode.params.width) / 2,
                  y:
                    kind === "waterMist"
                      ? Number(sceneNode.params.height) * 0.9
                      : Math.min(1, Number(sceneNode.params.height)),
                  z: Number(sceneNode.params.depth) / 2,
                };
                commit({
                  ...project,
                  nodes: [...project.nodes, n],
                  edges: [
                    ...project.edges,
                    {
                      id: crypto.randomUUID(),
                      source: n.id,
                      sourceHandle: "effect",
                      target: id,
                      targetHandle: "events",
                    },
                  ],
                });
                return n.id;
              }}
              onDetach={(id) =>
                commit({
                  ...project,
                  edges: project.edges.filter(
                    (e) => !(e.source === id && e.target === sceneNode.id),
                  ),
                })
              }
              run={fresh}
              onRun={startPlayback}
              playback={playback}
              running={running}
              onAddSensor={(kind, id) => {
                if (project.nodes.length >= 100) {
                  setNotice("მაქსიმუმ 100 ნოუდი");
                  return;
                }
                const n = makeNode(
                  kind,
                  sceneNode.position.x + 340,
                  sceneNode.position.y + project.nodes.length * 20,
                  project.tools,
                );
                n.params = {
                  ...n.params,
                  x: Number(sceneNode.params.width) / 2,
                  y: Math.min(1, Number(sceneNode.params.height)),
                  z: Number(sceneNode.params.depth) / 2,
                };
                commit({
                  ...project,
                  nodes: [...project.nodes, n],
                  edges: [
                    ...project.edges,
                    {
                      id: crypto.randomUUID(),
                      source: n.id,
                      sourceHandle: "sensor",
                      target: id,
                      targetHandle: "sensors",
                    },
                  ],
                });
              }}
            />
          </Suspense>
        )}
        {(settings || guide) && (
          <div className="modal-shade">
            <section
              className="small-modal"
              role="dialog"
              aria-modal="true"
              aria-label={settings ? "ფლოუს პარამეტრები" : "Quick guide"}
            >
              <header>
                <h2>
                  {settings
                    ? t("შესრულების პარამეტრები", "ფლოუს პარამეტრები")
                    : t(
                        "ერთი სივრცე. უსაზღვრო კომბინაციები.",
                        "One workspace. Open possibilities.",
                      )}
                </h2>
                <button
                  className="icon-button"
                  aria-label="ფანჯრის დახურვა"
                  onClick={() => {
                    setSettings(false);
                    setGuide(false);
                  }}
                >
                  <X size={20} />
                </button>
              </header>
              {settings ? (
                <>
                  <p>
                    გენერირებული სიგნალები და მოვლენები იყენებს საერთო საათს.
                    იმპორტირებული მონაცემები ინარჩუნებს თავის დროით ბადეს
                    ხელახალ დისკრეტიზაციამდე.
                  </p>
                  {[
                    {
                      key: "duration",
                      label: "ხანგრძლივობა · წამი",
                      min: 0.1,
                      max: 60,
                      step: 0.1,
                    },
                    {
                      key: "sampleRate",
                      label: "დისკრეტიზაციის სიხშირე · Hz",
                      min: 10,
                      max: 2000,
                      step: 10,
                    },
                  ].map((f) => (
                    <label className="field" key={f.key}>
                      <span>{f.label}</span>
                      <input
                        aria-label={f.label}
                        type="number"
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={project[f.key as "duration"]}
                        onChange={(e) => {
                          const value = +e.target.value;
                          if (value >= f.min && value <= f.max)
                            commit({ ...project, [f.key]: value });
                        }}
                      />
                    </label>
                  ))}
                  <div
                    className={
                      "settings-note " +
                      (project.duration * project.sampleRate > 10000
                        ? "error"
                        : "")
                    }
                  >
                    <Info size={15} />
                    {Math.round(project.duration * project.sampleRate) + 1}{" "}
                    ათვლა · მაქსიმუმ 10 001 ერთ გაშვებაზე
                  </div>
                </>
              ) : (
                <>
                  <p>
                    {t(
                      "ტრიგერი იწყებს, სცენა აღწერს გარემოს, სენსორი კითხულობს, ფორმულა გარდაქმნის, შედეგის ნოუდი აჩვენებს.",
                      "Triggers start. Scenes describe environments. Sensors sample. Formulas transform. Outputs make data visible.",
                    )}
                  </p>
                  <ol>
                    <li>დაამატეთ ნოუდი კატალოგიდან ან გადმოათრიეთ კანვასზე.</li>
                    <li>
                      შეაერთეთ თავსებადი პორტები ან აირჩიეთ შემავალი კავშირი
                      პარამეტრების პანელში.
                    </li>
                    <li>
                      სცენაში განათავსეთ ობიექტები და სენსორები. 2D გეგმაზე
                      შეგიძლიათ გადათრევა; 3D ხედში — მობრუნება, მონიშვნა და
                      კოორდინატების შეცვლა.
                    </li>
                    <li>
                      გაუშვით ფლოუ. დაათვალიერეთ შედეგები, შეცდომები და
                      მოვლენების დრო.
                    </li>
                    <li>
                      შეინახეთ ლოკალურად ან გაიტანეთ JSON სხვა სამუშაო სივრცეში
                      გადასატანად.
                    </li>
                  </ol>
                  <div className="shortcut-list">
                    <span>
                      შენახვა<kbd>Ctrl / ⌘ S</kbd>
                    </span>
                    <span>
                      ნოუდის ძებნა<kbd>Ctrl / ⌘ K</kbd>
                    </span>
                    <span>
                      გაშვება<kbd>Ctrl / ⌘ Enter</kbd>
                    </span>
                    <span>
                      უკან დაბრუნება<kbd>Ctrl / ⌘ Z</kbd>
                    </span>
                  </div>
                  <p className="guide-limit">
                    სენსორები იყენებს სასწავლო ანალიტიკურ მოდელებს. გამოთვლა
                    ლოკალურია. რეალური აპარატურა და ფონური ავტომატიზაცია
                    დაკავშირებული არ არის. სცენაში შეგიძლიათ ფორმებისა და OBJ
                    მოდელების დამატება.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
        {showStudyBinding && (
          <BindingDialog
            project={project}
            isOpen={showStudyBinding}
            onClose={() => setShowStudyBinding(false)}
            defaultStudyId={activeStudyId}
          />
        )}
      </FlowContext.Provider>
    </PlotClock.Provider>
  );
}
function MousePointerIcon() {
  return <Workflow size={30} />;
}
