import { useState } from "react";
import { Sparkles, Calculator, Target } from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import { useApi } from "../api/hooks";
import type { Study, Parameter, Outcome, PaginatedCandidates } from "../api/types";
import { LabProtocolSheet } from "../components/LabProtocolSheet";
import { PhaseDiagram2D } from "../components/PhaseDiagram2D";
import { tr } from "../../i18n";

interface PlanTabProps {
  study: Study;
}

export function PlanTab({ study }: PlanTabProps) {
  const { data: parameters } = useApi<Parameter[]>(`parameters-${study.id}`, () =>
    apiGet<Parameter[]>(`/studies/${study.id}/parameters`)
  );
  const { data: outcomes } = useApi<Outcome[]>(`outcomes-${study.id}`, () =>
    apiGet<Outcome[]>(`/studies/${study.id}/outcomes`)
  );
  const { data: candidatesData, refresh: refreshCandidates } = useApi<PaginatedCandidates>(
    `candidates-plan-${study.id}`,
    () => apiGet<PaginatedCandidates>(`/studies/${study.id}/candidates?limit=500`)
  );

  // Batch Selection State
  const [strategy, setStrategy] = useState<string>("balanced");
  const [batchSize, setBatchSize] = useState<number>(5);
  const [selectingBatch, setSelectingBatch] = useState<boolean>(false);
  const [batchResult, setBatchResult] = useState<any>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Statistical Power Replicate Calculator State
  const [minEffect, setMinEffect] = useState<string>("5.0");
  const [noiseSd, setNoiseSd] = useState<string>("3.0");
  const [powerTarget, setPowerTarget] = useState<string>("0.80");
  const [powerResult, setPowerResult] = useState<any>(null);
  const [powerError, setPowerError] = useState<string | null>(null);

  const handleSelectBatch = async () => {
    setSelectingBatch(true);
    setBatchError(null);
    try {
      const res = await apiPost<any>(`/studies/${study.id}/batches`, {
        batch_size: batchSize,
        strategy,
      });
      setBatchResult(res);
      refreshCandidates();
    } catch (err: any) {
      setBatchError(err?.message || String(err));
    } finally {
      setSelectingBatch(false);
    }
  };

  const handleComputePower = async () => {
    setPowerError(null);
    try {
      const res = await apiPost<any>(`/studies/${study.id}/analyses/power`, {
        min_effect: Number(minEffect),
        noise_sd: Number(noiseSd),
        alpha: 1.0 - study.confidence,
        power: Number(powerTarget),
      });
      setPowerResult(res);
    } catch (err: any) {
      setPowerError(err?.message || String(err));
    }
  };

  const recommendedSet = new Set<string>(
    (batchResult?.selected_candidates || []).map((c: any) => String(c.candidate_id))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Top Row: Active Learning Batch Selector + Statistical Power Calculator */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
        <div className="study-card" style={{ marginBottom: 0 }}>
          <div className="study-card-header">
            <h3 className="study-card-title">
              <Sparkles size={17} color="var(--ll-emerald)" />
              <span>{tr("აქტიური სწავლების პარტიის შერჩევა (Next-Batch Optimizer)", "Active Learning Next-Batch Optimizer")}</span>
            </h3>
            <span className="badge badge-physics">EI × PF / Straddle</span>
          </div>
          <p className="study-card-sub" style={{ margin: "0 0 14px" }}>
            {tr(
              "მათემატიკურად აპრიორიტიზებს ღია ექსპერიმენტებს საინფორმაციო ღირებულების (VoI), კონტურის ენტროპიისა და დივერსიფიკაციის მიხედვით.",
              "Mathematically prioritizes which open experiments to run next using Expected Improvement × Probability of Feasibility (EI×PF), Straddle Boundary Entropy, or Space-Filling DoE."
            )}
          </p>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, color: "var(--ll-text-secondary)" }}>
              <span style={{ fontWeight: 600 }}>{tr("სტრატეგია:", "Strategy:")}</span>
              <select
                className="form-select"
                style={{ fontSize: 12, minWidth: 200 }}
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
              >
                <option value="balanced">{tr("ბალანსირებული (50% EI×PF + 50% Straddle)", "Balanced (50% EI×PF + 50% Straddle)")}</option>
                <option value="boundary">{tr("ზღვრის გარჩევა (Straddle Entropy)", "Boundary Resolver (Straddle Contour Entropy)")}</option>
                <option value="best">{tr("მაქსიმალური მოსალოდნელი გაუმჯობესება (EI × PF)", "Max Expected Improvement (EI × PF)")}</option>
                <option value="maximin">{tr("მაქსიმინის სივრცის შემავსებელი DoE", "Maximin Space-Filling DoE")}</option>
                <option value="d_optimal">{tr("D-ოპტიმალური საინფორმაციო DoE", "D-Optimal Linear Information DoE")}</option>
              </select>
            </label>

            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, color: "var(--ll-text-secondary)" }}>
              <span style={{ fontWeight: 600 }}>{tr("პარტიის ზომა (B):", "Batch Size (B):")}</span>
              <input
                type="number"
                min={1}
                max={50}
                className="form-input"
                style={{ width: 68, fontSize: 12 }}
                value={batchSize}
                onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value) || 5))}
              />
            </label>

            <button
              className="btn-primary"
              onClick={handleSelectBatch}
              disabled={selectingBatch}
            >
              <Target size={13} />
              <span>{selectingBatch ? tr("არჩევა...", "Selecting...") : tr("პარტიის ოპტიმიზაცია", "Recommend Next Batch")}</span>
            </button>
          </div>

          {batchError && (
            <div style={{ padding: "8px 12px", background: "var(--ll-rose-soft)", color: "var(--ll-rose-text)", borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{batchError}</div>
          )}

          {batchResult?.selected_candidates?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ll-text-primary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{tr(`საინფორმაციო ღირებულების (VoI) დასაბუთება (${batchResult.selected_candidates.length} შერჩეული):`, `Value-of-Information (VoI) Justification Cards (${batchResult.selected_candidates.length} selected):`)}</span>
              </div>
              {batchResult.selected_candidates.map((sc: any, i: number) => (
                <div
                  key={sc.candidate_id}
                  style={{
                    padding: "10px 14px",
                    background: "var(--ll-blue-soft)",
                    border: "1px solid var(--ll-blue-border)",
                    borderRadius: "var(--ll-radius-md)",
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "var(--ll-blue-text)" }}>
                    <span>
                      #{i + 1} • {tr("კანდიდატი", "Candidate")} #{sc.idx} <span style={{ fontFamily: "var(--ll-font-mono)", fontSize: 11, fontWeight: 400, color: "var(--ll-text-secondary)" }}>({JSON.stringify(sc.values)})</span>
                    </span>
                    <span style={{ fontFamily: "var(--ll-font-mono)" }}>Score: {sc.acquisition_score}</span>
                  </div>
                  <div style={{ marginTop: 4, color: "var(--ll-text-secondary)", fontSize: 11.5, lineHeight: 1.45 }}>
                    {sc.voi_reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Statistical Power & Replicate Calculator */}
        <div className="study-card" style={{ marginBottom: 0 }}>
          <div className="study-card-header">
            <h3 className="study-card-title">
              <Calculator size={17} color="var(--ll-emerald)" />
              <span>{tr("სტატისტიკური სიმძლავრის & გამეორებების კალკულატორი", "Statistical Power & Replicate Calculator")}</span>
            </h3>
            <span className="badge badge-generic">Power Analysis</span>
          </div>
          <p className="study-card-sub" style={{ margin: "0 0 14px" }}>
            {tr(
              "ითვლის მინიმალურ აუცილებელ რეპლიკაციების რაოდენობას (n) ეფექტის სიდიდის (Δ) დასადგენად გაზომვის ხმაურის (σ) ფონზე.",
              "Computes the minimum physical replicates per candidate required to detect a minimum meaningful effect size Δ against measurement noise σ."
            )}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
            <label className="form-group">
              <span className="form-label">{tr("მინ. ეფექტი (Δ)", "Min Effect (Δ)")}</span>
              <input
                className="form-input"
                style={{ fontSize: 12 }}
                value={minEffect}
                onChange={(e) => setMinEffect(e.target.value)}
              />
            </label>
            <label className="form-group">
              <span className="form-label">{tr("ხმაური SD (σ)", "Noise SD (σ)")}</span>
              <input
                className="form-input"
                style={{ fontSize: 12 }}
                value={noiseSd}
                onChange={(e) => setNoiseSd(e.target.value)}
              />
            </label>
            <label className="form-group">
              <span className="form-label">{tr("სამიზნე სიმძლავრე", "Target Power")}</span>
              <input
                className="form-input"
                style={{ fontSize: 12 }}
                value={powerTarget}
                onChange={(e) => setPowerTarget(e.target.value)}
              />
            </label>
          </div>

          <button className="btn-secondary" style={{ width: "100%", marginBottom: 12 }} onClick={handleComputePower}>
            {tr("საჭირო გამეორებების გამოთვლა", "Compute Required Replicates")}
          </button>

          {powerError && <div style={{ padding: "8px 12px", background: "var(--ll-rose-soft)", color: "var(--ll-rose-text)", borderRadius: 6, fontSize: 12 }}>{powerError}</div>}
          {powerResult && (
            <div style={{ padding: 12, background: "var(--ll-emerald-soft)", border: "1px solid var(--ll-emerald-border)", borderRadius: "var(--ll-radius-md)", fontSize: 12.5, color: "var(--ll-emerald-text)" }}>
              <div style={{ fontWeight: 600 }}>
                {tr("რეკომენდებული გამეორებები:", "Recommended Replicates:")} <code style={{ fontFamily: "var(--ll-font-mono)", fontSize: 13 }}>n = {powerResult.required_replicates}</code> {tr("თითო კანდიდატზე", "per candidate")} (Power: {(powerResult.actual_power * 100).toFixed(1)}%)
              </div>
              <div style={{ marginTop: 6, fontSize: 11.5, opacity: 0.9 }}>{powerResult.statement}</div>
            </div>
          )}
        </div>
      </div>

      {/* 2D Phase Diagram Highlighting Recommended Next Batch */}
      <div className="study-card no-print">
        <div className="study-card-header">
          <div>
            <h3 className="study-card-title">
              <Target size={17} color="var(--ll-blue)" />
              <span>{tr("რეკომენდებული პარტიის 2D ფაზური განლაგება", "Next-Batch 2D Phase Allocation")}</span>
            </h3>
            <p className="study-card-sub">
              {tr("ოპტიმიზებული კანდიდატები მონიშნულია ლურჯად ფაზურ სივრცეში მაქსიმალური საინფორმაციო მოგებისთვის.", "Optimized next-batch candidates are highlighted in blue across the active controlled parameter envelope.")}
            </p>
          </div>
          {recommendedSet.size > 0 && (
            <span className="badge badge-status-recommended">
              {recommendedSet.size} {tr("რეკომენდებული კანდიდატი", "candidates queued")}
            </span>
          )}
        </div>
        <PhaseDiagram2D
          candidates={candidatesData?.items || []}
          parameters={parameters || []}
          recommendedIds={recommendedSet}
        />
      </div>

      {/* Printable Split-Plot Lab Protocol Sheet */}
      <LabProtocolSheet
        study={study}
        parameters={parameters || []}
        outcomes={outcomes || []}
      />
    </div>
  );
}

