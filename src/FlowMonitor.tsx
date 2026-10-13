import { useState } from "react";
import { SlidersHorizontal, Plus, Monitor } from "lucide-react";
import { nodeDefinition } from "./core/registry";
import { inputPacket } from "./core/runtime";
import { message } from "./core/ka";
import type { Project, Run, Packet } from "./core/types";
import { PacketView, SignalPlot } from "./Plots";
import { ScenePreview } from "./SceneEditor";
import "./flow-monitor.css";

export function FlowMonitor({
  project,
  run,
  fullRun,
  time,
  onSelect,
  onOpenScene,
}: {
  project: Project;
  run: Run | null;
  fullRun: Run | null;
  time: number;
  onSelect: (id: string) => void;
  onOpenScene: (id: string) => void;
}) {
  const [watch, setWatch] = useState<string[] | null>(null);
  const [picker, setPicker] = useState(false);
  const defaults = project.nodes
    .filter((n) =>
      ["Scenes", "Outputs"].includes(
        nodeDefinition(n, project)?.category ?? "",
      ),
    )
    .map((n) => n.id);
  const selected = watch ?? defaults;
  const nodes = project.nodes.filter((n) => selected.includes(n.id));
  return (
    <section className="flow-monitor" aria-label="ფლოუს მონიტორინგი">
      <header>
        <div>
          <h2>მონიტორინგი</h2>
          <p>აირჩიეთ თქვენი ფლოუს ნოუდები — ყველა ხედი საერთო დროს მიჰყვება.</p>
        </div>
        <button onClick={() => setPicker(!picker)}>
          <Plus size={15} />
          ნოუდების არჩევა
        </button>
      </header>
      {picker && (
        <div className="monitor-picker">
          {project.nodes.map((n) => (
            <label key={n.id}>
              <input
                type="checkbox"
                checked={selected.includes(n.id)}
                onChange={() =>
                  setWatch(
                    selected.includes(n.id)
                      ? selected.filter((id) => id !== n.id)
                      : [...selected, n.id],
                  )
                }
              />
              {n.label}
            </label>
          ))}
        </div>
      )}
      <div className="monitor-grid">
        {nodes.map((node) => {
          const definition = nodeDefinition(node, project)!;
          const result = run?.results[node.id];
          const scene = definition.outputs.some((p) =>
            p.types.includes("scene"),
          );
          const ports = definition.outputs.length
            ? definition.outputs.map((p) => ({
                label: p.label,
                packet: result?.outputs[p.id],
              }))
            : definition.inputs.map((p) => ({
                label: p.label,
                packet: inputPacket(project, run, node.id, p.id),
              }));
          const signals = ports.flatMap((p) =>
            p.packet?.type === "signal" ? [p.packet.value] : [],
          );
          return (
            <article className="monitor-card" key={node.id}>
              <div className="monitor-card-head">
                <div>
                  <h3>{node.label}</h3>
                  <small>{definition.title}</small>
                </div>
                <button
                  aria-label={node.label + " — კონფიგურაცია"}
                  onClick={() =>
                    scene ? onOpenScene(node.id) : onSelect(node.id)
                  }
                >
                  <SlidersHorizontal size={16} />
                </button>
              </div>
              {scene && (
                <ScenePreview
                  node={node}
                  project={project}
                  run={fullRun}
                  time={time}
                  onSelect={onSelect}
                />
              )}
              {signals.length > 0 && (
                <div className="monitor-signals">
                  <div className="monitor-legend">
                    {signals.map((s, i) => (
                      <span key={i}>
                        {s.name} · {s.values.at(-1)?.toPrecision(4) ?? "—"}{" "}
                        {s.unit}
                      </span>
                    ))}
                  </div>
                  <SignalPlot signals={signals} />
                </div>
              )}
              <div className="monitor-packets">
                {ports
                  .filter(
                    (p) =>
                      p.packet?.type !== "signal" && p.packet?.type !== "scene",
                  )
                  .map((p, i) => (
                    <div key={i}>
                      <small>{p.label}</small>
                      <PacketView packet={p.packet} />
                    </div>
                  ))}
              </div>
              {result && result.status !== "ok" && (
                <p>{message(result.message)}</p>
              )}
              {!run && (
                <p className="monitor-empty">
                  მონაცემების სანახავად ჩართეთ ფლოუს დაკვრა.
                </p>
              )}
            </article>
          );
        })}
      </div>
      {!nodes.length && (
        <div className="monitor-empty">
          <Monitor size={32} />
          <p>
            აირჩიეთ ნოუდები მონიტორინგისთვის. სცენის დამატება აუცილებელი არ
            არის.
          </p>
        </div>
      )}
    </section>
  );
}
