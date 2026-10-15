import { useState } from "react";
import type { Evidence, Outcome, Parameter } from "../api/types";
import { tr } from "../../i18n";

interface EvidenceScatterPlotProps {
  evidence: Evidence[];
  parameters: Parameter[];
  outcomes: Outcome[];
}

export function EvidenceScatterPlot({
  evidence,
  parameters,
  outcomes,
}: EvidenceScatterPlotProps) {

  // Find continuous/integer parameters for X
  const numericParams = parameters.filter((p) => p.kind === "continuous" || p.kind === "integer");
  const [selectedParamKey, setSelectedParamKey] = useState<string>(
    numericParams[0]?.key || parameters[0]?.key || ""
  );

  // Find continuous outcomes for Y
  const numericOutcomes = outcomes.filter((o) => o.kind === "continuous");
  const [selectedOutcomeKey, setSelectedOutcomeKey] = useState<string>(
    numericOutcomes[0]?.key || outcomes[0]?.key || ""
  );

  const [hoveredPoint, setHoveredPoint] = useState<{
    xVal: number;
    yVal: number;
    sd?: number;
    status: string;
    id: string;
    sourceCitation?: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  const activeParam = parameters.find((p) => p.key === selectedParamKey);
  const activeOutcome = outcomes.find((o) => o.key === selectedOutcomeKey);

  // Extract plottable points
  const points: {
    id: string;
    x: number;
    y: number;
    sd?: number;
    status: string;
    isRetracted: boolean;
  }[] = [];

  for (const ev of evidence) {
    const rawX = ev.values[selectedParamKey];
    const xNum = typeof rawX === "number" ? rawX : parseFloat(String(rawX));
    if (isNaN(xNum)) continue;

    const rawY = ev.outcomes[selectedOutcomeKey];
    let yNum: number | undefined;
    let sdNum: number | undefined;

    if (typeof rawY === "number") {
      yNum = rawY;
    } else if (rawY && typeof rawY === "object") {
      const v = (rawY as { value?: number }).value;
      if (typeof v === "number" && !isNaN(v)) {
        yNum = v;
      }
      const s = (rawY as { sd?: number }).sd;
      if (typeof s === "number" && !isNaN(s)) {
        sdNum = s;
      }
    }

    if (yNum !== undefined && !isNaN(yNum)) {
      points.push({
        id: ev.id,
        x: xNum,
        y: yNum,
        sd: sdNum,
        status: ev.status,
        isRetracted: !!ev.retracted_at,
      });
    }
  }

  // Plot dimensions
  const width = 760;
  const height = 400;
  const padLeft = 70;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 55;

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  if (numericParams.length === 0 || numericOutcomes.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        {tr(
          "გრაფიკის საჩვენებლად საჭიროა მინიმუმ ერთი რიცხვითი პარამეტრი და შედეგი.",
          "At least one numeric parameter and outcome are required to render a scatter plot."
        )}
      </div>
    );
  }

  // Determine domain/range
  const xVals = points.map((p) => p.x);
  const yValsWithSd = points.flatMap((p) => [
    p.y,
    p.sd ? p.y - p.sd : p.y,
    p.sd ? p.y + p.sd : p.y,
  ]);

  let xMin = xVals.length > 0 ? Math.min(...xVals) : 0;
  let xMax = xVals.length > 0 ? Math.max(...xVals) : 10;
  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  }
  const xSpan = (xMax - xMin) * 0.1 || 1;
  xMin -= xSpan;
  xMax += xSpan;

  let yMin = yValsWithSd.length > 0 ? Math.min(...yValsWithSd) : 0;
  let yMax = yValsWithSd.length > 0 ? Math.max(...yValsWithSd) : 10;
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const ySpan = (yMax - yMin) * 0.1 || 1;
  yMin -= ySpan;
  yMax += ySpan;

  const toScreenX = (val: number) => padLeft + ((val - xMin) / (xMax - xMin)) * innerW;
  const toScreenY = (val: number) => padTop + innerH - ((val - yMin) / (yMax - yMin)) * innerH;

  // Axis tick counts
  const xTicks = 6;
  const yTicks = 6;
  const xTickVals = Array.from({ length: xTicks }, (_, i) => xMin + (i * (xMax - xMin)) / (xTicks - 1));
  const yTickVals = Array.from({ length: yTicks }, (_, i) => yMin + (i * (yMax - yMin)) / (yTicks - 1));

  return (
    <div style={{ position: "relative" }}>
      {/* Selector Controls */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>
            {tr("X ღერძი (პარამეტრი):", "X Axis (Parameter):")}
          </label>
          <select
            className="study-form-input"
            style={{ width: 220 }}
            value={selectedParamKey}
            onChange={(e) => setSelectedParamKey(e.target.value)}
          >
            {numericParams.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label || p.key} {p.unit ? `[${p.unit}]` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>
            {tr("Y ღერძი (შედეგი):", "Y Axis (Outcome):")}
          </label>
          <select
            className="study-form-input"
            style={{ width: 220 }}
            value={selectedOutcomeKey}
            onChange={(e) => setSelectedOutcomeKey(e.target.value)}
          >
            {numericOutcomes.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label || o.key} {o.unit ? `[${o.unit}]` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", fontSize: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#16a34a" }} />
            {tr("ვალიდური (Valid)", "Valid")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
            {tr("წარუმატებელი (Failed Run)", "Failed Run")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#dc2626" }} />
            {tr("ამოვარდნილი (Outlier)", "Outlier")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#94a3b8" }} />
            {tr("გაწვეული (Retracted)", "Retracted")}
          </span>
        </div>
      </div>

      {points.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "#64748b", background: "#f8fafc", borderRadius: 8 }}>
          {tr(
            "არჩეული პარამეტრისა და შედეგისთვის მონაცემები არ მოიძებნა.",
            "No data points found with values for both selected parameter and outcome."
          )}
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{
            width: "100%",
            height: "auto",
            background: "#ffffff",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
          onMouseLeave={() => setHoveredPoint(null)}
        >
          {/* Grid lines */}
          {xTickVals.map((val, idx) => {
            const x = toScreenX(val);
            return (
              <g key={`x-grid-${idx}`}>
                <line
                  x1={x}
                  y1={padTop}
                  x2={x}
                  y2={padTop + innerH}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text
                  x={x}
                  y={padTop + innerH + 18}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#64748b"
                  fontFamily="monospace"
                >
                  {val.toFixed(Math.abs(val) < 1 ? 2 : 1)}
                </text>
              </g>
            );
          })}

          {yTickVals.map((val, idx) => {
            const y = toScreenY(val);
            return (
              <g key={`y-grid-${idx}`}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={padLeft + innerW}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text
                  x={padLeft - 10}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="#64748b"
                  fontFamily="monospace"
                >
                  {val.toFixed(Math.abs(val) < 1 ? 2 : 1)}
                </text>
              </g>
            );
          })}

          {/* Axes */}
          <line
            x1={padLeft}
            y1={padTop + innerH}
            x2={padLeft + innerW}
            y2={padTop + innerH}
            stroke="#cbd5e1"
            strokeWidth={1.5}
          />
          <line
            x1={padLeft}
            y1={padTop}
            x2={padLeft}
            y2={padTop + innerH}
            stroke="#cbd5e1"
            strokeWidth={1.5}
          />

          {/* Axis Labels */}
          <text
            x={padLeft + innerW / 2}
            y={height - 12}
            textAnchor="middle"
            fontSize={12}
            fontWeight={500}
            fill="#334155"
          >
            {activeParam?.label || selectedParamKey}
            {activeParam?.unit ? ` (${activeParam.unit})` : ""}
          </text>

          <text
            transform={`rotate(-90)`}
            x={-(padTop + innerH / 2)}
            y={18}
            textAnchor="middle"
            fontSize={12}
            fontWeight={500}
            fill="#334155"
          >
            {activeOutcome?.label || selectedOutcomeKey}
            {activeOutcome?.unit ? ` (${activeOutcome.unit})` : ""}
          </text>

          {/* Error Bars & Data Points */}
          {points.map((pt) => {
            const sx = toScreenX(pt.x);
            const sy = toScreenY(pt.y);

            let color = "#16a34a"; // valid
            if (pt.isRetracted) {
              color = "#94a3b8";
            } else if (pt.status === "failed_run") {
              color = "#f59e0b";
            } else if (pt.status === "outlier") {
              color = "#dc2626";
            }

            return (
              <g key={pt.id}>
                {/* Vertical Error bar if SD exists */}
                {pt.sd !== undefined && pt.sd > 0 && (
                  <g stroke={color} strokeWidth={1.5} opacity={pt.isRetracted ? 0.4 : 0.7}>
                    <line
                      x1={sx}
                      y1={toScreenY(pt.y - pt.sd)}
                      x2={sx}
                      y2={toScreenY(pt.y + pt.sd)}
                    />
                    {/* Top cap */}
                    <line
                      x1={sx - 3}
                      y1={toScreenY(pt.y + pt.sd)}
                      x2={sx + 3}
                      y2={toScreenY(pt.y + pt.sd)}
                    />
                    {/* Bottom cap */}
                    <line
                      x1={sx - 3}
                      y1={toScreenY(pt.y - pt.sd)}
                      x2={sx + 3}
                      y2={toScreenY(pt.y - pt.sd)}
                    />
                  </g>
                )}

                {/* Point */}
                <circle
                  cx={sx}
                  cy={sy}
                  r={5}
                  fill={color}
                  fillOpacity={pt.isRetracted ? 0.4 : 0.85}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  style={{ cursor: "pointer", transition: "transform 0.1s" }}
                  onMouseEnter={() => {
                    setHoveredPoint({
                      xVal: pt.x,
                      yVal: pt.y,
                      sd: pt.sd,
                      status: pt.isRetracted ? "retracted" : pt.status,
                      id: pt.id,
                      screenX: sx,
                      screenY: sy,
                    });
                  }}
                />
              </g>
            );
          })}
        </svg>
      )}

      {/* Floating Tooltip */}
      {hoveredPoint && (
        <div
          style={{
            position: "absolute",
            left: `${hoveredPoint.screenX + 10}px`,
            top: `${hoveredPoint.screenY - 10}px`,
            background: "rgba(15, 23, 42, 0.92)",
            color: "#ffffff",
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 11,
            pointerEvents: "none",
            zIndex: 10,
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>ID: {hoveredPoint.id}</div>
          <div>
            {activeParam?.label || selectedParamKey}: {hoveredPoint.xVal.toFixed(3)}{" "}
            {activeParam?.unit || ""}
          </div>
          <div>
            {activeOutcome?.label || selectedOutcomeKey}: {hoveredPoint.yVal.toFixed(3)}
            {hoveredPoint.sd ? ` ± ${hoveredPoint.sd.toFixed(3)}` : ""}{" "}
            {activeOutcome?.unit || ""}
          </div>
          <div style={{ marginTop: 4, textTransform: "capitalize", opacity: 0.85 }}>
            Status: {hoveredPoint.status}
          </div>
        </div>
      )}
    </div>
  );
}
