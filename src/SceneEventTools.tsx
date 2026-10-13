import { L, message } from "./core/ka";
import { useRef } from "react";
import { Play, Pause, RotateCcw, Timer, Unplug, Zap } from "lucide-react";
import type {
  LabNode,
  SceneEventConfig,
  SceneData,
  Project,
} from "./core/types";
import { nodeDefinition } from "./core/registry";
import {
  eventDefinition,
  eventEnd,
  spatialFields,
  scheduleFields,
} from "./core/scene-events";
export function EventProperties({
  node,
  scene,
  project,
  onTrigger,
  onRename,
  onPatch,
  onDetach,
  onStart,
  onEnd,
}: {
  node: LabNode;
  scene: SceneData;
  project: Project;
  onTrigger: (value: string) => void;
  onRename: (label: string) => void;
  onPatch: (id: string, p: Record<string, unknown>, record?: boolean) => void;
  onDetach: () => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const d = eventDefinition(node.kind)!;
  const wire = project.edges.find(
    (e) => e.target === node.id && e.targetHandle === "trigger",
  );
  return (
    <div className="event-properties">
      <div className="event-property-title" style={{ color: d.color }}>
        <Zap size={16} />
        <b>{d.title}</b>
      </div>
      <p>{d.description}</p>
      <label className="event-field">
        <span>მოვლენის სახელი</span>
        <input
          className="event-name"
          aria-label="მოვლენის სახელი"
          value={node.label}
          maxLength={100}
          onChange={(e) => onRename(e.target.value)}
        />
      </label>
      <label className="event-field">
        <span>ტრიგერის წყარო</span>
        <select
          aria-label="მოვლენის ტრიგერის წყარო"
          value={wire ? wire.source + "|" + wire.sourceHandle : ""}
          onChange={(e) => onTrigger(e.target.value)}
        >
          <option value="">სცენის საათი · მითითებული დაწყება</option>
          {project.nodes
            .filter((n) => n.id !== node.id)
            .flatMap((n) =>
              nodeDefinition(n, project)!
                .outputs.filter((p) => p.types.includes("event"))
                .map((p) => (
                  <option key={n.id + "|" + p.id} value={n.id + "|" + p.id}>
                    {n.label} → {p.label}
                  </option>
                )),
            )}
        </select>
      </label>
      {[
        { title: "დრო", fields: scheduleFields },
        { title: "პოზიცია და მოქმედების არე", fields: spatialFields },
        { title: "ეფექტი", fields: d.fields },
      ].map((group) => (
        <section key={group.title}>
          <h4>{group.title}</h4>
          {group.fields.map((f) => {
            const max =
              f.key === "x"
                ? scene.width
                : f.key === "y"
                  ? scene.height
                  : f.key === "z"
                    ? scene.depth
                    : f.max;
            return (
              <label className="event-field" key={f.key}>
                <span>
                  {f.label}
                  <small>{L(f.unit ?? "")}</small>
                </span>
                {f.kind === "select" ? (
                  <select
                    aria-label={f.label}
                    value={String(node.params[f.key])}
                    onChange={(e) =>
                      onPatch(node.id, { [f.key]: e.target.value })
                    }
                  >
                    {f.options?.map((o) => (
                      <option key={o} value={o}>
                        {L(o)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="event-number">
                    <input
                      aria-label={f.label}
                      type="number"
                      min={f.min}
                      max={max}
                      step={f.step}
                      value={Number(node.params[f.key])}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (
                          Number.isFinite(v) &&
                          v >= (f.min ?? -Infinity) &&
                          v <= (max ?? Infinity)
                        )
                          onPatch(node.id, { [f.key]: v });
                      }}
                    />
                    {["start", "duration", "radius", "reduction"].includes(
                      f.key,
                    ) && (
                      <input
                        aria-label={f.label + " სლაიდერი"}
                        type="range"
                        min={f.min}
                        max={
                          f.key === "start" || f.key === "duration"
                            ? Math.min(max ?? 60, 10)
                            : max
                        }
                        step={f.step}
                        value={Number(node.params[f.key])}
                        onPointerDown={onStart}
                        onPointerUp={onEnd}
                        onPointerCancel={onEnd}
                        onKeyDown={onStart}
                        onKeyUp={onEnd}
                        onChange={(e) =>
                          onPatch(
                            node.id,
                            { [f.key]: Number(e.target.value) },
                            false,
                          )
                        }
                      />
                    )}
                  </div>
                )}
              </label>
            );
          })}
        </section>
      ))}
      <p className="event-model-note">{d.help}</p>
      <button className="danger" onClick={onDetach}>
        <Unplug size={13} />
        სცენიდან მოხსნა
      </button>
    </div>
  );
}
export function EventTimeline({
  events,
  duration,
  time,
  onTime,
  playing,
  onPlaying,
  speed,
  onSpeed,
  preparing,
  selected,
  onSelect,
  onPatch,
  onStart,
  onEnd,
  unresolved,
}: {
  events: SceneEventConfig[];
  duration: number;
  time: number;
  onTime: (v: number) => void;
  playing: boolean;
  onPlaying: (v: boolean) => void;
  speed: number;
  onSpeed: (v: number) => void;
  preparing: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onPatch: (id: string, p: Record<string, unknown>, record?: boolean) => void;
  onStart: () => void;
  onEnd: () => void;
  unresolved: number;
}) {
  const drag = useRef<{
    id: string;
    x: number;
    start: number;
    width: number;
  } | null>(null);
  return (
    <div className="event-timeline">
      <div className="timeline-head">
        <b>
          <Timer size={14} />
          მოვლენების დროის ხაზი
        </b>
        <span>გადაათრიეთ ბლოკი დროის შესაცვლელად</span>
        <button
          aria-label="ანიმაციის თავიდან დაწყება"
          onClick={() => {
            onPlaying(false);
            onTime(0);
          }}
        >
          <RotateCcw size={13} />
        </button>
        <button
          aria-label={playing ? "ანიმაციის შეჩერება" : "ანიმაციის დაკვრა"}
          disabled={preparing}
          onClick={() => {
            if (!playing && time >= duration) onTime(0);
            onPlaying(!playing);
          }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <select
          aria-label="სცენის დაკვრის სიჩქარე"
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
        >
          {[0.1, 0.25, 0.5, 1].map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
        <code>
          {time.toFixed(2)} / {duration.toFixed(2)} წმ
        </code>
      </div>
      <label className="timeline-scrub">
        <span>დაკვრის დრო</span>
        <input
          aria-label="ანიმაციის დრო"
          type="range"
          min="0"
          max={duration}
          step=".01"
          value={time}
          onChange={(e) => {
            onPlaying(false);
            onTime(Number(e.target.value));
          }}
        />
      </label>
      <div className="timeline-tracks">
        {events.map((e) => (
          <div
            className={"timeline-row " + (selected === e.id ? "selected" : "")}
            key={e.id}
          >
            <button onClick={() => onSelect(e.id)}>
              <i style={{ background: eventDefinition(e.kind)?.color }} />
              {e.label}
            </button>
            <div
              className="timeline-track"
              onPointerMove={(p) => {
                const v = drag.current;
                if (!v || v.id !== e.id) return;
                onPatch(
                  e.id,
                  {
                    start:
                      Math.round(
                        Math.max(
                          0,
                          Math.min(
                            60,
                            v.start + ((p.clientX - v.x) / v.width) * duration,
                          ),
                        ) * 100,
                      ) / 100,
                  },
                  false,
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
              {e.starts
                .filter((t) => t <= duration)
                .map((start, i) => (
                  <button
                    key={i}
                    aria-label={e.label + " — " + start.toFixed(2) + " წამი"}
                    title={
                      "დაწყება " +
                      start.toFixed(2) +
                      " წმ · გადაათრიეთ გადასაწევად"
                    }
                    className="timeline-block"
                    style={{
                      left: (100 * start) / duration + "%",
                      width:
                        Math.max(
                          0.8,
                          (100 *
                            (Math.min(duration, eventEnd(e, start)) - start)) /
                            duration,
                        ) + "%",
                      background: eventDefinition(e.kind)?.color,
                    }}
                    onPointerDown={(p) => {
                      onSelect(e.id);
                      onStart();
                      drag.current = {
                        id: e.id,
                        x: p.clientX,
                        start: Number(e.params.start),
                        width:
                          p.currentTarget.parentElement!.getBoundingClientRect()
                            .width,
                      };
                      p.currentTarget.parentElement!.setPointerCapture(
                        p.pointerId,
                      );
                    }}
                  />
                ))}
              <i
                className="timeline-playhead"
                style={{ left: (100 * time) / duration + "%" }}
              />
              {!e.starts.length && (
                <small>
                  {e.params.enabled === "Off"
                    ? "გამორთულია"
                    : "გაშვების დრო ჯერ არ გამოთვლილა"}
                </small>
              )}
            </div>
          </div>
        ))}
      </div>
      {!events.length && (
        <p className="timeline-empty">
          დაამატეთ მოვლენა მისი პოზიციის, დროისა და ეფექტის მოსარგებად.
        </p>
      )}
      {!!unresolved && (
        <p className="timeline-empty">
          გაუშვით ფლოუ დასადგენად: {unresolved} დაკავშირებული ტრიგერის განრიგი.
        </p>
      )}
    </div>
  );
}
