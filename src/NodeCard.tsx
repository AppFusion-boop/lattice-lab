import { L, message } from "./core/ka";
import { memo, useEffect, useContext, createContext } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import {
  Check,
  AlertCircle,
  ArrowUpRight,
  Radio,
  MousePointer2,
  Timer,
  LayoutTemplate,
  Box,
  Hash,
  ToggleLeft,
  Type,
  Move3D,
  FileSpreadsheet,
  Columns3,
  Activity,
  Gauge,
  Thermometer,
  Mic,
  Sun,
  Sigma,
  Waves,
  CloudRain,
  Spline,
  ChartNoAxesCombined,
  Zap,
  Clock3,
  GitBranch,
  Split,
  PanelTop,
  Table2,
  ListOrdered,
} from "lucide-react";
const iconMap = {
  MousePointer2,
  Timer,
  LayoutTemplate,
  Box,
  Hash,
  ToggleLeft,
  Type,
  Move3D,
  FileSpreadsheet,
  Columns3,
  Activity,
  Gauge,
  Thermometer,
  Mic,
  Sun,
  Sigma,
  Waves,
  Spline,
  ChartNoAxesCombined,
  Zap,
  Clock3,
  GitBranch,
  Split,
  PanelTop,
  Table2,
  ListOrdered,
};
import {
  getDefinition,
  nodeDefinition,
  attachedSensors,
  attachedEvents,
} from "./core/registry";
import { eventDefinition } from "./core/scene-events";
import { inputPacket, outputTypes } from "./core/runtime";
import {
  typeColors,
  categories,
  type LabNode,
  type Project,
  type Run,
  type DataType,
} from "./core/types";
import { SignalPlot, PacketView } from "./Plots";
export type FlowNode = Node<{ node: LabNode }, "lab">;
export const FlowContext = createContext<{
  project: Project;
  run: Run | null;
  running: boolean;
  openScene: (id: string) => void;
  openResults: (id: string) => void;
}>({
  project: null!,
  run: null,
  running: false,
  openScene: () => {},
  openResults: () => {},
});
export function NodeIcon({ name, size = 17 }: { name: string; size?: number }) {
  const Icon =
    (iconMap as Record<string, React.ComponentType<{ size: number }>>)[name] ||
    Box;
  return <Icon size={size} />;
}
export function SceneMini({ node }: { node: LabNode }) {
  const { project } = useContext(FlowContext);
  const sensors = attachedSensors(project, node.id);
  const events = attachedEvents(project, node.id);
  const objects = (node.params.objects || []) as {
    position: { x: number; z: number };
    size: { x: number; z: number };
    color: string;
    shape: string;
  }[];
  return (
    <svg
      viewBox="0 0 240 100"
      className="scene-mini"
      role="img"
      aria-label="სცენის ობიექტების განლაგება"
    >
      <defs>
        <pattern
          id={"grid-" + node.id}
          width="14"
          height="10"
          patternUnits="userSpaceOnUse"
        >
          <path d="M14 0H0V10" fill="none" stroke="#cad9d0" strokeWidth=".5" />
        </pattern>
      </defs>
      <rect
        x="10"
        y="8"
        width="220"
        height="78"
        rx="3"
        fill="#eef4ef"
        stroke="#bacdc1"
      />
      <rect
        x="10"
        y="8"
        width="220"
        height="78"
        fill={"url(#grid-" + node.id + ")"}
      />
      {objects.map((o, i) => {
        const x = 10 + (o.position.x / Number(node.params.width)) * 220,
          y = 8 + (o.position.z / Number(node.params.depth)) * 78;
        return o.shape === "source" ? (
          <g key={i}>
            <circle cx={x} cy={y} r="12" fill="none" stroke="#e5b16d77" />
            <circle cx={x} cy={y} r="4" fill="#d8a05a" />
          </g>
        ) : (
          <rect
            key={i}
            x={x - o.size.x * 4}
            y={y - o.size.z * 2}
            width={o.size.x * 8}
            height={o.size.z * 4}
            rx="2"
            fill={o.color + "99"}
            stroke={o.color}
          />
        );
      })}
      {events.map((e) => (
        <g key={e.id}>
          <circle
            cx={10 + (Number(e.params.x) / Number(node.params.width)) * 220}
            cy={8 + (Number(e.params.z) / Number(node.params.depth)) * 78}
            r="8"
            fill="none"
            stroke={eventDefinition(e.kind)?.color}
          />
          <title>{e.label}</title>
        </g>
      ))}
      {sensors.map((s) => (
        <g key={s.id}>
          <circle
            cx={10 + (Number(s.params.x) / Number(node.params.width)) * 220}
            cy={8 + (Number(s.params.z) / Number(node.params.depth)) * 78}
            r="4"
            fill="#2e968d"
            stroke="white"
          />
          <title>{s.label}</title>
        </g>
      ))}
      <text x="12" y="98">
        {node.params.width as number} × {node.params.depth as number} მ
      </text>
      <text x="228" y="98" textAnchor="end">
        {sensors.length} სენსორი · {events.length} მოვლენა
      </text>
    </svg>
  );
}
export function LabNodeCard({ data, selected }: NodeProps<FlowNode>) {
  const { project, run, running, openScene, openResults } =
      useContext(FlowContext),
    n = data.node,
    d = nodeDefinition(n, project)!;
  const updateInternals = useUpdateNodeInternals();
  const portIds =
    d.inputs.map((p) => p.id).join() + d.outputs.map((p) => p.id).join();
  useEffect(() => {
    updateInternals(n.id);
  }, [n.id, portIds, updateInternals]);
  const category = categories.find((c) => c.id === d.category)!;
  const result = run?.results[n.id];
  const outputs = result?.outputs;
  const first = outputs && Object.values(outputs)[0];
  const scope = d.id === "scope",
    scene = d.category === "Scenes";
  const a = inputPacket(project, run, n.id, "ch1"),
    b = inputPacket(project, run, n.id, "ch2");
  const inspect =
    d.category === "Outputs" && !scope
      ? inputPacket(project, run, n.id, d.inputs[0].id)
      : undefined;
  return (
    <div
      className={
        "node-card " +
        (selected ? "selected " : "") +
        (result?.status === "error" ? "node-error" : "")
      }
      style={{ "--accent": category.color } as React.CSSProperties}
    >
      <div className="node-header drag-handle">
        <span className="node-icon">
          <NodeIcon name={d.icon} />
        </span>
        <div>
          <b>{n.label}</b>
          <small>
            {L(d.category)} · {d.title}
          </small>
        </div>
        <span
          className={
            "node-status " + (running ? "running" : result?.status || "idle")
          }
          title={running ? "მიმდინარეობს" : message(result?.message || "არ გაშვებულა")}
        >
          {result?.status === "ok" ? (
            <Check size={11} />
          ) : result?.status === "error" ? (
            <AlertCircle size={11} />
          ) : (
            <i />
          )}
        </span>
      </div>
      {scene ? (
        <div className="node-body scene-node">
          <SceneMini node={n} />
          <button className="nodrag" onClick={() => openScene(n.id)}>
            სცენის გახსნა
            <ArrowUpRight size={12} />
          </button>
        </div>
      ) : scope ? (
        <div className="node-body scope-node">
          <div className="tiny-legend">
            <span>
              <i />
              არხი 1
            </span>
            <span>
              <i />
              არხი 2
            </span>
            <b>დროის მიხედვით</b>
          </div>
          <SignalPlot
            signals={[
              a?.type === "signal" ? a.value : undefined,
              b?.type === "signal" ? b.value : undefined,
            ]}
            small
          />
          <button className="nodrag" onClick={() => openResults(n.id)}>
            სიგნალების დათვალიერება
            <ArrowUpRight size={11} />
          </button>
        </div>
      ) : n.kind === "formula" || n.kind.startsWith("custom-") ? (
        <div className="node-body formula-node">
          <code>{String(n.params.expression)}</code>
          <span>
            {String(n.params.unit)}
            <small>გამომავალი ერთეული</small>
          </span>
        </div>
      ) : d.category === "Sensors" ? (
        <div className="node-body sensor-node">
          <div>
            <span>პოზიცია</span>
            <code>
              {String(n.params.x)}, {String(n.params.y)}, {String(n.params.z)} მ
            </code>
          </div>
          {first?.type === "signal" ? (
            <SignalPlot signals={[first.value]} small />
          ) : (
            <div className="sensor-idle">
              <Radio size={18} />
              <span>სენსორის იდეალური მოდელი</span>
            </div>
          )}
        </div>
      ) : d.category === "Scene events" ? (
        <div className="node-body">
          <div className="event-node-summary">
            <span>
              {n.params.enabled === "Off" ? "გამორთულია" : "დაგეგმილი ეფექტი"}
            </span>
            <code>
              {String(n.params.start)} წმ + {String(n.params.duration)} წმ
            </code>
          </div>
        </div>
      ) : n.kind === "manual" ? (
        <div className="node-body trigger-node">
          <MousePointer2 size={14} />
          <span>ფლოუს გაშვებისას</span>
          <kbd>t = 0</kbd>
        </div>
      ) : inspect ? (
        <div className="node-body output-node">
          <PacketView packet={inspect} compact />
        </div>
      ) : first ? (
        <div className="node-body">
          <PacketView packet={first} compact />
        </div>
      ) : (
        <div className="node-body node-summary">
          {d.fields.length ? (
            <>
              <span>{d.fields[0].label}</span>
              <code>
                {String(n.params[d.fields[0].key]).slice(0, 38)}
                {d.fields[0].unit ? " " + d.fields[0].unit : ""}
              </code>
            </>
          ) : (
            <span>{d.description}</span>
          )}
        </div>
      )}
      {result && result.status !== "ok" && (
        <div className="node-error-note" title={result.message}>
          {result.message}
        </div>
      )}
      <div className="port-list">
        {d.inputs.map((p) => (
          <div
            className="port input"
            key={p.id}
            style={
              { "--port-color": typeColors[p.types[0]] } as React.CSSProperties
            }
          >
            <Handle
              id={p.id}
              type="target"
              position={Position.Left}
              aria-label={n.label + " შემავალი " + p.label}
            />
            <span>
              {p.label}
              {p.optional && <sup>{p.multiple ? "მრავალი" : "არჩევითი"}</sup>}
            </span>
            <code>
              {p.types.length > 3 ? "ყველა" : p.types.map(L).join(" | ")}
            </code>
          </div>
        ))}
        {d.outputs.map((p) => {
          const types = outputTypes(project, n.id, p.id);
          return (
            <div
              className="port output"
              key={p.id}
              style={
                {
                  "--port-color": typeColors[types[0] || p.types[0]],
                } as React.CSSProperties
              }
            >
              <code>{types.map(L).join(" | ")}</code>
              <span>{p.label}</span>
              <Handle
                id={p.id}
                type="source"
                position={Position.Right}
                aria-label={n.label + " გამომავალი " + p.label}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
export const nodeTypes = { lab: memo(LabNodeCard) };
