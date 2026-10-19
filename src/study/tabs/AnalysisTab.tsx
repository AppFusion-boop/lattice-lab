import { useState } from "react";
import {
  ShieldCheck,
  Activity,
  Scale,
  Calculator,
  Compass,
  CheckCircle2,
  AlertTriangle,
  Play,
} from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import { useApi } from "../api/hooks";
import type {
  Study,
  Parameter,
  Outcome,
  ModelVersion,
  PaginatedCandidates,
} from "../api/types";
import { TornadoChart } from "../components/TornadoChart";
import { PhaseDiagram2D } from "../components/PhaseDiagram2D";
import { tr } from "../../i18n";

interface AnalysisTabProps {
  study: Study;
}

export function AnalysisTab({ study }: AnalysisTabProps) {
  const { data: parameters, refresh: refreshParams } = useApi<Parameter[]>(
    `parameters-${study.id}`,
    () => apiGet<Parameter[]>(`/studies/${study.id}/parameters`)
  );
  const { data: outcomes } = useApi<Outcome[]>(`outcomes-${study.id}`, () =>
    apiGet<Outcome[]>(`/studies/${study.id}/outcomes`)
  );
  const { data: models, refresh: refreshModels } = useApi<ModelVersion[]>(
    `models-${study.id}`,
    () => apiGet<ModelVersion[]>(`/studies/${study.id}/models`)
  );
  const { data: candidatesData } = useApi<PaginatedCandidates>(
    `candidates-analysis-${study.id}`,
    () => apiGet<PaginatedCandidates>(`/studies/${study.id}/candidates?limit=500`)
  );
  const { data: dimAnalysis } = useApi<any>(
    `dimensional-${study.id}`,
    () => apiGet<any>(`/studies/${study.id}/analyses/dimensional`)
  );

  const latestModel = models && models.length > 0 ? models[0] : null;

  // Model Validation & Sign-off state
  const [validating, setValidating] = useState(false);
  const [valResult, setValResult] = useState<any>(null);
  const [valError, setValError] = useState<string | null>(null);
  const [acceptReason, setAcceptReason] = useState(
    "Empirical 90% prediction interval coverage meets >= 80% threshold on physical evidence"
  );
  const [accepting, setAccepting] = useState(false);

  // Interval Futility Theorem state
  const [intervalExpr, setIntervalExpr] = useState("100 * exp(-0.01 * x)");
  const [intervalOutcome, setIntervalOutcome] = useState("");
  const [intervalResult, setIntervalResult] = useState<any>(null);
  const [intervalError, setIntervalError] = useState<string | null>(null);

  // TOST Equivalence state
  const [tostParam, setTostParam] = useState("");
  const [tostValA, setTostValA] = useState("");
  const [tostValB, setTostValB] = useState("");
  const [tostMargin, setTostMargin] = useState("5.0");
  const [tostOutcome, setTostOutcome] = useState("");
  const [tostResult, setTostResult] = useState<any>(null);
  const [tostError, setTostError] = useState<string | null>(null);

  // K-Fold Backtest state
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  const handleValidateModel = async () => {
    if (!latestModel) return;
    setValidating(true);
    setValError(null);
    try {
      const res = await apiPost<any>(
        `/studies/${study.id}/models/${latestModel.id}/validate`,
        { n_draws: 30 }
      );
      setValResult(res);
      refreshModels();
    } catch (err: any) {
      setValError(err?.message || String(err));
    } finally {
      setValidating(false);
    }
  };

  const handleAcceptValidation = async () => {
    if (!latestModel) return;
    setAccepting(true);
    setValError(null);
    try {
      await apiPost(`/models/${latestModel.id}/accept-validation`, {
        reason: acceptReason,
      });
      refreshModels();
    } catch (err: any) {
      setValError(err?.message || String(err));
    } finally {
      setAccepting(false);
    }
  };

  const handleRunIntervals = async () => {
    setIntervalError(null);
    const outKey = intervalOutcome || outcomes?.[0]?.key || "";
    try {
      const res = await apiPost<any>(`/studies/${study.id}/analyses/intervals`, {
        expression: intervalExpr,
        outcome_key: outKey,
        n_slices: 50,
      });
      setIntervalResult(res);
    } catch (err: any) {
      setIntervalError(err?.message || String(err));
    }
  };

  const handleRunTost = async () => {
    setTostError(null);
    const outKey = tostOutcome || outcomes?.[0]?.key || "";
    const pKey = tostParam || parameters?.find((p) => p.role === "controlled")?.key || "";
    try {
      const res = await apiPost<any>(`/studies/${study.id}/analyses/tost`, {
        parameter_key: pKey,
        value_a: Number.isNaN(Number(tostValA)) ? tostValA : Number(tostValA),
        value_b: Number.isNaN(Number(tostValB)) ? tostValB : Number(tostValB),
        margin: Number(tostMargin) || 1.0,
        outcome_key: outKey,
      });
      setTostResult(res);
    } catch (err: any) {
      setTostError(err?.message || String(err));
    }
  };

  const handleRunBacktest = async () => {
    setRunningBacktest(true);
    setBacktestError(null);
    try {
      const res = await apiPost<any>(`/studies/${study.id}/analyses/backtest`, {
        k_folds: 5,
      });
      setBacktestResult(res);
    } catch (err: any) {
      setBacktestError(err?.message || String(err));
    } finally {
      setRunningBacktest(false);
    }
  };

  const controlledParams = (parameters || []).filter((p) => p.role === "controlled");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 1. 2D Safe Operating Envelope Phase Diagram */}
      <div className="study-card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Compass size={18} color="#0284c7" />
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {tr("2D უსაფრთხო სამუშაო გარსის ფაზური დიაგრამა", "2D Safe Operating Envelope Phase Diagram")}
          </h3>
        </div>
        <PhaseDiagram2D
          candidates={candidatesData?.items || []}
          parameters={parameters || []}
        />
      </div>

      {/* 2. Model Validation Against Evidence & Human Sign-Off (Hard Rule 6) */}
      <div className="study-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={18} color="#059669" />
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>
                {tr("მოდელის ვალიდაცია მტკიცებულებებთან & ადამიანური დადასტურება", "Model Validation vs. Physical Evidence & Human Sign-Off (Hard Rule 6)")}
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                Unvalidated models may only deprioritise candidates. Exclusion at confidence requires empirical 90% PI coverage ≥ 80% and explicit human sign-off.
              </p>
            </div>
          </div>

          {latestModel && (
            <button
              className="btn-primary"
              onClick={handleValidateModel}
              disabled={validating}
            >
              <Play size={13} />
              <span>{validating ? "Validating..." : `Validate Model v${latestModel.version}`}</span>
            </button>
          )}
        </div>

        {!latestModel ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>
            No Flow Model version saved yet. Link a Flow Model in the "3D Flow & Simulation" tab first.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 13 }}>
              <span>
                <strong>Current Status:</strong>{" "}
                {latestModel.validation_status === "validated" ? (
                  <span className="badge badge-status-recommended" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <CheckCircle2 size={12} /> Validated
                  </span>
                ) : (
                  <span className="badge badge-status-open" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <AlertTriangle size={12} /> Unvalidated (Deprioritise Only)
                  </span>
                )}
              </span>
              {(valResult || latestModel.validation_json) && (
                <span>
                  <strong>Empirical 90% PI Coverage:</strong>{" "}
                  <code>
                    {(
                      ((valResult?.empirical_coverage_90 ??
                        (latestModel.validation_json as any)?.empirical_coverage_90) ||
                        0) * 100
                    ).toFixed(1)}
                    %
                  </code>{" "}
                  ({valResult?.n_evidence_rows ?? (latestModel.validation_json as any)?.n_evidence_rows ?? 0} evidence rows)
                </span>
              )}
            </div>

            {valError && (
              <div style={{ padding: 10, background: "#fef2f2", color: "#b91c1c", borderRadius: 6, fontSize: 12 }}>
                {valError}
              </div>
            )}

            {latestModel.validation_status !== "validated" &&
              (valResult?.eligible_for_acceptance ||
                (latestModel.validation_json as any)?.eligible_for_acceptance) && (
                <div
                  style={{
                    padding: 12,
                    background: "#ecfdf5",
                    border: "1px solid #a7f3d0",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    type="text"
                    className="form-input"
                    value={acceptReason}
                    onChange={(e) => setAcceptReason(e.target.value)}
                    style={{ flex: 1, minWidth: 260, fontSize: 12 }}
                    placeholder="Reason for human validation sign-off..."
                  />
                  <button
                    className="btn-primary"
                    onClick={handleAcceptValidation}
                    disabled={accepting || acceptReason.trim().length < 3}
                  >
                    <CheckCircle2 size={13} />
                    <span>{accepting ? "Signing Off..." : "Accept Model Validation"}</span>
                  </button>
                </div>
              )}
          </div>
        )}
      </div>

      {/* 3. Buckingham Pi Dimensional Analysis & K-Fold False-Exclusion Backtest */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="study-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Calculator size={17} color="#7c3aed" />
            <h4 style={{ margin: 0, fontSize: 14 }}>
              {tr("ბუკინგემის Π განზომილებიანი რედუქცია", "Buckingham Π Dimensional Reduction")}
            </h4>
          </div>
          {dimAnalysis ? (
            <div style={{ fontSize: 12, color: "#334155", display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ margin: 0 }}>{dimAnalysis.reduction_summary}</p>
              {dimAnalysis.pi_groups?.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {dimAnalysis.pi_groups.map((pg: any) => (
                    <div
                      key={pg.name}
                      style={{
                        padding: "6px 10px",
                        background: "#f5f3ff",
                        border: "1px solid #ddd6fe",
                        borderRadius: 6,
                        fontFamily: "var(--mono)",
                      }}
                    >
                      <strong>{pg.name}</strong> = {pg.expression}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>Loading dimensional analysis...</div>
          )}
        </div>

        <div className="study-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={17} color="#0284c7" />
              <h4 style={{ margin: 0, fontSize: 14 }}>
                {tr("K-ჯერადი ცრუ გამორიცხვის ბექ-ტესტი", "K-Fold False-Exclusion Back-Test")}
              </h4>
            </div>
            <button
              className="btn-secondary"
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={handleRunBacktest}
              disabled={runningBacktest}
            >
              {runningBacktest ? "Running..." : "Run 5-Fold Back-Test"}
            </button>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#64748b" }}>
            Holds out 1/K of valid evidence per fold, refits the conformal GP surrogate, and checks how often truly viable runs were falsely excluded.
          </p>
          {backtestError && (
            <div style={{ fontSize: 12, color: "#b91c1c" }}>{backtestError}</div>
          )}
          {backtestResult && (
            <div style={{ padding: 10, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12 }}>
              <div><strong>Statement:</strong> {backtestResult.statement}</div>
              <div style={{ marginTop: 4 }}>
                <strong>False Exclusions:</strong> {backtestResult.false_exclusions} / {backtestResult.n_truly_viable} viable (95% Wilson CI: [{(backtestResult.wilson_ci_95[0] * 100).toFixed(1)}%, {(backtestResult.wilson_ci_95[1] * 100).toFixed(1)}%])
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Deterministic Interval Arithmetic Futility Prover & TOST Equivalence */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="study-card">
          <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>
            {tr("ინტერვალური არითმეტიკის უსარგებლობის დამამტკიცებელი", "Deterministic Interval Futility Prover")}
          </h4>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "#64748b" }}>
            Mathematically proves parameter sub-domains where outcome bounds cannot satisfy the viability criterion regardless of other variables.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input
              className="form-input"
              style={{ flex: 1, fontSize: 12, fontFamily: "var(--mono)" }}
              value={intervalExpr}
              onChange={(e) => setIntervalExpr(e.target.value)}
              placeholder="Analytical bound expression, e.g. 100 * exp(-0.02 * flow)"
            />
            <select
              className="form-select"
              style={{ width: 140, fontSize: 12 }}
              value={intervalOutcome || outcomes?.[0]?.key || ""}
              onChange={(e) => setIntervalOutcome(e.target.value)}
            >
              {(outcomes || []).map((o) => (
                <option key={o.key} value={o.key}>{o.label || o.key}</option>
              ))}
            </select>
            <button className="btn-primary" style={{ fontSize: 12 }} onClick={handleRunIntervals}>
              Prove Bounds
            </button>
          </div>
          {intervalError && <div style={{ fontSize: 12, color: "#b91c1c" }}>{intervalError}</div>}
          {intervalResult && (
            <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {intervalResult.theorems.length === 0 ? (
                <div style={{ color: "#64748b" }}>No unconditionally futile sub-intervals detected over current bounds.</div>
              ) : (
                intervalResult.theorems.map((t: any, idx: number) => (
                  <div key={idx} style={{ padding: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#991b1b" }}>
                    {t.statement}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="study-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Scale size={17} color="#059669" />
            <h4 style={{ margin: 0, fontSize: 14 }}>
              {tr("ეკვივალენტობის ტესტირება (TOST)", "Two One-Sided Equivalence Test (TOST)")}
            </h4>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 6, marginBottom: 8 }}>
            <select
              className="form-select"
              style={{ fontSize: 12 }}
              value={tostParam || controlledParams[0]?.key || ""}
              onChange={(e) => setTostParam(e.target.value)}
            >
              {controlledParams.map((p) => (
                <option key={p.key} value={p.key}>{p.key}</option>
              ))}
            </select>
            <input
              className="form-input"
              style={{ fontSize: 12 }}
              placeholder="Level A"
              value={tostValA}
              onChange={(e) => setTostValA(e.target.value)}
            />
            <input
              className="form-input"
              style={{ fontSize: 12 }}
              placeholder="Level B"
              value={tostValB}
              onChange={(e) => setTostValB(e.target.value)}
            />
            <input
              className="form-input"
              style={{ fontSize: 12 }}
              placeholder="±Margin"
              value={tostMargin}
              onChange={(e) => setTostMargin(e.target.value)}
            />
            <button className="btn-primary" style={{ fontSize: 12 }} onClick={handleRunTost}>
              Test
            </button>
          </div>
          {tostError && <div style={{ fontSize: 12, color: "#b91c1c" }}>{tostError}</div>}
          {tostResult && (
            <div style={{ padding: 10, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12 }}>
              <div><strong>Verdict:</strong> {tostResult.statement}</div>
              <div style={{ marginTop: 4, color: "#475569" }}>
                p_TOST = {tostResult.p_tost} | 90% CI: [{tostResult.ci_lower}, {tostResult.ci_upper}]
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 5. Global Sobol / Morris Sensitivity Analysis */}
      <div className="study-card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Activity size={18} color="#2563eb" />
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {tr("გლობალური მგრძნობელობის ანალიზი (Sobol S1 / ST)", "Global Sensitivity Analysis & Parameter Freezing")}
          </h3>
        </div>
        <TornadoChart
          study={study}
          outcomes={outcomes || []}
          parameters={parameters || []}
          onParameterUpdated={refreshParams}
        />
      </div>
    </div>
  );
}

