import React, { useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Sparkles,
  Info,
} from "lucide-react";
import { apiPost, apiPatch } from "../api/client";
import { useApi } from "../api/hooks";
import type {
  Study,
  Outcome,
  Parameter,
  SensitivityResponse,
  SensitivityRequest,
} from "../api/types";
import { tr } from "../../i18n";

interface TornadoChartProps {
  study: Study;
  outcomes?: Outcome[];
  parameters?: Parameter[];
  onParameterUpdated?: () => void;
}

export function TornadoChart({
  study,
  outcomes = [],
  parameters = [],
  onParameterUpdated,
}: TornadoChartProps) {
  // Select first continuous outcome by default
  const defaultOutcome = outcomes.find((o) => o.kind === "continuous") || outcomes[0];
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string>(defaultOutcome?.id || "");
  const [nSamples, setNSamples] = useState<number>(64);
  const [freezingThreshold, setFreezingThreshold] = useState<number>(0.05);
  const [isComputing, setIsComputing] = useState<boolean>(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [sensitivityData, setSensitivityData] = useState<SensitivityResponse | null>(null);
  const [freezingInProgress, setFreezingInProgress] = useState<Record<string, boolean>>({});
  const [frozenSuccess, setFrozenSuccess] = useState<Record<string, boolean>>({});

  const activeOutcome = outcomes.find((o) => o.id === selectedOutcomeId) || defaultOutcome;

  const handleCompute = async () => {
    if (!activeOutcome) return;
    setIsComputing(true);
    setComputeError(null);

    try {
      const payload: SensitivityRequest = {
        outcome_id: activeOutcome.id,
        n_samples: nSamples,
        freezing_threshold: freezingThreshold,
        seed: study.rng_seed || 42,
      };

      const result = await apiPost<SensitivityResponse>(
        `/studies/${study.id}/sensitivity`,
        payload
      );
      setSensitivityData(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setComputeError(msg);
    } finally {
      setIsComputing(false);
    }
  };

  const handleFreezeParameter = async (
    paramId: string,
    suggestedValue: number
  ) => {
    const targetParam = parameters.find((p) => p.id === paramId);
    if (!targetParam) return;

    setFreezingInProgress((prev) => ({ ...prev, [paramId]: true }));
    try {
      const updatedSpec = {
        ...targetParam.spec,
        value: suggestedValue,
      };
      await apiPatch(`/parameters/${paramId}`, {
        role: "fixed",
        spec: updatedSpec,
      });

      setFrozenSuccess((prev) => ({ ...prev, [paramId]: true }));
      if (onParameterUpdated) {
        onParameterUpdated();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(tr(`პარამეტრის დაფიქსირება ვერ მოხერხდა: ${msg}`, `Failed to freeze parameter: ${msg}`));
    } finally {
      setFreezingInProgress((prev) => ({ ...prev, [paramId]: false }));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Control Header */}
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Activity size={16} color="#0284c7" />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>
              {tr("სამიზნე შედეგი (Outcome):", "Target Outcome:")}
            </span>
            <select
              value={selectedOutcomeId}
              onChange={(e) => {
                setSelectedOutcomeId(e.target.value);
                setSensitivityData(null);
              }}
              style={{
                fontSize: 13,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#0f172a",
              }}
            >
              {outcomes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label || o.key} ({o.unit || "dimless"})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {tr("სემპლები (N):", "Samples (N):")}
            </span>
            <select
              value={nSamples}
              onChange={(e) => setNSamples(Number(e.target.value))}
              style={{
                fontSize: 12,
                padding: "3px 6px",
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: "#fff",
              }}
            >
              <option value={32}>32 ({tr("სწრაფი", "Fast")})</option>
              <option value={64}>64 ({tr("რეკომენდებული", "Recommended")})</option>
              <option value={128}>128 ({tr("მაღალი სიზუსტე", "High Accuracy")})</option>
              <option value={256}>256 ({tr("სრული კვლევა", "Full Study")})</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {tr("გაყინვის ზღვარი:", "Freezing Threshold:")}
            </span>
            <select
              value={freezingThreshold}
              onChange={(e) => setFreezingThreshold(Number(e.target.value))}
              style={{
                fontSize: 12,
                padding: "3px 6px",
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: "#fff",
              }}
            >
              <option value={0.03}>3%</option>
              <option value={0.05}>5% ({tr("სტანდარტული", "Standard")})</option>
              <option value={0.08}>8%</option>
              <option value={0.10}>10%</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleCompute}
          disabled={isComputing || !activeOutcome}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: "#ffffff",
            background: isComputing ? "#94a3b8" : "#0284c7",
            border: "none",
            borderRadius: 6,
            cursor: isComputing ? "not-allowed" : "pointer",
            transition: "background 0.15s ease",
          }}
        >
          <RefreshCw size={14} className={isComputing ? "animate-spin" : ""} />
          <span>
            {isComputing
              ? tr("სობოლის ანალიზი მიმდინარეობს...", "Computing Sobol Analysis...")
              : tr("მგრძნობელობის გამოთვლა", "Compute Global Sensitivity")}
          </span>
        </button>
      </div>

      {computeError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          <AlertCircle size={16} />
          <span>{computeError}</span>
        </div>
      )}

      {/* Main Tornado Chart Canvas */}
      {sensitivityData ? (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "16px 20px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
              borderBottom: "1px solid #f1f5f9",
              paddingBottom: 10,
            }}
          >
            <div>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                {tr("გლობალური მგრძნობელობის ტორნადო დიაგრამა", "Global Sensitivity Tornado Ranking")}
              </h4>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
                {tr(
                  `სობოლის ანალიზი (${sensitivityData.n_evaluations} შეფასება, N=${sensitivityData.n_samples}): აჩვენებს რომელი პარამეტრები განსაზღვრავენ შედეგის ვარიაციას.`,
                  `Sobol Sensitivity (${sensitivityData.n_evaluations} evaluations, N=${sensitivityData.n_samples}): Dissects parameter contributions to total variance.`
                )}
              </p>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 10, height: 10, background: "#10b981", borderRadius: 2 }} />
                <span>{tr("დომინანტი (>20%)", "Dominant (>20%)")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 10, height: 10, background: "#0ea5e9", borderRadius: 2 }} />
                <span>{tr("საშუალო (5-20%)", "Moderate (5-20%)")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 10, height: 10, background: "#94a3b8", borderRadius: 2 }} />
                <span>{tr("უმნიშვნელო (<5%)", "Negligible (<5%)")}</span>
              </div>
            </div>
          </div>

          {/* Tornado Bars List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {sensitivityData.parameters.map((p, idx) => {
              const totalPct = Math.round(p.total_order * 100);
              const firstPct = Math.round(p.first_order * 100);
              const ciLowPct = Math.round(p.ci_95[0] * 100);
              const ciHighPct = Math.round(p.ci_95[1] * 100);

              const isDominant = p.total_order >= 0.20;
              const isModerate = p.total_order >= freezingThreshold && p.total_order < 0.20;
              const isNegligible = p.total_order < freezingThreshold;

              const barColor = isDominant ? "#10b981" : isModerate ? "#0ea5e9" : "#94a3b8";

              return (
                <div key={p.param_id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 13,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "#f1f5f9",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#475569",
                        }}
                      >
                        {idx + 1}
                      </span>
                      <strong style={{ color: "#1e293b" }}>{p.name}</strong>
                      <code style={{ fontSize: 11, color: "#64748b", background: "#f8fafc", padding: "1px 4px", borderRadius: 3 }}>
                        {p.key}
                      </code>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>
                        S₁: <strong>{firstPct}%</strong> | S_T: <strong>{totalPct}%</strong>
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontWeight: 600,
                          background: isDominant ? "#dcfce7" : isModerate ? "#e0f2fe" : "#f1f5f9",
                          color: isDominant ? "#15803d" : isModerate ? "#0369a1" : "#475569",
                        }}
                      >
                        {isDominant
                          ? tr("მთავარი ფაქტორი", "Primary Driver")
                          : isModerate
                          ? tr("საშუალო ფაქტორი", "Secondary Driver")
                          : tr("გაყინვადი", "Freeze Candidate")}
                      </span>
                    </div>
                  </div>

                  {/* SVG Bar with 95% Confidence Interval Whisker */}
                  <div style={{ position: "relative", width: "100%", height: 26 }}>
                    <svg width="100%" height="26" style={{ borderRadius: 4, background: "#f8fafc", overflow: "visible" }}>
                      {/* Grid lines at 25%, 50%, 75% */}
                      <line x1="25%" y1="0" x2="25%" y2="26" stroke="#e2e8f0" strokeDasharray="3,3" />
                      <line x1="50%" y1="0" x2="50%" y2="26" stroke="#e2e8f0" strokeDasharray="3,3" />
                      <line x1="75%" y1="0" x2="75%" y2="26" stroke="#e2e8f0" strokeDasharray="3,3" />

                      {/* Main Bar (Total Order S_T) */}
                      <rect
                        x="0"
                        y="4"
                        width={`${Math.min(100, Math.max(1, totalPct))}%`}
                        height="18"
                        fill={barColor}
                        rx="3"
                        opacity={0.88}
                      />

                      {/* Inner Bar (First Order S_1) */}
                      <rect
                        x="0"
                        y="8"
                        width={`${Math.min(100, Math.max(1, firstPct))}%`}
                        height="10"
                        fill="#ffffff"
                        opacity={0.35}
                        rx="2"
                      />

                      {/* 95% CI Whisker */}
                      <line
                        x1={`${Math.max(0, ciLowPct)}%`}
                        y1="13"
                        x2={`${Math.min(100, ciHighPct)}%`}
                        y2="13"
                        stroke="#0f172a"
                        strokeWidth="1.5"
                      />
                      <line
                        x1={`${Math.max(0, ciLowPct)}%`}
                        y1="8"
                        x2={`${Math.max(0, ciLowPct)}%`}
                        y2="18"
                        stroke="#0f172a"
                        strokeWidth="1.5"
                      />
                      <line
                        x1={`${Math.min(100, ciHighPct)}%`}
                        y1="8"
                        x2={`${Math.min(100, ciHighPct)}%`}
                        y2="18"
                        stroke="#0f172a"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
                    <span>0%</span>
                    <span>95% CI: [{ciLowPct}%, {ciHighPct}%]</span>
                    <span>100%</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Smart Freezing Recommendations Section */}
          {sensitivityData.freezing_recommendations &&
            sensitivityData.freezing_recommendations.length > 0 && (
              <div
                style={{
                  marginTop: 24,
                  padding: "16px",
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Sparkles size={16} color="#16a34a" />
                  <strong style={{ fontSize: 14, color: "#166534" }}>
                    {tr(
                      "გონივრული გაყინვის რეკომენდაციები (Smart Parameter Freezing)",
                      "Smart Parameter Freezing Recommendations"
                    )}
                  </strong>
                </div>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: "#15803d" }}>
                  {tr(
                    "შემდეგი პარამეტრები ახდენენ მინიმალურ (<5%) გავლენას სამიზნე შედეგზე. მათი ნომინალურ მნიშვნელობაზე გაყინვა შეამცირებს ექსპერიმენტულ მატრიცას და საგრძნობლად დაზოგავს დამზადების ხარჯს.",
                    "The following parameters have negligible impact on this outcome. Freezing them removes redundant DoE search dimensions and avoids expensive multi-tooling."
                  )}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sensitivityData.freezing_recommendations.map((rec) => {
                    const isFrozen = frozenSuccess[rec.param_id];
                    const inProgress = freezingInProgress[rec.param_id];

                    return (
                      <div
                        key={rec.param_id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          background: "#ffffff",
                          border: "1px solid #dcfce7",
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <strong style={{ fontSize: 13, color: "#1e293b" }}>{rec.name}</strong>
                            <code style={{ fontSize: 11, color: "#64748b" }}>{rec.key}</code>
                            <span style={{ fontSize: 12, color: "#166534", fontWeight: 600 }}>
                              → {tr("ნომინალური:", "Nominal:")} {rec.suggested_value} {rec.unit || ""}
                            </span>
                          </div>
                          <span style={{ fontSize: 11, color: "#475569" }}>{rec.reason}</span>
                        </div>

                        <div>
                          {isFrozen ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 12,
                                fontWeight: 600,
                                color: "#16a34a",
                              }}
                            >
                              <CheckCircle2 size={14} />
                              {tr("დაფიქსირებულია", "Frozen")}
                            </span>
                          ) : (
                            <button
                              onClick={() => handleFreezeParameter(rec.param_id, rec.suggested_value)}
                              disabled={inProgress}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "6px 12px",
                                fontSize: 12,
                                fontWeight: 600,
                                color: "#ffffff",
                                background: inProgress ? "#94a3b8" : "#16a34a",
                                border: "none",
                                borderRadius: 6,
                                cursor: inProgress ? "not-allowed" : "pointer",
                              }}
                            >
                              <Lock size={12} />
                              <span>
                                {inProgress
                                  ? tr("ფიქსირდება...", "Freezing...")
                                  : tr(`გაყინვა (${rec.suggested_value} ${rec.unit || ""})`, `Freeze to ${rec.suggested_value} ${rec.unit || ""}`)}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        </div>
      ) : (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            background: "#ffffff",
            border: "1px dashed #cbd5e1",
            borderRadius: 8,
            color: "#64748b",
          }}
        >
          <Info size={28} style={{ margin: "0 auto 8px", opacity: 0.6 }} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
            {tr(
              "დააჭირეთ 'მგრძნობელობის გამოთვლას' სობოლის გლობალური ინდექსების დასათვლელად.",
              "Click 'Compute Global Sensitivity' to generate the Sobol tornado ranking and identify freezing candidates."
            )}
          </p>
        </div>
      )}
    </div>
  );
}

