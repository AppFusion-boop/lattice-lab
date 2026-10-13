import { useEffect, useRef, useState } from "react";
import {
  applySceneEvents,
  eventDefinition,
  type Measurement,
} from "./core/scene-events";
import type { SceneData } from "./core/types";
const channels: Record<Measurement, { label: string; unit: string }> = {
  pressure: { label: "წნევა", unit: "Pa" },
  temperature: { label: "ტემპერატურა", unit: "°C" },
  light: { label: "განათება", unit: "lx" },
  acceleration: { label: "აჩქარება", unit: "m/s²" },
};
export function FieldMap({ scene, time }: { scene: SceneData; time: number }) {
  const available = [
    ...new Set(
      (scene.events ?? []).flatMap(
        (e) => eventDefinition(e.kind)?.channels ?? [],
      ),
    ),
  ];
  const [choice, setChoice] = useState<Measurement | "">("");
  const channel = available.includes(choice as Measurement)
    ? (choice as Measurement)
    : available[0];
  const [height, setHeight] = useState(1.5);
  const [extent, setExtent] = useState(18000);
  const [fixed, setFixed] = useState(false);
  const [range, setRange] = useState([0, 0]);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!channel || !ref.current) return;
    const c = ref.current,
      ctx = c.getContext("2d")!;
    c.width = 480;
    c.height = 90;
    const base =
      channel === "temperature"
        ? scene.temperature
        : channel === "light"
          ? scene.light
          : 0;
    const values = Array.from({ length: 120 * 24 }, (_, i) =>
      applySceneEvents(
        base,
        scene.events ?? [],
        channel,
        {
          x: (((i % 120) + 0.5) / 120) * scene.width,
          y: Math.min(scene.height, height),
          z: ((Math.floor(i / 120) + 0.5) / 24) * scene.depth,
        },
        time,
        scene.dimension,
      ),
    );
    const low = Math.min(0, ...values),
      high = Math.max(0.001, ...values),
      scale = fixed ? extent : Math.max(Math.abs(low), Math.abs(high));
    setRange(fixed ? [-extent, extent] : [low, high]);
    ctx.fillStyle = "#14272a";
    ctx.fillRect(0, 0, 480, 90);
    values.forEach((v, i) => {
      const intensity = Math.min(1, Math.abs(v) / scale);
      ctx.fillStyle =
        v >= 0
          ? "rgba(234,147,75," + intensity + ")"
          : "rgba(75,172,218," + intensity + ")";
      ctx.fillRect((i % 120) * 4, (Math.floor(i / 120) * 90) / 24, 4, 4);
    });
  }, [scene, time, channel, height, extent, fixed]);
  if (!channel) return null;
  return (
    <div className="monitor-field-map">
      <div>
        <select
          aria-label="ველის საზომი"
          value={channel}
          onChange={(e) => setChoice(e.target.value as Measurement)}
        >
          {available.map((c) => (
            <option value={c} key={c}>
              {channels[c].label}
            </option>
          ))}
        </select>
        <label>
          Y{" "}
          <input
            aria-label="ველის ჭრილის სიმაღლე"
            type="number"
            min="0"
            max={scene.height}
            step=".1"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />{" "}
          მ
        </label>
        <label>
          <input
            type="checkbox"
            checked={fixed}
            onChange={(e) => setFixed(e.target.checked)}
          />
          ფიქსირებული მასშტაბი
        </label>
        {fixed && (
          <input
            aria-label="ველის მასშტაბი"
            type="number"
            min="0.001"
            value={extent}
            onChange={(e) => setExtent(Math.max(0.001, Number(e.target.value)))}
          />
        )}
      </div>
      <canvas
        ref={ref}
        aria-label={channels[channel].label + " — სივრცითი რუკა"}
      />
      <small>
        მოვლენების ველი · {range[0].toPrecision(3)} … {range[1].toPrecision(3)}{" "}
        {channels[channel].unit} · {scene.width} × {scene.depth} მ
      </small>
    </div>
  );
}
