import React, { useState, useEffect } from "react";
import {
  X,
  FlaskConical,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Info,
  Calendar,
  User,
  FileText,
  Sliders,
  Scale,
  RefreshCw,
  TrendingDown,
} from "lucide-react";
import { apiPost } from "../api/client";
import type {
  Study,
  Parameter,
  Outcome,
  Candidate,
  Evidence,
  EvidenceCreate,
} from "../api/types";
import { tr } from "../../i18n";
import {
  getCompatibleUnits,
  formatUnitConversionPreview,
  convertUnitValue,
  normalizeUnitSymbol,
} from "../units";

interface RecordExperimentModalProps {
  isOpen: boolean;
  onClose: () => void;
  study: Study;
  candidate?: Candidate | null;
  candidates?: Candidate[];
  parameters: Parameter[];
  outcomes: Outcome[];
  existingEvidenceCount?: number;
  onEvidenceRecorded?: (newEvidence: Evidence) => void;
  onOpenCalibration?: () => void;
}

export function RecordExperimentModal({
  isOpen,
  onClose,
  study,
  candidate,
  candidates = [],
  parameters,
  outcomes,
  existingEvidenceCount = 0,
  onEvidenceRecorded,
  onOpenCalibration,
}: RecordExperimentModalProps) {
  const [selectedCand, setSelectedCand] = useState<Candidate | null>(candidate || null);

  // Parameter states: { [key]: { rawValue: string, selectedUnit: string } }
  const [paramInputs, setParamInputs] = useState<
    Record<string, { rawValue: string; selectedUnit: string }>
  >({});

  // Outcome states: { [key]: { rawValue: string, selectedUnit: string, sd: string, n: string } }
  const [outcomeInputs, setOutcomeInputs] = useState<
    Record<string, { rawValue: string; selectedUnit: string; sd: string; n: string }>
  >({});

  // Metadata
  const [kind, setKind] = useState<"lab" | "field" | "literature" | "simulation" | "expert">("lab");
  const [runTag, setRunTag] = useState("");
  const [recordedBy, setRecordedBy] = useState("lab-researcher");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"valid" | "failed_run" | "outlier">("valid");
  const [statusReason, setStatusReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recordedSuccess, setRecordedSuccess] = useState<Evidence | null>(null);

  // Initialize form whenever modal opens or selected candidate changes
  useEffect(() => {
    if (!isOpen) {
      setRecordedSuccess(null);
      setErrorMessage(null);
      return;
    }

    const curCand = candidate || null;
    setSelectedCand(curCand);

    const initParams: Record<string, { rawValue: string; selectedUnit: string }> = {};
    for (const p of parameters) {
      let initialVal = "";
      if (curCand && curCand.values[p.key] !== undefined) {
        initialVal = String(curCand.values[p.key]);
      } else if (p.role === "fixed") {
        const spec = (p.spec as Record<string, unknown>) || {};
        if (spec.value !== undefined) initialVal = String(spec.value);
      }
      initParams[p.key] = {
        rawValue: initialVal,
        selectedUnit: p.unit || "",
      };
    }
    setParamInputs(initParams);

    const initOutcomes: Record<
      string,
      { rawValue: string; selectedUnit: string; sd: string; n: string }
    > = {};
    for (const o of outcomes) {
      initOutcomes[o.key] = {
        rawValue: "",
        selectedUnit: o.unit || "",
        sd: "",
        n: "1",
      };
    }
    setOutcomeInputs(initOutcomes);
    setRunTag(curCand ? `RUN-CAND-${curCand.idx}` : `BENCH-RUN-${Date.now().toString().slice(-4)}`);
  }, [isOpen, candidate, parameters, outcomes]);

  if (!isOpen) return null;

  const controlledParams = parameters.filter((p) => p.role === "controlled");
  const uncertainParams = parameters.filter((p) => p.role === "uncertain");
  const fixedParams = parameters.filter((p) => p.role === "fixed");

  // Handle switching selected candidate
  const handleSelectCandidate = (candId: string) => {
    if (!candId) {
      setSelectedCand(null);
      return;
    }
    const found = candidates.find((c) => c.id === candId);
    if (found) {
      setSelectedCand(found);
      const updated = { ...paramInputs };
      for (const p of controlledParams) {
        if (found.values[p.key] !== undefined) {
          updated[p.key] = {
            rawValue: String(found.values[p.key]),
            selectedUnit: p.unit || "",
          };
        }
      }
      setParamInputs(updated);
      setRunTag(`RUN-CAND-${found.idx}`);
    }
  };

  // Evaluate whether outcome satisfies criterion
  const evaluateCriterion = (
    outcome: Outcome,
    convertedValue: number
  ): { passes: boolean; text: string } | null => {
    const crit = outcome.criterion;
    if (!crit) return null;

    let passes = false;
    let targetDesc = "";
    const op = crit.op;
    const unitStr = outcome.unit ? ` ${outcome.unit}` : "";

    if (op === "<" && typeof crit.value === "number") {
      passes = convertedValue < crit.value;
      targetDesc = `< ${crit.value}${unitStr}`;
    } else if (op === "<=" && typeof crit.value === "number") {
      passes = convertedValue <= crit.value;
      targetDesc = `<= ${crit.value}${unitStr}`;
    } else if (op === ">" && typeof crit.value === "number") {
      passes = convertedValue > crit.value;
      targetDesc = `> ${crit.value}${unitStr}`;
    } else if (op === ">=" && typeof crit.value === "number") {
      passes = convertedValue >= crit.value;
      targetDesc = `>= ${crit.value}${unitStr}`;
    } else if (op === "between" && typeof crit.low === "number" && typeof crit.high === "number") {
      passes = convertedValue >= crit.low && convertedValue <= crit.high;
      targetDesc = `between [${crit.low}, ${crit.high}]${unitStr}`;
    } else if ((op === "equals" || (op as string) === "==") && typeof crit.value === "number") {
      passes = Math.abs(convertedValue - crit.value) < 1e-6;
      targetDesc = `== ${crit.value}${unitStr}`;
    } else {
      return null;
    }

    const valFormatted = Math.abs(convertedValue) >= 10000 || (Math.abs(convertedValue) < 0.01 && convertedValue !== 0)
      ? convertedValue.toPrecision(4)
      : Number(convertedValue.toFixed(4)).toString();

    if (passes) {
      return {
        passes: true,
        text: tr(
          `✓ აკმაყოფილებს მიზანს (${valFormatted} ${targetDesc})`,
          `✓ Meets Criterion (${valFormatted} ${targetDesc})`
        ),
      };
    }

    // Meaningful failure descriptions depending on operator direction:
    if (op === ">" || op === ">=") {
      return {
        passes: false,
        text: tr(
          `✗ ჩამორჩება მინიმალურ ზღვარს (${valFormatted} vs ${targetDesc})`,
          `✗ Below Minimum Threshold (${valFormatted} vs ${targetDesc})`
        ),
      };
    } else if (op === "<" || op === "<=") {
      return {
        passes: false,
        text: tr(
          `✗ აღემატება მაქსიმალურ ზღვარს (${valFormatted} vs ${targetDesc})`,
          `✗ Exceeds Maximum Allowable (${valFormatted} vs ${targetDesc})`
        ),
      };
    } else if (op === "between") {
      return {
        passes: false,
        text: tr(
          `✗ სამიზნე დიაპაზონს გარეთაა (${valFormatted} vs ${targetDesc})`,
          `✗ Outside Target Range (${valFormatted} vs ${targetDesc})`
        ),
      };
    } else {
      return {
        passes: false,
        text: tr(
          `✗ არ ემთხვევა სამიზნეს (${valFormatted} vs ${targetDesc})`,
          `✗ Does Not Match Target (${valFormatted} vs ${targetDesc})`
        ),
      };
    }
  };

  const handleSaveExperiment = async () => {
    setErrorMessage(null);
    setSubmitting(true);

    try {
      // 1. Validate and convert controlled parameters
      const cleanValues: Record<string, any> = {};

      for (const p of controlledParams) {
        const field = paramInputs[p.key];
        const raw = field?.rawValue?.trim();
        if (!raw && raw !== "0") {
          throw new Error(
            tr(
              `სავალდებულო პარამეტრი '${p.label || p.key}' შევსებული არ არის.`,
              `Controlled parameter '${p.label || p.key}' must be provided for a real experiment.`
            )
          );
        }

        const numVal = parseFloat(raw);
        if (isNaN(numVal)) {
          throw new Error(`Invalid numeric value for parameter '${p.label || p.key}': ${raw}`);
        }

        // Convert to canonical unit if needed
        const fromUnit = field.selectedUnit;
        const toUnit = p.unit || "";
        const converted = convertUnitValue(numVal, fromUnit, toUnit);
        const finalVal = p.kind === "integer" ? Math.round(converted) : converted;

        cleanValues[p.key] = {
          value: finalVal,
          unit: toUnit,
          original_value: numVal,
          original_unit: fromUnit,
        };
      }

      // 2. Add uncertain parameters ONLY if measured (NO GUESSING!)
      for (const p of uncertainParams) {
        const field = paramInputs[p.key];
        const raw = field?.rawValue?.trim();
        if (raw !== undefined && raw !== "") {
          const numVal = parseFloat(raw);
          if (!isNaN(numVal)) {
            const fromUnit = field.selectedUnit;
            const toUnit = p.unit || "";
            const converted = convertUnitValue(numVal, fromUnit, toUnit);
            cleanValues[p.key] = {
              value: p.kind === "integer" ? Math.round(converted) : converted,
              unit: toUnit,
              original_value: numVal,
              original_unit: fromUnit,
            };
          }
        }
      }

      // 3. Validate outcomes
      const cleanOutcomes: Record<string, any> = {};
      let hasAtLeastOneOutcome = false;

      for (const o of outcomes) {
        const field = outcomeInputs[o.key];
        const raw = field?.rawValue?.trim();
        if (raw !== undefined && raw !== "") {
          const numVal = parseFloat(raw);
          if (isNaN(numVal)) {
            throw new Error(`Invalid numeric value for outcome '${o.label || o.key}': ${raw}`);
          }
          hasAtLeastOneOutcome = true;

          const fromUnit = field.selectedUnit;
          const toUnit = o.unit || "";
          const convertedVal = convertUnitValue(numVal, fromUnit, toUnit);

          const outObj: Record<string, any> = {
            value: convertedVal,
            unit: toUnit,
            original_value: numVal,
            original_unit: fromUnit,
          };

          if (field.sd && field.sd.trim() !== "") {
            const sdVal = parseFloat(field.sd.trim());
            if (!isNaN(sdVal)) {
              outObj.sd = convertUnitValue(sdVal, fromUnit, toUnit);
              outObj.original_sd = sdVal;
            }
          }

          if (field.n && field.n.trim() !== "") {
            const nVal = parseInt(field.n.trim(), 10);
            if (!isNaN(nVal) && nVal > 0) {
              outObj.n = nVal;
            }
          }

          cleanOutcomes[o.key] = outObj;
        }
      }

      if (!hasAtLeastOneOutcome) {
        throw new Error(
          tr(
            "მინიმუმ ერთი ექსპერიმენტული შედეგის (Outcome) მითითება სავალდებულოა.",
            "At least one measured outcome value must be provided."
          )
        );
      }

      if (status !== "valid" && !statusReason.trim()) {
        throw new Error(
          tr(
            "არასტანდარტული სტატუსისთვის მიზეზის მითითება სავალდებულოა.",
            "A reason is required when status is not 'valid' (e.g. equipment malfunction)."
          )
        );
      }

      // Build payload matching EvidenceCreate schema
      const payload: EvidenceCreate = {
        kind,
        values: cleanValues,
        outcomes: cleanOutcomes,
        status,
        status_reason: status !== "valid" ? statusReason.trim() : null,
        candidate_id: selectedCand?.id || null,
        recorded_by: recordedBy.trim() || "lab-user",
        notes: `${runTag ? `[${runTag}] ` : ""}${notes.trim()}`,
      };

      const res = await apiPost<Evidence>(`/studies/${study.id}/evidence`, payload);
      setRecordedSuccess(res);
      onEvidenceRecorded?.(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
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
        backgroundColor: "rgba(15, 23, 42, 0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          width: "100%",
          maxWidth: 720,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #cbd5e1",
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
                width: 38,
                height: 38,
                borderRadius: 8,
                background: "#ecfdf5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#059669",
              }}
            >
              <FlaskConical size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                {tr("რეალური ექსპერიმენტის აღრიცხვა (Ground Truth)", "Record Real Experiment (Lab Ground Truth)")}
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                {tr(
                  "ფიზიკური დანადგარის ან საველე გაზომვის შეტანა. მონაცემი ჩაითვლება აბსოლუტურ ჭეშმარიტებად.",
                  "Log physical bench measurements. Stored as immutable ground truth for calibration & screening."
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

        {/* Body content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          {recordedSuccess ? (
            /* Post-Save Success Celebration & Calibration Prompt */
            <div style={{ textAlign: "center", padding: "20px 10px" }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "#ecfdf5",
                  color: "#059669",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 14,
                }}
              >
                <CheckCircle2 size={32} />
              </div>
              <h3 style={{ margin: "0 0 6px 0", fontSize: 18, fontWeight: 700, color: "#065f46" }}>
                {tr("ექსპერიმენტი წარმატებით ჩაიწერა!", "Experiment Successfully Logged as Ground Truth!")}
              </h3>
              <p style={{ color: "#475569", fontSize: 13, maxWidth: 520, margin: "0 auto 18px auto", lineHeight: 1.5 }}>
                {tr(
                  `მტკიცებულება ჩაწერილია იდენტიფიკატორით ${recordedSuccess.id}. შესაბამისი კანდიდატები პროგრამაში დაკალიბრდება და მიენიჭება უმაღლესი პრიორიტეტი (Tested Pass / Tested Fail).`,
                  `Record registered with immutable audit ID ${recordedSuccess.id}. The study now treats this observation as definitive physical ground truth.`
                )}
              </p>

              {/* Calibration Call to Action Card */}
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 10,
                  padding: "16px 20px",
                  textAlign: "left",
                  margin: "0 auto 20px auto",
                  maxWidth: 580,
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ color: "#16a34a", marginTop: 2 }}>
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h4 style={{ margin: "0 0 4px 0", fontSize: 14, fontWeight: 600, color: "#166534" }}>
                      {existingEvidenceCount + 1 >= 3
                        ? tr("მოდელის ავტო-კალიბრაცია ხელმისაწვდომია!", "Model Auto-Calibration Ready!")
                        : tr(`დაგროვილია ${existingEvidenceCount + 1} ემპირიული წერტილი`, `${existingEvidenceCount + 1} Empirical Data Points Accumulated`)}
                    </h4>
                    <p style={{ margin: 0, fontSize: 12, color: "#15803d", lineHeight: 1.4 }}>
                      {existingEvidenceCount + 1 >= 3
                        ? tr(
                            "თქვენ გაქვთ საკმარისი რაოდენობის ლაბორატორიული გაზომვები. გსურთ სიმულაციური მოდელის პარამეტრების მორგება (Least Squares) ამ რეალურ მონაცემებთან?",
                            "You now have sufficient benchmark observations. Would you like to calibrate unvalidated physics parameters in your simulation model against this empirical ground truth?"
                          )
                        : tr(
                            `კალიბრაციისთვის რეკომენდებულია მინიმუმ 3 ფიზიკური ცდა (ამჟამად: ${existingEvidenceCount + 1}). შეგიძლიათ გააგრძელოთ სხვა გაზომვების შეტანა.`,
                            `Non-linear model calibration requires at least 3 physical test records (currently ${existingEvidenceCount + 1}). Log more runs to enable calibration.`
                          )}
                    </p>
                  </div>
                </div>

                {existingEvidenceCount + 1 >= 3 && onOpenCalibration && (
                  <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                    <button
                      className="btn-primary"
                      onClick={() => {
                        onClose();
                        onOpenCalibration();
                      }}
                      style={{
                        padding: "7px 16px",
                        fontSize: 12,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "#16a34a",
                        borderColor: "#16a34a",
                      }}
                    >
                      <Sparkles size={14} />
                      <span>{tr("მოდელის კალიბრაცია რეალურ მონაცემებზე", "Calibrate Model to Real Ground Truth")}</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setRecordedSuccess(null);
                    setErrorMessage(null);
                  }}
                >
                  {tr("კიდევ ერთი ცდის დამატება", "Record Another Test Run")}
                </button>
                <button className="btn-primary" onClick={onClose}>
                  {tr("დასრულება", "Done")}
                </button>
              </div>
            </div>
          ) : (
            /* Main Form */
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Zero Guesswork Guarantee Banner */}
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 8,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12,
                  color: "#1e40af",
                }}
              >
                <ShieldCheck size={18} style={{ flexShrink: 0, color: "#2563eb" }} />
                <span>
                  <strong>{tr("მკაცრი ემპირიული წესი:", "Strict Empirical Ground Truth Policy:")}</strong>{" "}
                  {tr(
                    "შეიყვანეთ მხოლოდ რეალური ხელსაწყოების ჩვენებები. სისტემაში არ შეიტანება არანაირი 'სავარაუდო' ან სინთეტიკური მონაცემი.",
                    "Input actual bench instrument readings only. No guessed or synthetic data will be introduced."
                  )}
                </span>
              </div>

              {errorMessage && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12,
                    color: "#991b1b",
                  }}
                >
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Target Candidate Selector */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: 12,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                    {tr("კანდიდატის დაკავშირება (არასავალდებულო):", "Link to Study Candidate (Optional):")}
                  </label>
                  <select
                    className="study-form-input"
                    value={selectedCand?.id || ""}
                    onChange={(e) => handleSelectCandidate(e.target.value)}
                    style={{ fontSize: 12, padding: "6px 8px" }}
                  >
                    <option value="">{tr("თავისუფალი საველე ცდა (ავტო-დამთხვევა)", "Freeform Bench Test (Auto-match candidate)")}</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.idx} ({Object.entries(c.values)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(", ")})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                    {tr("ექსპერიმენტის ტიპი / გარემო:", "Experiment Kind:")}
                  </label>
                  <select
                    className="study-form-input"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                    style={{ fontSize: 12, padding: "6px 8px" }}
                  >
                    <option value="lab">{tr("ლაბორატორიული ტესტი (Lab Bench)", "Lab Bench Test")}</option>
                    <option value="field">{tr("საველე პოლიგონი (Field Trial)", "Field Trial")}</option>
                    <option value="literature">{tr("ლიტერატურული წყარო (Literature)", "Literature Data")}</option>
                    <option value="simulation">{tr("გარე სიმულატორი (External Sim)", "External Simulator")}</option>
                  </select>
                </div>
              </div>

              {/* Controlled Parameters Section */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1e293b", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {tr("1. კონტროლირებადი პარამეტრები (Controlled Input Values)", "1. Controlled Parameter Inputs (Required)")}
                  </h4>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    {tr("შეიყვანეთ მნიშვნელობა და აირჩიეთ ერთეული", "Enter test value & instrument unit")}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {controlledParams.map((p) => {
                    const inputState = paramInputs[p.key] || { rawValue: "", selectedUnit: p.unit || "" };
                    const compatibleUnits = getCompatibleUnits(p.unit || "");
                    const preview = formatUnitConversionPreview(
                      inputState.rawValue,
                      inputState.selectedUnit,
                      p.unit || ""
                    );

                    const spec = (p.spec as Record<string, unknown>) || {};
                    const min = typeof spec.min === "number" ? spec.min : null;
                    const max = typeof spec.max === "number" ? spec.max : null;

                    return (
                      <div
                        key={p.key}
                        style={{
                          background: "#ffffff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          padding: 10,
                          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
                            {p.label || p.key} <span style={{ color: "#ef4444" }}>*</span>
                          </label>
                          {min !== null && max !== null && (
                            <span style={{ fontSize: 10, color: "#94a3b8" }}>
                              Domain: [{min} .. {max} {p.unit}]
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            type={p.kind === "continuous" || p.kind === "integer" ? "number" : "text"}
                            step={p.kind === "continuous" ? "any" : "1"}
                            className="study-form-input"
                            placeholder={tr("მაჩვენებელი...", "Reading...")}
                            value={inputState.rawValue}
                            onChange={(e) =>
                              setParamInputs({
                                ...paramInputs,
                                [p.key]: { ...inputState, rawValue: e.target.value },
                              })
                            }
                            style={{ flex: 1, fontSize: 13, padding: "6px 8px" }}
                          />

                          <select
                            className="study-form-input"
                            value={inputState.selectedUnit}
                            onChange={(e) =>
                              setParamInputs({
                                ...paramInputs,
                                [p.key]: { ...inputState, selectedUnit: e.target.value },
                              })
                            }
                            style={{ width: 100, fontSize: 12, padding: "6px 4px", background: "#f8fafc" }}
                            title="Choose measured unit"
                          >
                            {compatibleUnits.map((u) => (
                              <option key={u.symbol} value={u.symbol}>
                                {u.symbol || "unitless"}
                              </option>
                            ))}
                          </select>
                        </div>

                        {preview.isDifferent && !preview.error && (
                          <div
                            style={{
                              marginTop: 5,
                              fontSize: 11,
                              color: "#059669",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Scale size={12} />
                            <span>{preview.text}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Uncertain Conditions Observed During Test */}
              {uncertainParams.length > 0 && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {tr("2. გაზომილი გარემო პირობები (Uncertain Environmental Conditions)", "2. Observed Test Conditions (Optional)")}
                    </h4>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>
                      {tr("დატოვეთ ცარიელი თუ არ გაგიზომავთ (არ ვვარაუდობთ!)", "Leave blank if unmeasured — no guessing!")}
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {uncertainParams.map((p) => {
                      const inputState = paramInputs[p.key] || { rawValue: "", selectedUnit: p.unit || "" };
                      const compatibleUnits = getCompatibleUnits(p.unit || "");
                      const preview = formatUnitConversionPreview(
                        inputState.rawValue,
                        inputState.selectedUnit,
                        p.unit || ""
                      );

                      return (
                        <div
                          key={p.key}
                          style={{
                            background: "#fcfdfe",
                            border: "1px dashed #cbd5e1",
                            borderRadius: 8,
                            padding: 10,
                          }}
                        >
                          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
                            {p.label || p.key}
                          </label>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              type="number"
                              step="any"
                              className="study-form-input"
                              placeholder={tr("არ არის გაზომილი", "Unmeasured (blank)")}
                              value={inputState.rawValue}
                              onChange={(e) =>
                                setParamInputs({
                                  ...paramInputs,
                                  [p.key]: { ...inputState, rawValue: e.target.value },
                                })
                              }
                              style={{ flex: 1, fontSize: 13, padding: "6px 8px" }}
                            />
                            <select
                              className="study-form-input"
                              value={inputState.selectedUnit}
                              onChange={(e) =>
                                setParamInputs({
                                  ...paramInputs,
                                  [p.key]: { ...inputState, selectedUnit: e.target.value },
                                })
                              }
                              style={{ width: 100, fontSize: 12, padding: "6px 4px", background: "#fff" }}
                            >
                              {compatibleUnits.map((u) => (
                                <option key={u.symbol} value={u.symbol}>
                                  {u.symbol || "unitless"}
                                </option>
                              ))}
                            </select>
                          </div>
                          {preview.isDifferent && !preview.error && (
                            <div style={{ marginTop: 4, fontSize: 11, color: "#059669" }}>
                              {preview.text}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Measured Outcomes Section */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1e293b", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {tr("3. გაზომილი შედეგები (Observed Experimental Outcomes)", "3. Measured Outcomes & Uncertainty")}
                  </h4>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    {tr("სენსორების ფაქტობრივი ჩვენებები", "Actual instrument readings & replicates")}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {outcomes.map((o) => {
                    const inputState = outcomeInputs[o.key] || {
                      rawValue: "",
                      selectedUnit: o.unit || "",
                      sd: "",
                      n: "1",
                    };
                    const compatibleUnits = getCompatibleUnits(o.unit || "");
                    const preview = formatUnitConversionPreview(
                      inputState.rawValue,
                      inputState.selectedUnit,
                      o.unit || ""
                    );

                    const criterionStatus =
                      inputState.rawValue !== "" && !isNaN(preview.converted)
                        ? evaluateCriterion(o, preview.converted)
                        : null;

                    return (
                      <div
                        key={o.key}
                        style={{
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: 8,
                          padding: 12,
                          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div>
                            <span style={{ fontWeight: 650, fontSize: 13, color: "#0f172a" }}>
                              {o.label || o.key}
                            </span>
                            {o.unit && (
                              <span style={{ marginLeft: 6, fontSize: 11, color: "#64748b", fontFamily: "var(--mono)" }}>
                                [{o.unit}]
                              </span>
                            )}
                          </div>

                          {criterionStatus && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "2px 8px",
                                borderRadius: 4,
                                background: criterionStatus.passes ? "#ecfdf5" : "#fef2f2",
                                color: criterionStatus.passes ? "#065f46" : "#991b1b",
                                border: `1px solid ${criterionStatus.passes ? "#a7f3d0" : "#fecaca"}`,
                              }}
                            >
                              {criterionStatus.text}
                            </span>
                          )}
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
                          <div>
                            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 2 }}>
                              {tr("გაზომილი სიდიდე (Mean Value):", "Measured Value:")}
                            </label>
                            <div style={{ display: "flex", gap: 6 }}>
                              <input
                                type="number"
                                step="any"
                                className="study-form-input"
                                placeholder={tr("მაგ. 6.8", "e.g. 6.8")}
                                value={inputState.rawValue}
                                onChange={(e) =>
                                  setOutcomeInputs({
                                    ...outcomeInputs,
                                    [o.key]: { ...inputState, rawValue: e.target.value },
                                  })
                                }
                                style={{ flex: 1, fontSize: 13, padding: "6px 8px" }}
                              />
                              <select
                                className="study-form-input"
                                value={inputState.selectedUnit}
                                onChange={(e) =>
                                  setOutcomeInputs({
                                    ...outcomeInputs,
                                    [o.key]: { ...inputState, selectedUnit: e.target.value },
                                  })
                                }
                                style={{ width: 90, fontSize: 12, padding: "6px 4px" }}
                              >
                                {compatibleUnits.map((u) => (
                                  <option key={u.symbol} value={u.symbol}>
                                    {u.symbol || "unitless"}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 2 }}>
                              {tr("ცდომილება SD (±):", "Standard Dev (±):")}
                            </label>
                            <input
                              type="number"
                              step="any"
                              className="study-form-input"
                              placeholder={tr("არასავალდებულო", "Optional")}
                              value={inputState.sd}
                              onChange={(e) =>
                                setOutcomeInputs({
                                  ...outcomeInputs,
                                  [o.key]: { ...inputState, sd: e.target.value },
                                })
                              }
                              style={{ width: "100%", fontSize: 13, padding: "6px 8px" }}
                            />
                          </div>

                          <div>
                            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 2 }}>
                              {tr("განმეორება (N):", "Replicates (N):")}
                            </label>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              className="study-form-input"
                              value={inputState.n}
                              onChange={(e) =>
                                setOutcomeInputs({
                                  ...outcomeInputs,
                                  [o.key]: { ...inputState, n: e.target.value },
                                })
                              }
                              style={{ width: "100%", fontSize: 13, padding: "6px 8px" }}
                            />
                          </div>
                        </div>

                        {preview.isDifferent && !preview.error && (
                          <div style={{ marginTop: 6, fontSize: 11, color: "#059669", display: "flex", alignItems: "center", gap: 4 }}>
                            <Scale size={12} />
                            <span>{preview.text}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Run Metadata & Quality */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: 12,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                    {tr("საგამოცდო კოდი / ნომერი:", "Run Tag / Sample ID:")}
                  </label>
                  <input
                    type="text"
                    className="study-form-input"
                    value={runTag}
                    onChange={(e) => setRunTag(e.target.value)}
                    placeholder="e.g. RUN-2026-10-20-A"
                    style={{ fontSize: 12, padding: "6px 8px" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                    {tr("ექსპერიმენტატორი (Operator):", "Recorded By / Operator:")}
                  </label>
                  <input
                    type="text"
                    className="study-form-input"
                    value={recordedBy}
                    onChange={(e) => setRecordedBy(e.target.value)}
                    placeholder="e.g. Dr. Vance"
                    style={{ fontSize: 12, padding: "6px 8px" }}
                  />
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                    {tr("ლაბორატორიული დაკვირვებები & შენიშვნები:", "Bench Observations & Notes:")}
                  </label>
                  <textarea
                    className="study-form-input"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={tr(
                      "მაგ. საქშენებზე წნევა სტაბილური იყო, აფეთქების ტალღამ ჩაიარა შეფერხების გარეშე...",
                      "e.g. Stable pressure manifold; sensor response clean; no cavitation observed."
                    )}
                    style={{ fontSize: 12, padding: "6px 8px", width: "100%", resize: "vertical" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                    {tr("ხარისხის სტატუსი (Run Quality):", "Run Quality Status:")}
                  </label>
                  <select
                    className="study-form-input"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    style={{ fontSize: 12, padding: "6px 8px" }}
                  >
                    <option value="valid">{tr("ვალიდური (Valid Test)", "Valid Measurement")}</option>
                    <option value="failed_run">{tr("წარუმატებელი ცდა (Equipment Failure)", "Equipment Abort / Choked")}</option>
                    <option value="outlier">{tr("ამოვარდნილი (Sensor Glitch)", "Outlier")}</option>
                  </select>
                </div>

                {status !== "valid" && (
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#b91c1c", marginBottom: 4 }}>
                      {tr("სტატუსის მიზეზი (სავალდებულო):", "Status Reason (Required):")}
                    </label>
                    <input
                      type="text"
                      className="study-form-input"
                      value={statusReason}
                      onChange={(e) => setStatusReason(e.target.value)}
                      placeholder={tr("მაგ. ტუმბოს გათიშვა წნევის ვარდნის გამო", "e.g. Pressure transducer disconnected")}
                      style={{ fontSize: 12, padding: "6px 8px" }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!recordedSuccess && (
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
            <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
              <ShieldCheck size={14} color="#059669" />
              <span>{tr("ჩანაწერი შეუცვლელია (§4.2, Hard Rule 3)", "Immutable evidence store (§4.2, Hard Rule 3)")}</span>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-secondary" onClick={onClose} disabled={submitting}>
                {tr("გაუქმება", "Cancel")}
              </button>
              <button
                className="btn-primary"
                onClick={handleSaveExperiment}
                disabled={submitting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {submitting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>{tr("ინახება...", "Recording Ground Truth...")}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    <span>{tr("ჭეშმარიტების შენახვა (Save Ground Truth)", "Save Ground Truth Record")}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
