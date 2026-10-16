import React, { useState } from "react";
import {
  X,
  Sparkles,
  CheckCircle2,
  TrendingDown,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Database,
} from "lucide-react";
import { apiPost } from "../api/client";
import type {
  Study,
  Parameter,
  Outcome,
  Evidence,
  CalibrationRequest,
  CalibrationResponse,
  CalibrationApplyRequest,
  ModelVersion,
} from "../api/types";
import { tr } from "../../i18n";

interface CalibrationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  study: Study;
  parameters?: Parameter[];
  outcomes?: Outcome[];
  evidence?: Evidence[];
  onModelUpgraded?: () => void;
}

export function CalibrationWizard({
  isOpen,
  onClose,
  study,
  parameters = [],
  outcomes = [],
  evidence = [],
  onModelUpgraded,
}: CalibrationWizardProps) {
  const continuousParams = parameters.filter((p) => p.kind === "continuous");
  const continuousOutcomes = outcomes.filter((o) => o.kind === "continuous");

  const [selectedParamKey, setSelectedParamKey] = useState<string>(
    continuousParams[0]?.key || "w"
  );
  const [selectedOutcomeKey, setSelectedOutcomeKey] = useState<string>(
    continuousOutcomes[0]?.key || "t_junction"
  );

  const selectedParam = parameters.find((p) => p.key === selectedParamKey);
  const spec = (selectedParam?.spec as Record<string, unknown>) || {};
  const defaultMin = typeof spec.min === "number" ? spec.min : 0.05;
  const defaultMax = typeof spec.max === "number" ? spec.max : 2.0;

  const [paramMin, setParamMin] = useState<number>(defaultMin);
  const [paramMax, setParamMax] = useState<number>(defaultMax);
  const [initialGuess, setInitialGuess] = useState<number>(
    typeof spec.value === "number" ? spec.value : (defaultMin + defaultMax) / 2
  );

  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibError, setCalibError] = useState<string | null>(null);
  const [calibResult, setCalibResult] = useState<CalibrationResponse | null>(null);

  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applySuccess, setApplySuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleRunCalibration = async () => {
    setIsCalibrating(true);
    setCalibError(null);
    setCalibResult(null);

    try {
      const payload: CalibrationRequest = {
        parameter_key: selectedParamKey,
        target_outcome: selectedOutcomeKey,
        initial_guess: initialGuess,
        param_bounds: [paramMin, paramMax],
      };

      const res = await apiPost<CalibrationResponse>(
        `/studies/${study.id}/calibrate`,
        payload
      );
      setCalibResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCalibError(msg);
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleApplyCalibration = async () => {
    if (!calibResult) return;
    setIsApplying(true);
    try {
      const payload: CalibrationApplyRequest = {
        parameter_key: calibResult.parameter_key,
        calibrated_value: calibResult.calibrated_value,
        notes: `Calibrated ${calibResult.parameter_key}=${calibResult.calibrated_value} against physical evidence (RMSE ${calibResult.prior_rmse} -> ${calibResult.calibrated_rmse}).`,
      };

      await apiPost<ModelVersion>(`/studies/${study.id}/calibrate/apply`, payload);
      setApplySuccess(true);
      if (onModelUpgraded) {
        onModelUpgraded();
      }
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(tr(`მოდელის განახლება ვერ მოხერხდა: ${msg}`, `Failed to upgrade model: ${msg}`));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          width: "100%",
          maxWidth: 620,
          overflow: "hidden",
          border: "1px solid #e2e8f0",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: "#ecfdf5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#059669",
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                {tr("მოდელის ავტო-კალიბრაცია (Model Auto-Calibration)", "Model Auto-Calibration Wizard")}
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                {tr(
                  "ფიზიკური ლაბორატორიის მტკიცებულებებით მოდელის კოეფიციენტების დაზუსტება.",
                  "Tune unvalidated physics coefficients against physical test bench evidence."
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Target Parameter & Outcome Selection */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                {tr("საკალიბრაციო პარამეტრი:", "Target Parameter:")}
              </label>
              <select
                value={selectedParamKey}
                onChange={(e) => {
                  setSelectedParamKey(e.target.value);
                  const p = parameters.find((param) => param.key === e.target.value);
                  const s = (p?.spec as Record<string, unknown>) || {};
                  if (typeof s.min === "number") setParamMin(s.min);
                  if (typeof s.max === "number") setParamMax(s.max);
                }}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  background: "#fff",
                }}
              >
                {continuousParams.map((p) => (
                  <option key={p.id} value={p.key}>
                    {p.label || p.key} ({p.unit || "-"})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                {tr("სამიზნე გაზომილი შედეგი:", "Measured Benchmark Outcome:")}
              </label>
              <select
                value={selectedOutcomeKey}
                onChange={(e) => setSelectedOutcomeKey(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  background: "#fff",
                }}
              >
                {continuousOutcomes.map((o) => (
                  <option key={o.id} value={o.key}>
                    {o.label || o.key} ({o.unit || "-"})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Bounds & Prior Guess */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>
                {tr("საწყისი ვარაუდი (Prior):", "Prior Guess:")}
              </label>
              <input
                type="number"
                step="0.01"
                value={initialGuess}
                onChange={(e) => setInitialGuess(parseFloat(e.target.value) || 0)}
                style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>
                Min Bound:
              </label>
              <input
                type="number"
                step="0.01"
                value={paramMin}
                onChange={(e) => setParamMin(parseFloat(e.target.value) || 0)}
                style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>
                Max Bound:
              </label>
              <input
                type="number"
                step="0.01"
                value={paramMax}
                onChange={(e) => setParamMax(parseFloat(e.target.value) || 0)}
                style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 12 }}
              />
            </div>
          </div>

          {/* Trigger Button */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleRunCalibration}
              disabled={isCalibrating}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: isCalibrating ? "#94a3b8" : "#0284c7",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 600,
                cursor: isCalibrating ? "not-allowed" : "pointer",
              }}
            >
              <RefreshCw size={14} className={isCalibrating ? "animate-spin" : ""} />
              <span>
                {isCalibrating
                  ? tr("ოპტიმიზაცია მიმდინარეობს...", "Calibrating Least Squares...")
                  : tr("კალიბრაციის გაშვება", "Run Least Squares Calibration")}
              </span>
            </button>
          </div>

          {calibError && (
            <div
              style={{
                padding: "10px 14px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 6,
                color: "#b91c1c",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AlertCircle size={16} />
              <span>{calibError}</span>
            </div>
          )}

          {/* Results Comparison Card */}
          {calibResult && (
            <div
              style={{
                padding: "16px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#166534", fontWeight: 700, fontSize: 13 }}>
                  <CheckCircle2 size={16} />
                  <span>{tr("კალიბრაცია წარმატებით დასრულდა", "Calibration Converged Successfully")}</span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: "#dcfce7",
                    color: "#15803d",
                  }}
                >
                  RMSE -{calibResult.rmse_reduction_pct}%
                </span>
              </div>

              {/* Parameter Metric Progression */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  alignItems: "center",
                  gap: 12,
                  background: "#ffffff",
                  padding: "12px 16px",
                  borderRadius: 6,
                  border: "1px solid #dcfce7",
                }}
              >
                <div>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{tr("საწყისი მნიშვნელობა (Prior):", "Prior Guess:")}</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#475569" }}>
                    {calibResult.prior_value} {selectedParam?.unit || ""}
                  </div>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>
                    Prior RMSE: {calibResult.prior_rmse}
                  </span>
                </div>

                <ArrowRight size={20} color="#16a34a" />

                <div>
                  <span style={{ fontSize: 11, color: "#166534", fontWeight: 600 }}>
                    {tr("დაკალიბრებული (Calibrated Posterior):", "Calibrated Value:")}
                  </span>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#15803d" }}>
                    {calibResult.calibrated_value} {selectedParam?.unit || ""}
                  </div>
                  <span style={{ fontSize: 10, color: "#166534" }}>
                    95% CI: [{calibResult.ci_95[0]}, {calibResult.ci_95[1]}]
                  </span>
                </div>
              </div>

              <div style={{ fontSize: 11, color: "#15803d", lineHeight: 1.4 }}>
                {tr(
                  `მოდელის პროგნოზის ცდომილება (RMSE) შემცირდა ${calibResult.prior_rmse}-დან ${calibResult.calibrated_rmse}-მდე (${calibResult.n_evidence_points} ფიზიკურ დაკვირვებაზე). მოდელის ახალ ვერსიაზე გადაყვანით მისი ვალიდაციის სტატუსი გახდება 'Validated'.`,
                  `Residual Mean Squared Error reduced from ${calibResult.prior_rmse} to ${calibResult.calibrated_rmse} across ${calibResult.n_evidence_points} physical observations. Upgrading creates a validated ModelVersion (Hard Rule 6 satisfied).`
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 20px",
            background: "#f8fafc",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            {applySuccess && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#16a34a", display: "inline-flex", gap: 4, alignItems: "center" }}>
                <CheckCircle2 size={14} />
                {tr("ახალი ვალიდირებული მოდელი შენახულია!", "New Validated Model Version Created!")}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 14px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {tr("დახურვა", "Cancel")}
            </button>

            {calibResult && (
              <button
                type="button"
                onClick={handleApplyCalibration}
                disabled={isApplying || applySuccess}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  background: isApplying ? "#94a3b8" : "#16a34a",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isApplying || applySuccess ? "not-allowed" : "pointer",
                }}
              >
                <ShieldCheck size={14} />
                <span>
                  {isApplying
                    ? tr("ვერსია იქმნება...", "Upgrading Model...")
                    : tr("დადასტურება და მოდელის განახლება", "Apply & Upgrade Model Version")}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

