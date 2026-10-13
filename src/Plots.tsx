import { L, message } from "./core/ka";
import { useId, useContext, createContext } from "react";
export const PlotClock = createContext<{
  time: number;
  duration: number;
} | null>(null);
import type { Packet, Signal } from "./core/types";
export function SignalPlot({
  signals,
  small = false,
  cursor = 1,
}: {
  signals: (Signal | undefined)[];
  small?: boolean;
  cursor?: number;
}) {
  const clock = useContext(PlotClock);
  const id = useId(),
    w = small ? 240 : 720,
    h = small ? 95 : 245,
    pad = small ? 8 : 45,
    valid = signals.filter((s) => s && s.times.length > 0) as Signal[];
  if (!valid.length)
    return (
      <div className="plot-empty">
        {small
          ? "შეაერთეთ სიგნალი და გაუშვით"
          : "მონაცემების სანახავად შეაერთეთ სიგნალი და გაუშვით ფლოუ."}
      </div>
    );
  const t0 = clock ? 0 : Math.min(...valid.map((s) => s.times[0])),
    t1 = clock
      ? clock.duration
      : Math.max(...valid.map((s) => s.times.at(-1)!));
  const position = clock ? clock.time / clock.duration : cursor;
  const units = [...new Set(valid.map((s) => s.unit))];
  if (units.length > 1)
    return (
      <div className="separate-unit-plots">
        {valid.map((s, i) => (
          <div key={i}>
            <small>
              {s.name} · {s.unit}
            </small>
            <SignalPlot signals={[s]} small={small} cursor={cursor} />
          </div>
        ))}
      </div>
    );
  const min = Math.min(0, ...valid.flatMap((s) => s.values)),
    max = Math.max(0.00001, ...valid.flatMap((s) => s.values));
  const range = (max - min) * 1.1;
  return (
    <svg
      className={"signal-plot " + (small ? "mini" : "")}
      viewBox={"0 0 " + w + " " + h}
      role="img"
      aria-label="გამოთვლილი სიგნალის გრაფიკი"
    >
      <defs>
        <clipPath id={id}>
          <rect x={pad} y="10" width={w - pad - 12} height={h - pad - 10} />
        </clipPath>
      </defs>
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i}>
          <line
            x1={pad}
            x2={w - 12}
            y1={10 + (i / 5) * (h - pad - 10)}
            y2={10 + (i / 5) * (h - pad - 10)}
            stroke="#e8ecea"
          />
          {!small && (
            <text
              x={pad - 7}
              y={14 + (i / 5) * (h - pad - 10)}
              textAnchor="end"
            >
              {(max + range * 0.05 - (i / 5) * range).toPrecision(3)}
            </text>
          )}
        </g>
      ))}
      {!small &&
        [0, 0.25, 0.5, 0.75, 1].map((r) => (
          <text
            key={r}
            x={pad + r * (w - pad - 12)}
            y={h - 15}
            textAnchor="middle"
          >
            {(t0 + r * (t1 - t0)).toFixed(2)} წმ
          </text>
        ))}
      <g clipPath={"url(#" + id + ")"}>
        {signals.map((s, j) => {
          if (!s || !s.times.length) return null;
          const path = s.times
            .map(
              (t, i) =>
                (i ? "L" : "M") +
                (
                  pad +
                  ((t - t0) / Math.max(1e-9, t1 - t0)) * (w - pad - 12)
                ).toFixed(2) +
                "," +
                (
                  10 +
                  ((max + range * 0.05 - s.values[i]) / range) * (h - pad - 10)
                ).toFixed(2),
            )
            .join(" ");
          return (
            <path
              key={j}
              d={path}
              stroke={j ? "#d49b55" : "#328d87"}
              strokeWidth={small ? 1.4 : 1.6}
              fill="none"
            />
          );
        })}
        <line
          x1={pad + position * (w - pad - 12)}
          x2={pad + position * (w - pad - 12)}
          y1="10"
          y2={h - pad}
          stroke="#648aaa"
          strokeDasharray="3 4"
        />
      </g>
      {!small && (
        <text x={pad} y="8">
          {units.join(" / ")}
        </text>
      )}
    </svg>
  );
}
export function PacketView({
  packet,
  compact = false,
}: {
  packet?: Packet;
  compact?: boolean;
}) {
  if (!packet) return <span className="no-data">მონაცემები ჯერ არ არის</span>;
  if (packet.type === "signal")
    return <SignalPlot small={compact} signals={[packet.value]} />;
  if (packet.type === "number")
    return (
      <div className="scalar-value">
        {Number(packet.value.toPrecision(5))}
        <small>{packet.unit}</small>
      </div>
    );
  if (packet.type === "boolean")
    return (
      <div className={"boolean-value " + packet.value}>
        {String(packet.value)}
      </div>
    );
  if (packet.type === "text")
    return <div className="text-value">{packet.value}</div>;
  if (packet.type === "vector3")
    return (
      <div className="vector-value">
        {["x", "y", "z"].map((k) => (
          <span key={k}>
            {k.toUpperCase()}
            <b>{packet.value[k as "x"]}</b>
          </span>
        ))}
        <small>{packet.unit}</small>
      </div>
    );
  if (packet.type === "sceneEvent")
    return (
      <div className="packet-value">
        <strong>{packet.value.label}</strong>
        <p>
          {packet.value.starts.length} დაგეგმილი ამოქმედება · დააკავშირეთ
          სცენასთან
        </p>
      </div>
    );
  if (packet.type === "sensor")
    return (
      <div className="packet-caption">
        {packet.value.label} · {packet.value.unit}
        <br />
        სიგნალის მისაღებად დააკავშირეთ სცენასთან
      </div>
    );
  if (packet.type === "scene")
    return (
      <div className="packet-caption">
        {packet.value.dimension}D · {packet.value.objects.length} ობიექტი ·{" "}
        {packet.value.width} × {packet.value.depth} მ
      </div>
    );
  if (packet.type === "event")
    return (
      <div className="events-value">
        <b>{packet.value.length} მოვლენა</b>
        <div>
          {packet.value.slice(0, compact ? 3 : 100).map((t, i) => (
            <span key={i}>
              #{i + 1}
              <code>{t.toFixed(4)} წმ</code>
            </span>
          ))}
        </div>
        {!packet.value.length && (
          <small>ამ დრომდე შესაბამისი მოვლენა არ არის</small>
        )}
      </div>
    );
  if (packet.type === "table")
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {packet.value.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {packet.value.rows.slice(0, compact ? 3 : 100).map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!compact && (
          <small>
            {packet.value.rows.length} სტრიქონი · ნაჩვენებია პირველი 100
          </small>
        )}
      </div>
    );
  return null;
}
