import { useState, useMemo } from "react";
import type { Candidate, Parameter } from "../api/types";
import { tr } from "../../i18n";

interface PhaseDiagram2DProps {
  candidates: Candidate[];
  parameters: Parameter[];
  recommendedIds?: Set<string>;
}

const STATUS_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  tested_pass: { fill: "#10b981", stroke: "#047857", label: "Tested Pass (Viable)" },
  recommended: { fill: "#3b82f6", stroke: "#1d4ed8", label: "Recommended Next Batch" },
  open: { fill: "#f59e0b", stroke: "#b45309", label: "Open / Boundary Frontier" },
  deprioritised: { fill: "#94a3b8", stroke: "#64748b", label: "Deprioritised (Unvalidated / Dominated)" },
  tested_fail: { fill: "#ef4444", stroke: "#b91c1c", label: "Tested Fail" },
  excluded_stat: { fill: "#fca5a5", stroke: "#dc2626", label: "Excluded at Confidence (Model / GP)" },
  excluded_constraint: { fill: "#334155", stroke: "#0f172a", label: "Violates Hard Constraint" },
};

export function PhaseDiagram2D({
  candidates,
  parameters,
  recommendedIds,
}: PhaseDiagram2DProps) {
  const controlled = useMemo(
    () => parameters.filter((p) => p.role === "controlled"),
    [parameters]
  );

  const [xKey, setXKey] = useState<string>(controlled[0]?.key || "");
  const [yKey, setYKey] = useState<string>(controlled[1]?.key || controlled[0]?.key || "");

  const activeX = xKey || controlled[0]?.key || "";
  const activeY = yKey || controlled[1]?.key || controlled[0]?.key || "";

  const xParam = controlled.find((p) => p.key === activeX);
  const yParam = controlled.find((p) => p.key === activeY);

  const points = useMemo(() => {
    if (!activeX || !activeY) return [];
    return candidates
      .map((c) => {
        const xv = Number(c.values[activeX]);
        const yv = Number(c.values[activeY]);
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) return null;
        const st = c.decision?.status || "open";
        const flt = c.decision?.filter || "none";
        let category = st as string;
        if (recommendedIds?.has(c.id) || st === "recommended") {
          category = "recommended";
        } else if (st === "excluded") {
          category = flt === "constraint" ? "excluded_constraint" : "excluded_stat";
        }
        return {
          cand: c,
          x: xv,
          y: yv,
          category,
          pHat: c.decision?.p_hat,
          pUpper: c.decision?.p_upper,
          reason: c.decision?.reason || "",
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [candidates, activeX, activeY, recommendedIds]);

  if (controlled.length === 0) {
    return (
      <div style={{ padding: 20, color: "#64748b", fontSize: 13 }}>
        {tr("2D ფაზური დიაგრამისთვის საჭიროა მართვადი პარამეტრები.", "Add controlled parameters to view the 2D Operating Envelope Phase Diagram.")}
      </div>
    );
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 1;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const width = 640;
  const height = 340;
  const pad = { top: 24, right: 28, bottom: 48, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const toSvgX = (v: number) => pad.left + ((v - minX) / spanX) * plotW;
  const toSvgY = (v: number) => pad.top + plotH - ((v - minY) / spanY) * plotH;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <strong>X Axis:</strong>
            <select
              value={activeX}
              onChange={(e) => setXKey(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
            >
              {controlled.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label || p.key} {p.unit ? `[${p.unit}]` : ""}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <strong>Y Axis:</strong>
            <select
              value={activeY}
              onChange={(e) => setYKey(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
            >
              {controlled.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label || p.key} {p.unit ? `[${p.unit}]` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11 }}>
          {Object.entries(STATUS_COLORS).map(([key, cfg]) => (
            <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#475569" }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: cfg.fill,
                  border: `1.5px solid ${cfg.stroke}`,
                }}
              />
              <span>{cfg.label}</span>
            </span>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: "100%",
          maxWidth: width,
          height: "auto",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
        }}
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const gx = pad.left + t * plotW;
          const gy = pad.top + (1 - t) * plotH;
          const xv = minX + t * spanX;
          const yv = minY + t * spanY;
          return (
            <g key={t}>
              <line x1={gx} y1={pad.top} x2={gx} y2={pad.top + plotH} stroke="#e2e8f0" strokeDasharray="3,3" />
              <line x1={pad.left} y1={gy} x2={pad.left + plotW} y2={gy} stroke="#e2e8f0" strokeDasharray="3,3" />
              <text x={gx} y={pad.top + plotH + 16} textAnchor="middle" fontSize={10} fill="#64748b">
                {xv.toFixed(2)}
              </text>
              <text x={pad.left - 8} y={gy + 3} textAnchor="end" fontSize={10} fill="#64748b">
                {yv.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text
          x={pad.left + plotW / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="#334155"
        >
          {xParam?.label || activeX} {xParam?.unit ? `[${xParam.unit}]` : ""}
        </text>
        <text
          x={16}
          y={pad.top + plotH / 2}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="#334155"
          transform={`rotate(-90, 16, ${pad.top + plotH / 2})`}
        >
          {yParam?.label || activeY} {yParam?.unit ? `[${yParam.unit}]` : ""}
        </text>

        {/* Candidate points */}
        {points.map((pt) => {
          const cx = toSvgX(pt.x);
          const cy = toSvgY(pt.y);
          const cfg = STATUS_COLORS[pt.category] || STATUS_COLORS.open;
          const isRec = pt.category === "recommended";
          return (
            <g key={pt.cand.id}>
              <circle
                cx={cx}
                cy={cy}
                r={isRec ? 7 : 5}
                fill={cfg.fill}
                stroke={cfg.stroke}
                strokeWidth={isRec ? 2.2 : 1.2}
                opacity={0.9}
              >
                <title>
                  {`#${pt.cand.idx} (${activeX}=${pt.x}, ${activeY}=${pt.y}) — ${pt.category}` +
                    (pt.pHat != null ? ` | p_hat=${pt.pHat}` : "") +
                    (pt.pUpper != null ? ` | p_upper=${pt.pUpper}` : "") +
                    (pt.reason ? `\n${pt.reason}` : "")}
                </title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

