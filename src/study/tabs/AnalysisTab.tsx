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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 1. 2D Safe Operating Envelope Phase Diagram */}
      <div className="study-card">
        <div className="study-card-header">
          <div>
            <h3 className="study-card-title">
              <Compass size={17} color="var(--ll-blue)" />
              <span>{tr("2D უსაფრთხო სამუშაო გარსის ფაზური დიაგრამა", "2D Safe Operating Envelope Phase Diagram")}</span>
            </h3>
            <p className="study-card-sub">
              {tr(
                "პარამეტრული სივრცის დაყოფა ვალიდურ, ზღვრულ და გამორიცხულ რეგიონებად.",
                "Projection of candidate feasibility across controlled parameters with safe operating contours."
              )}
            </p>
          </div>
          <span className="badge badge-physics">2D Envelope Contour</span>
        </div>
        <PhaseDiagram2D
          candidates={candidatesData?.items || []}
          parameters={parameters || []}
        />
      </div>

      {/* 2. Model Validation Against Evidence & Human Sign-Off (Hard Rule 6) */}
      <div className="study-card">
        <div className="study-card-header">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <ShieldCheck size={20} color="var(--ll-emerald)" style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <h3 className="study-card-title">
                <span>{tr("მოდელის ვალიდაცია მტკიცებულებებთან & ადამიანური დადასტურება", "Model Validation vs. Physical Evidence & Human Sign-Off (Hard Rule 6)")}</span>
              </h3>
              <p className="study-card-sub">
                {tr(
                  "არავალიდირებულ მოდელს მხოლოდ დეპრიორიტიზაცია შეუძლია. გამორიცხვისთვის საჭიროა 90% PI დაფარვა ≥ 80% და ადამიანის ხელმოწერა.",
                  "Unvalidated models may only deprioritise candidates. Exclusion at confidence requires empirical 90% PI coverage ≥ 80% and explicit human sign-off."
                )}
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
              <span>{validating ? tr("მოწმდება...", "Validating...") : tr(`მოდელის შემოწმება v${latestModel.version}`, `Validate Model v${latestModel.version}`)}</span>
            </button>
          )}
        </div>

        {!latestModel ? (
          <div style={{ padding: "16px 20px", background: "var(--ll-surface-subtle)", borderRadius: 6, fontSize: 12.5, color: "var(--ll-text-muted)" }}>
            {tr("ფლოუ მოდელის ვერსია ჯერ არ არის შენახული. მიაბით მოდელი '3D ფლოუ' ჩანართში.", "No Flow Model version saved yet. Link a Flow Model in the '3D Flow' tab first.")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "center",
                flexWrap: "wrap",
                padding: "10px 14px",
                background: "var(--ll-surface-subtle)",
                borderRadius: "var(--ll-radius-md)",
                border: "1px solid var(--ll-border)",
                fontSize: 12.5,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--ll-text-secondary)", fontWeight: 600 }}>{tr("სტატუსი:", "Current Status:")}</span>
                {latestModel.validation_status === "validated" ? (
                  <span className="badge badge-status-recommended">
                    <CheckCircle2 size={12} /> {tr("ვალიდირებული", "Validated")}
                  </span>
                ) : (
                  <span className="badge badge-status-open">
                    <AlertTriangle size={12} /> {tr("არავალიდირებული (მხოლოდ დეპრიორიტიზაცია)", "Unvalidated (Deprioritise Only)")}
                  </span>
                )}
              </span>

              {(valResult || latestModel.validation_json) && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--ll-text-secondary)", fontWeight: 600 }}>{tr("90% PI დაფარვა:", "Empirical 90% PI Coverage:")}</span>
                  <code style={{ fontFamily: "var(--ll-font-mono)", fontWeight: 600, color: "var(--ll-emerald)" }}>
                    {(
                      ((valResult?.empirical_coverage_90 ??
                        (latestModel.validation_json as any)?.empirical_coverage_90) ||
                        0) * 100
                    ).toFixed(1)}
                    %
                  </code>
                  <span style={{ color: "var(--ll-text-muted)", fontSize: 11.5 }}>
                    ({valResult?.n_evidence_rows ?? (latestModel.validation_json as any)?.n_evidence_rows ?? 0} {tr("მტკიცებულება", "evidence rows")})
                  </span>
                </span>
              )}
            </div>

            {valError && (
              <div style={{ padding: "10px 14px", background: "var(--ll-rose-soft)", color: "var(--ll-rose-text)", border: "1px solid var(--ll-rose-border)", borderRadius: "var(--ll-radius-md)", fontSize: 12 }}>
                {valError}
              </div>
            )}

            {latestModel.validation_status !== "validated" &&
              (valResult?.eligible_for_acceptance ||
                (latestModel.validation_json as any)?.eligible_for_acceptance) && (
                <div
                  style={{
                    padding: 14,
                    background: "var(--ll-emerald-soft)",
                    border: "1px solid var(--ll-emerald-border)",
                    borderRadius: "var(--ll-radius-md)",
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
                    style={{ flex: 1, minWidth: 260, fontSize: 12.5 }}
                    placeholder={tr("ადამიანური დადასტურების საფუძველი...", "Reason for human validation sign-off...")}
                  />
                  <button
                    className="btn-primary"
                    onClick={handleAcceptValidation}
                    disabled={accepting || acceptReason.trim().length < 3}
                  >
                    <CheckCircle2 size={13} />
                    <span>{accepting ? tr("დასტურდება...", "Signing Off...") : tr("ვალიდაციის მიღება", "Accept Model Validation")}</span>
                  </button>
                </div>
              )}
          </div>
        )}
      </div>

      {/* 3. Buckingham Pi Dimensional Analysis & K-Fold False-Exclusion Backtest */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
        <div className="study-card" style={{ marginBottom: 0 }}>
          <div className="study-card-header">
            <h4 className="study-card-title">
              <Calculator size={16} color="var(--ll-indigo)" />
              <span>{tr("ბუკინგემის Π განზომილებიანი რედუქცია", "Buckingham Π Dimensional Reduction")}</span>
            </h4>
          </div>
          {dimAnalysis ? (
            <div style={{ fontSize: 12.5, color: "var(--ll-text-secondary)", display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0, lineHeight: 1.5 }}>{dimAnalysis.reduction_summary}</p>
              {dimAnalysis.pi_groups?.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {dimAnalysis.pi_groups.map((pg: any) => (
                    <div
                      key={pg.name}
                      style={{
                        padding: "7px 12px",
                        background: "var(--ll-indigo-soft)",
                        border: "1px solid var(--ll-indigo-border)",
                        borderRadius: "var(--ll-radius-md)",
                        fontFamily: "var(--ll-font-mono)",
                        fontSize: 12,
                        color: "var(--ll-indigo-text)",
                      }}
                    >
                      <strong>{pg.name}</strong> = {pg.expression}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--ll-text-muted)" }}>{tr("განზომილებიანი ანალიზი იტვირთება...", "Loading dimensional analysis...")}</div>
          )}
        </div>

        <div className="study-card" style={{ marginBottom: 0 }}>
          <div className="study-card-header">
            <h4 className="study-card-title">
              <ShieldCheck size={16} color="var(--ll-blue)" />
              <span>{tr("K-ჯერადი ცრუ გამორიცხვის ბექ-ტესტი", "K-Fold False-Exclusion Back-Test")}</span>
            </h4>
            <button
              className="btn-secondary"
              onClick={handleRunBacktest}
              disabled={runningBacktest}
            >
              {runningBacktest ? tr("მიმდინარეობს...", "Running...") : tr("5-Fold ტესტის გაშვება", "Run 5-Fold Back-Test")}
            </button>
          </div>
          <p className="study-card-sub" style={{ margin: "0 0 10px" }}>
            {tr(
              "მალავს მტკიცებულებების 1/K ნაწილს თითო ფოლდზე, ამოწმებს სიცოცხლისუნარიანი კანდიდატების ცრუ გამორიცხვის სიხშირეს.",
              "Holds out 1/K of valid evidence per fold, refits the conformal GP surrogate, and checks how often viable runs were falsely excluded."
            )}
          </p>
          {backtestError && (
            <div style={{ padding: "8px 12px", background: "var(--ll-rose-soft)", color: "var(--ll-rose-text)", borderRadius: 6, fontSize: 12 }}>{backtestError}</div>
          )}
          {backtestResult && (
            <div style={{ padding: 12, background: "var(--ll-surface-subtle)", border: "1px solid var(--ll-border)", borderRadius: "var(--ll-radius-md)", fontSize: 12.5 }}>
              <div><strong style={{ color: "var(--ll-text-primary)" }}>{tr("განაცხადი:", "Statement:")}</strong> {backtestResult.statement}</div>
              <div style={{ marginTop: 6, color: "var(--ll-text-secondary)" }}>
                <strong>{tr("ცრუ გამორიცხვები:", "False Exclusions:")}</strong> {backtestResult.false_exclusions} / {backtestResult.n_truly_viable} viable (95% Wilson CI: [{(backtestResult.wilson_ci_95[0] * 100).toFixed(1)}%, {(backtestResult.wilson_ci_95[1] * 100).toFixed(1)}%])
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Deterministic Interval Arithmetic Futility Prover & TOST Equivalence */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
        <div className="study-card" style={{ marginBottom: 0 }}>
          <div className="study-card-header">
            <h4 className="study-card-title">
              <Scale size={16} color="var(--ll-rose)" />
              <span>{tr("ინტერვალური უსარგებლობის დამამტკიცებელი", "Deterministic Interval Futility Prover")}</span>
            </h4>
          </div>
          <p className="study-card-sub" style={{ margin: "0 0 10px" }}>
            {tr(
              "მათემატიკურად ამტკიცებს პარამეტრულ ქვედომენებს, სადაც შედეგი ვერ დააკმაყოფილებს კრიტერიუმს.",
              "Mathematically proves parameter sub-domains where outcome bounds cannot satisfy the viability criterion."
            )}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 180, fontSize: 12, fontFamily: "var(--ll-font-mono)" }}
              value={intervalExpr}
              onChange={(e) => setIntervalExpr(e.target.value)}
              placeholder="e.g. 100 * exp(-0.02 * flow)"
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
            <button className="btn-primary" onClick={handleRunIntervals}>
              {tr("დამტკიცება", "Prove Bounds")}
            </button>
          </div>
          {intervalError && <div style={{ padding: "8px 12px", background: "var(--ll-rose-soft)", color: "var(--ll-rose-text)", borderRadius: 6, fontSize: 12 }}>{intervalError}</div>}
          {intervalResult && (
            <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {intervalResult.theorems.length === 0 ? (
                <div style={{ color: "var(--ll-text-muted)", fontSize: 12 }}>{tr("უპირობოდ უსარგებლო ინტერვალები არ გამოვლენილა.", "No unconditionally futile sub-intervals detected over current bounds.")}</div>
              ) : (
                intervalResult.theorems.map((t: any, idx: number) => (
                  <div key={idx} style={{ padding: 8, background: "var(--ll-rose-soft)", border: "1px solid var(--ll-rose-border)", borderRadius: "var(--ll-radius-md)", color: "var(--ll-rose-text)" }}>
                    {t.statement}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="study-card" style={{ marginBottom: 0 }}>
          <div className="study-card-header">
            <h4 className="study-card-title">
              <Scale size={16} color="var(--ll-emerald)" />
              <span>{tr("ეკვივალენტობის ტესტირება (TOST)", "Two One-Sided Equivalence Test (TOST)")}</span>
            </h4>
          </div>
          <p className="study-card-sub" style={{ margin: "0 0 10px" }}>
            {tr(
              "ადასტურებს ან უარყოფს ბიოეკვივალენტობას ან ფიზიკურ ეკვივალენტობას ორ დონეს შორის (±Margin).",
              "Tests biological or physical equivalence between two levels within a clinically or mechanically acceptable margin."
            )}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr auto", gap: 6, marginBottom: 10 }}>
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
            <button className="btn-primary" onClick={handleRunTost}>
              {tr("ტესტი", "Test")}
            </button>
          </div>
          {tostError && <div style={{ padding: "8px 12px", background: "var(--ll-rose-soft)", color: "var(--ll-rose-text)", borderRadius: 6, fontSize: 12 }}>{tostError}</div>}
          {tostResult && (
            <div style={{ padding: 12, background: "var(--ll-surface-subtle)", border: "1px solid var(--ll-border)", borderRadius: "var(--ll-radius-md)", fontSize: 12.5 }}>
              <div><strong style={{ color: "var(--ll-text-primary)" }}>{tr("ვერდიქტი:", "Verdict:")}</strong> {tostResult.statement}</div>
              <div style={{ marginTop: 6, color: "var(--ll-text-secondary)" }}>
                p_TOST = {tostResult.p_tost} | 90% CI: [{tostResult.ci_lower}, {tostResult.ci_upper}]
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 5. Global Sobol / Morris Sensitivity Analysis */}
      <div className="study-card">
        <div className="study-card-header">
          <div>
            <h3 className="study-card-title">
              <Activity size={17} color="var(--ll-emerald)" />
              <span>{tr("გლობალური მგრძნობელობის ანალიზი (Sobol S1 / ST)", "Global Sensitivity Analysis & Parameter Freezing")}</span>
            </h3>
            <p className="study-card-sub">
              {tr(
                "სობოლისა და მორისის ინდექსები. პარამეტრების გაყინვა დომენის განზომილების შესამცირებლად.",
                "Sobol variance decomposition and Morris elementary effects for identifying non-influential parameters to safely freeze."
              )}
            </p>
          </div>
          <span className="badge badge-generic">Sobol S1 / Total ST</span>
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

