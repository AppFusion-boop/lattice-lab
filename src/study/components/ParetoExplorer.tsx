import React, { useState, useEffect } from "react";
import {
  TrendingUp,
  Sliders,
  Sparkles,
  Info,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Box,
} from "lucide-react";
import { apiGet } from "../api/client";
import { useApi } from "../api/hooks";
import type {
  Study,
  Outcome,
  ParetoResponse,
  ParetoPoint,
} from "../api/types";
import { tr } from "../../i18n";

interface ParetoExplorerProps {
  study: Study;
  outcomes?: Outcome[];
  onSelectCandidate?: (candidate: ParetoPoint) => void;
}

export function ParetoExplorer({
  study,
  outcomes = [],
  onSelectCandidate,
}: ParetoExplorerProps) {
  const continuousOutcomes = outcomes.filter((o) => o.kind === "continuous");

  // Pick first two outcomes by default
  const defaultX = continuousOutcomes[0]?.key || "pressure_drop";
  const defaultY = continuousOutcomes[1]?.key || continuousOutcomes[0]?.key || "t_junction";

  const [xKey, setXKey] = useState<string>(defaultX);
  const [yKey, setYKey] = useState<string>(defaultY);
  const [xDirection, setXDirection] = useState<"minimize" | "maximize">("minimize");
  const [yDirection, setYDirection] = useState<"minimize" | "maximize">("minimize");

  const [selectedPoint, setSelectedPoint] = useState<ParetoPoint | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<ParetoPoint | null>(null);

  const {
    data: paretoData,
    loading,
    error,
    refresh,
  } = useApi<ParetoResponse>(
    `pareto-${study.id}-${xKey}-${yKey}-${xDirection}-${yDirection}`,
    () =>
      apiGet<ParetoResponse>(
        `/studies/${study.id}/pareto?x_outcome=${xKey}&y_outcome=${yKey}&x_direction=${xDirection}&y_direction=${yDirection}`
      )
  );

  const xOutcome = outcomes.find((o) => o.key === xKey);
  const yOutcome = outcomes.find((o) => o.key === yKey);

  // SVG Chart Dimensions
  const width = 640;
  const height = 360;
  const padding = { top: 24, right: 32, bottom: 48, left: 64 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Compute Scales
  const allPoints = paretoData?.all_points || [];
  const frontierPoints = paretoData?.frontier || [];

  const xVals = allPoints.map((p) => p.outcomes[xKey] ?? 0);
  const yVals = allPoints.map((p) => p.outcomes[yKey] ?? 0);

  const minX = xVals.length > 0 ? Math.min(...xVals) : 0;
  const maxX = xVals.length > 0 ? Math.max(...xVals) : 100;
  const minY = yVals.length > 0 ? Math.min(...yVals) : 0;
  const maxY = yVals.length > 0 ? Math.max(...yVals) : 100;

  // Add a 5% margin to ranges
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const domainMinX = minX - rangeX * 0.05;
  const domainMaxX = maxX + rangeX * 0.05;
  const domainMinY = minY - rangeY * 0.05;
  const domainMaxY = maxY + rangeY * 0.05;

  const getSvgX = (val: number) => {
    return padding.left + ((val - domainMinX) / (domainMaxX - domainMinX)) * plotWidth;
  };

  const getSvgY = (val: number) => {
    // Invert for SVG y-coordinates (0 is at top)
    return padding.top + plotHeight - ((val - domainMinY) / (domainMaxY - domainMinY)) * plotHeight;
  };

  // Build Pareto frontier polyline points sorted by x
  const sortedFrontier = [...frontierPoints].sort(
    (a, b) => (a.outcomes[xKey] ?? 0) - (b.outcomes[xKey] ?? 0)
  );
  const frontierPolyline = sortedFrontier
    .map((p) => `${getSvgX(p.outcomes[xKey] ?? 0)},${getSvgY(p.outcomes[yKey] ?? 0)}`)
    .join(" ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Controls & Outcome Axis Selection */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {/* X Axis Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
              {tr("X ღერძი (ჰორიზონტალური):", "X-Axis:")}
            </span>
            <select
              value={xKey}
              onChange={(e) => setXKey(e.target.value)}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: "#fff",
              }}
            >
              {continuousOutcomes.map((o) => (
                <option key={o.id} value={o.key}>
                  {o.label || o.key} ({o.unit || "dimless"})
                </option>
              ))}
            </select>
            <select
              value={xDirection}
              onChange={(e) => setXDirection(e.target.value as "minimize" | "maximize")}
              style={{
                fontSize: 11,
                padding: "4px 6px",
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: "#fff",
              }}
            >
              <option value="minimize">▼ {tr("მინიმიზაცია", "Minimize")}</option>
              <option value="maximize">▲ {tr("მაქსიმიზაცია", "Maximize")}</option>
            </select>
          </div>

          {/* Y Axis Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
              {tr("Y ღერძი (ვერტიკალური):", "Y-Axis:")}
            </span>
            <select
              value={yKey}
              onChange={(e) => setYKey(e.target.value)}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: "#fff",
              }}
            >
              {continuousOutcomes.map((o) => (
                <option key={o.id} value={o.key}>
                  {o.label || o.key} ({o.unit || "dimless"})
                </option>
              ))}
            </select>
            <select
              value={yDirection}
              onChange={(e) => setYDirection(e.target.value as "minimize" | "maximize")}
              style={{
                fontSize: 11,
                padding: "4px 6px",
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: "#fff",
              }}
            >
              <option value="minimize">▼ {tr("მინიმიზაცია", "Minimize")}</option>
              <option value="maximize">▲ {tr("მაქსიმიზაცია", "Maximize")}</option>
            </select>
          </div>
        </div>

        <button
          onClick={() => refresh()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#475569",
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          <span>{tr("განახლება", "Refresh")}</span>
        </button>
      </div>

      {/* Main Scatter & Frontier Explorer */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 300px",
          gap: 16,
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: 16,
        }}
      >
        {/* Left: SVG Canvas */}
        <div style={{ position: "relative" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TrendingUp size={16} color="#0284c7" />
              <strong style={{ fontSize: 13, color: "#0f172a" }}>
                {tr("პარეტოს ოპტიმალური ფრონტირი (Non-Dominated Trade-Off)", "Pareto Optimal Frontier")}
              </strong>
            </div>

            {paretoData && (
              <span style={{ fontSize: 11, color: "#64748b" }}>
                {tr(
                  `${paretoData.frontier_count} ოპტიმალური კანდიდატი (${paretoData.total_candidates}-დან)`,
                  `${paretoData.frontier_count} on frontier of ${paretoData.total_candidates} candidates`
                )}
              </span>
            )}
          </div>

          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{
              width: "100%",
              height: "auto",
              background: "#fafafa",
              borderRadius: 6,
              border: "1px solid #e2e8f0",
            }}
          >
            {/* Grid Lines */}
            <line
              x1={padding.left}
              y1={padding.top + plotHeight / 2}
              x2={padding.left + plotWidth}
              y2={padding.top + plotHeight / 2}
              stroke="#e2e8f0"
              strokeDasharray="4,4"
            />
            <line
              x1={padding.left + plotWidth / 2}
              y1={padding.top}
              x2={padding.left + plotWidth / 2}
              y2={padding.top + plotHeight}
              stroke="#e2e8f0"
              strokeDasharray="4,4"
            />

            {/* Axes */}
            <line
              x1={padding.left}
              y1={padding.top + plotHeight}
              x2={padding.left + plotWidth}
              y2={padding.top + plotHeight}
              stroke="#94a3b8"
              strokeWidth="1.5"
            />
            <line
              x1={padding.left}
              y1={padding.top}
              x2={padding.left}
              y2={padding.top + plotHeight}
              stroke="#94a3b8"
              strokeWidth="1.5"
            />

            {/* X-Axis Ticks & Labels */}
            <text
              x={padding.left}
              y={height - 28}
              fontSize="10"
              fill="#64748b"
              textAnchor="start"
            >
              {minX.toFixed(1)}
            </text>
            <text
              x={padding.left + plotWidth}
              y={height - 28}
              fontSize="10"
              fill="#64748b"
              textAnchor="end"
            >
              {maxX.toFixed(1)}
            </text>
            <text
              x={padding.left + plotWidth / 2}
              y={height - 10}
              fontSize="11"
              fontWeight="600"
              fill="#334155"
              textAnchor="middle"
            >
              {xOutcome?.label || xKey} ({xOutcome?.unit || ""})
            </text>

            {/* Y-Axis Ticks & Labels */}
            <text
              x={padding.left - 8}
              y={padding.top + plotHeight}
              fontSize="10"
              fill="#64748b"
              textAnchor="end"
            >
              {minY.toFixed(1)}
            </text>
            <text
              x={padding.left - 8}
              y={padding.top + 10}
              fontSize="10"
              fill="#64748b"
              textAnchor="end"
            >
              {maxY.toFixed(1)}
            </text>
            <text
              transform={`rotate(-90 ${padding.left - 36} ${padding.top + plotHeight / 2})`}
              x={padding.left - 36}
              y={padding.top + plotHeight / 2}
              fontSize="11"
              fontWeight="600"
              fill="#334155"
              textAnchor="middle"
            >
              {yOutcome?.label || yKey} ({yOutcome?.unit || ""})
            </text>

            {/* Pareto Frontier Connecting Line */}
            {frontierPoints.length > 1 && (
              <polyline
                fill="none"
                stroke="#0284c7"
                strokeWidth="2.5"
                strokeDasharray="4,3"
                points={frontierPolyline}
              />
            )}

            {/* Dominated Points (Slate) */}
            {allPoints
              .filter((p) => p.rank > 1)
              .map((p) => {
                const cx = getSvgX(p.outcomes[xKey] ?? 0);
                const cy = getSvgY(p.outcomes[yKey] ?? 0);
                const isSelected = selectedPoint?.candidate_id === p.candidate_id;

                return (
                  <circle
                    key={p.candidate_id}
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 6 : 3.5}
                    fill={isSelected ? "#f59e0b" : "#94a3b8"}
                    opacity={isSelected ? 1 : 0.45}
                    stroke={isSelected ? "#b45309" : "none"}
                    strokeWidth="1.5"
                    style={{ cursor: "pointer", transition: "all 0.15s ease" }}
                    onMouseEnter={() => setHoveredPoint(p)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onClick={() => {
                      setSelectedPoint(p);
                      if (onSelectCandidate) onSelectCandidate(p);
                    }}
                  />
                );
              })}

            {/* Pareto Frontier Points (Rank 1 - Emerald / Cyan) */}
            {frontierPoints.map((p) => {
              const cx = getSvgX(p.outcomes[xKey] ?? 0);
              const cy = getSvgY(p.outcomes[yKey] ?? 0);
              const isSelected = selectedPoint?.candidate_id === p.candidate_id;

              return (
                <g key={p.candidate_id}>
                  {/* Glowing halo for frontier */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 8 : 6}
                    fill="#10b981"
                    opacity={0.25}
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 5.5 : 4.5}
                    fill={isSelected ? "#f59e0b" : "#059669"}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    style={{ cursor: "pointer", transition: "all 0.15s ease" }}
                    onMouseEnter={() => setHoveredPoint(p)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onClick={() => {
                      setSelectedPoint(p);
                      if (onSelectCandidate) onSelectCandidate(p);
                    }}
                  />
                </g>
              );
            })}
          </svg>

          {/* Quick Hover Tooltip */}
          {hoveredPoint && (
            <div
              style={{
                position: "absolute",
                top: 36,
                right: 12,
                background: "rgba(15, 23, 42, 0.92)",
                color: "#ffffff",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 11,
                pointerEvents: "none",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                backdropFilter: "blur(4px)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {hoveredPoint.label || hoveredPoint.candidate_id}
                {hoveredPoint.rank === 1 && (
                  <span style={{ marginLeft: 6, color: "#34d399", fontWeight: 600 }}>
                    ★ {tr("ფრონტირი", "Frontier")}
                  </span>
                )}
              </div>
              <div>
                {xOutcome?.label || xKey}:{" "}
                <strong>
                  {hoveredPoint.outcomes[xKey]?.toFixed(2)} {xOutcome?.unit || ""}
                </strong>
              </div>
              <div>
                {yOutcome?.label || yKey}:{" "}
                <strong>
                  {hoveredPoint.outcomes[yKey]?.toFixed(2)} {yOutcome?.unit || ""}
                </strong>
              </div>
            </div>
          )}
        </div>

        {/* Right: Selected Candidate Detail Card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            borderLeft: "1px solid #f1f5f9",
            paddingLeft: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#1e293b" }}>
            <Box size={16} color="#0284c7" />
            <h5 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
              {tr("არჩეული კანდიდატი", "Candidate Inspector")}
            </h5>
          </div>

          {selectedPoint ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  padding: "8px 10px",
                  background: selectedPoint.rank === 1 ? "#ecfdf5" : "#f8fafc",
                  border: `1px solid ${selectedPoint.rank === 1 ? "#a7f3d0" : "#e2e8f0"}`,
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: 11, color: "#64748b" }}>ID</div>
                <strong style={{ fontSize: 12, color: "#0f172a" }}>
                  {selectedPoint.label || selectedPoint.candidate_id}
                </strong>
                {selectedPoint.rank === 1 && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#059669",
                    }}
                  >
                    <CheckCircle2 size={12} />
                    <span>{tr("პარეტო-ოპტიმალური (Rank 1)", "Pareto-Optimal (Rank 1)")}</span>
                  </div>
                )}
              </div>

              {/* Outcomes Summary */}
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>
                  {tr("სიმულირებული შედეგები:", "Simulated Outcomes:")}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                  {Object.entries(selectedPoint.outcomes).map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        padding: "3px 6px",
                        background: "#f1f5f9",
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ color: "#475569" }}>{k}:</span>
                      <strong style={{ color: "#0f172a" }}>{Number(v).toFixed(2)}</strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Parameter Settings */}
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>
                  {tr("გეომეტრიის პარამეტრები:", "Design Parameters:")}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                  {Object.entries(selectedPoint.values).map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        padding: "3px 6px",
                        background: "#fafafa",
                        border: "1px solid #f1f5f9",
                        borderRadius: 4,
                      }}
                    >
                      <code style={{ color: "#64748b" }}>{k}:</code>
                      <strong style={{ color: "#1e293b" }}>{String(v)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: "24px 12px",
                textAlign: "center",
                background: "#f8fafc",
                borderRadius: 6,
                border: "1px dashed #cbd5e1",
                color: "#64748b",
                fontSize: 12,
              }}
            >
              <Info size={20} style={{ margin: "0 auto 6px", opacity: 0.6 }} />
              <span>
                {tr(
                  "დააჭირეთ ნებისმიერ წერტილს გრაფიკზე დეტალური პარამეტრების სანახავად.",
                  "Click any point on the chart to inspect its parameters and simulated outcomes."
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

