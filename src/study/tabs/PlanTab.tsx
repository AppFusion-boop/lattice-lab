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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Top Row: Active Learning Batch Selector + Statistical Power Calculator */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <div className="study-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Sparkles size={18} color="#2563eb" />
            <h3 style={{ margin: 0, fontSize: 15 }}>
              {tr("აქტიური სწავლების პარტიის შერჩევა (Next-Batch Optimizer)", "Active Learning Next-Batch Optimizer")}
            </h3>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
            Mathematically prioritizes which open experiments to run next using Expected Improvement × Probability of Feasibility (EI×PF), Straddle Boundary Entropy, or Space-Filling DoE with Kriging-Believer diversity.
          </p>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <strong>Strategy:</strong>
              <select
                className="form-select"
                style={{ fontSize: 12 }}
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
              >
                <option value="balanced">Balanced (50% EI×PF + 50% Straddle Boundary)</option>
                <option value="boundary">Boundary Resolver (Straddle Contour Entropy)</option>
                <option value="best">Max Expected Improvement (EI × PF)</option>
                <option value="maximin">Maximin Space-Filling DoE</option>
                <option value="d_optimal">D-Optimal Linear Information DoE</option>
              </select>
            </label>

            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <strong>Batch Size (B):</strong>
              <input
                type="number"
                min={1}
                max={50}
                className="form-input"
                style={{ width: 64, fontSize: 12 }}
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
              <span>{selectingBatch ? "Selecting..." : "Recommend Next Batch"}</span>
            </button>
          </div>

          {batchError && (
            <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8 }}>{batchError}</div>
          )}

          {batchResult?.selected_candidates?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <strong style={{ fontSize: 12, color: "#1e293b" }}>
                Value-of-Information (VoI) Justification Cards ({batchResult.selected_candidates.length} selected):
              </strong>
              {batchResult.selected_candidates.map((sc: any, i: number) => (
                <div
                  key={sc.candidate_id}
                  style={{
                    padding: "8px 12px",
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "#1e3a8a" }}>
                    <span>
                      #{i + 1} • Candidate #{sc.idx} ({JSON.stringify(sc.values)})
                    </span>
                    <span>Score: {sc.acquisition_score}</span>
                  </div>
                  <div style={{ marginTop: 3, color: "#334155", fontSize: 11.5 }}>
                    {sc.voi_reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Statistical Power & Replicate Calculator */}
        <div className="study-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Calculator size={18} color="#059669" />
            <h3 style={{ margin: 0, fontSize: 15 }}>
              {tr("სტატისტიკური სიმძლავრის და გამეორებების კალკულატორი", "Statistical Power & Replicate Calculator")}
            </h3>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
            Computes the minimum physical replicates per candidate required to detect a minimum meaningful effect size Δ against measurement noise σ.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
            <label style={{ fontSize: 11 }}>
              <div style={{ marginBottom: 3, fontWeight: 600 }}>Min Effect (Δ)</div>
              <input
                className="form-input"
                style={{ fontSize: 12 }}
                value={minEffect}
                onChange={(e) => setMinEffect(e.target.value)}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              <div style={{ marginBottom: 3, fontWeight: 600 }}>Noise SD (σ)</div>
              <input
                className="form-input"
                style={{ fontSize: 12 }}
                value={noiseSd}
                onChange={(e) => setNoiseSd(e.target.value)}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              <div style={{ marginBottom: 3, fontWeight: 600 }}>Target Power</div>
              <input
                className="form-input"
                style={{ fontSize: 12 }}
                value={powerTarget}
                onChange={(e) => setPowerTarget(e.target.value)}
              />
            </label>
          </div>

          <button className="btn-secondary" style={{ fontSize: 12, marginBottom: 10 }} onClick={handleComputePower}>
            Compute Required Replicates
          </button>

          {powerError && <div style={{ fontSize: 12, color: "#b91c1c" }}>{powerError}</div>}
          {powerResult && (
            <div style={{ padding: 10, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 6, fontSize: 12, color: "#065f46" }}>
              <div>
                <strong>Recommended Replicates:</strong> <code>n = {powerResult.required_replicates}</code> per candidate (Actual Power: {(powerResult.actual_power * 100).toFixed(1)}%)
              </div>
              <div style={{ marginTop: 4, fontSize: 11 }}>{powerResult.statement}</div>
            </div>
          )}
        </div>
      </div>

      {/* 2D Phase Diagram Highlighting Recommended Next Batch */}
      <div className="study-card no-print">
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

