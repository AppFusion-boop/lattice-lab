import { useState } from "react";
import { Play, CheckCircle, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { apiPost, apiGet } from "../api/client";
import { useApi, useJob } from "../api/hooks";
import type { Study, ScreeningRun, Job, CandidateSet } from "../api/types";
import { tr } from "../../i18n";

interface OverviewTabProps {
  study: Study;
  onRefreshStudy?: () => void;
}

export function OverviewTab({ study }: OverviewTabProps) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const {
    data: latestRun,
    loading: loadingRun,
    refresh: refreshRun,
  } = useApi<ScreeningRun>(`screening-latest-${study.id}`, () =>
    apiGet<ScreeningRun>(`/studies/${study.id}/screening-runs/latest`).catch(() => null as unknown as ScreeningRun)
  );

  const { data: activeSet, refresh: refreshActiveSet } = useApi<CandidateSet>(
    `active-set-${study.id}`,
    () => apiGet<CandidateSet>(`/studies/${study.id}/candidate-sets/active`).catch(() => null as unknown as CandidateSet)
  );

  const { job, loading: runningJob } = useJob(activeJobId, () => {
    refreshRun();
    refreshActiveSet();
    setActiveJobId(null);
  });

  const handleRunScreening = async () => {
    try {
      const jobRes = await apiPost<Job>(`/studies/${study.id}/screening-runs`, {
        settings: {},
      });
      setActiveJobId(jobRes.id);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const summary = latestRun?.summary;
  const funnel = summary?.funnel;
  const total = funnel?.total ?? activeSet?.count ?? 0;
  const afterConstraints = funnel?.after_constraints ?? total;
  const recommended = funnel?.recommended ?? 0;
  const excluded = summary?.counts_by_status?.excluded ?? 0;
  const excludedPct = total > 0 ? ((excluded / total) * 100).toFixed(1) : "0";

  return (
    <div>
      {/* Top Banner / Actions */}
      <div className="study-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <h3 style={{ margin: "0 0 6px 0", fontSize: 16, fontWeight: 650, color: "#1a2c26" }}>
              {study.name}
            </h3>
            <p style={{ margin: 0, color: "#586b62", fontSize: 13, lineHeight: 1.4 }}>
              {study.description || tr("აღწერა არ არის მითითებული", "No description provided.")}
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 11, color: "#84938b" }}>
              <span>
                {tr("გამორიცხვის ზღვარი (τ):", "Exclusion threshold (τ):")}{" "}
                <strong style={{ color: "#354a41" }}>{study.exclusion_threshold}</strong>
              </span>
              <span>•</span>
              <span>
                {tr("სანდოობა (1−δ):", "Confidence (1−δ):")}{" "}
                <strong style={{ color: "#354a41" }}>{study.confidence}</strong>
              </span>
              <span>•</span>
              <span>
                {tr("სტატუსი:", "Status:")}{" "}
                <span className={`badge ${study.archived ? "badge-status-deprioritised" : "badge-status-recommended"}`}>
                  {study.archived ? tr("დაარქივებული", "Archived") : tr("აქტიური", "Active")}
                </span>
              </span>
            </div>
          </div>

          <div>
            <button
              className="btn-primary"
              onClick={handleRunScreening}
              disabled={runningJob || !activeSet || activeSet.count === 0}
              style={{ padding: "9px 18px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              {runningJob ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
              <span>{runningJob ? tr("მიმდინარეობს სკრინინგი...", "Screening in progress...") : tr("სკრინინგის გაშვება", "Run Screening")}</span>
            </button>
          </div>
        </div>

        {/* Live Job Progress Banner */}
        {runningJob && job && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              borderRadius: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, color: "#065f46", marginBottom: 6 }}>
              <span>{job.message || tr("მუშავდება კანდიდატები...", "Evaluating candidate batch...")}</span>
              <span>{Math.round(job.progress * 100)}%</span>
            </div>
            <div style={{ width: "100%", height: 6, background: "#d1fae5", borderRadius: 3, overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.round(job.progress * 100)}%`,
                  height: "100%",
                  background: "#059669",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Metric Cards */}
      <div className="stat-grid">
        <div className="stat-box">
          <div className="stat-box-label">{tr("სულ კანდიდატები", "Total Candidates")}</div>
          <div className="stat-box-value">{total.toLocaleString()}</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-label">{tr("გამორიცხული ვარიანტები", "Ruled Out Candidates")}</div>
          <div className="stat-box-value" style={{ color: "#dc2626" }}>
            {excluded.toLocaleString()}{" "}
            <span style={{ fontSize: 13, fontWeight: 500, color: "#84938b" }}>({excludedPct}%)</span>
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-box-label">{tr("შემოწმებას დაქვემდებარებული", "Viable Candidates")}</div>
          <div className="stat-box-value" style={{ color: "#2563eb" }}>
            {afterConstraints.toLocaleString()}
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-box-label">{tr("რეკომენდებული საველედ", "Recommended for Testing")}</div>
          <div className="stat-box-value" style={{ color: "#16a34a" }}>
            {recommended.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Scientific Funnel Chart */}
      <div className="study-card">
        <div className="study-card-header">
          <h4 className="study-card-title">{tr("ექსპერიმენტების სკრინინგის ძაბრი (Funnel)", "Experiment Screening Funnel")}</h4>
          {latestRun && (
            <span style={{ fontSize: 11, color: "#84938b" }}>
              {tr("ბოლო გაშვება:", "Last Run:")} {new Date(latestRun.created_at).toLocaleString()}
            </span>
          )}
        </div>

        {total === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 16px", color: "#84938b" }}>
            <AlertCircle size={28} style={{ margin: "0 auto 8px auto", display: "block", opacity: 0.6 }} />
            <p style={{ margin: 0 }}>
              {tr(
                "კვლევას არ აქვს გენერირებული კანდიდატები. გადადით 'კანდიდატების' ჩანართზე შესაქმნელად.",
                "No candidates generated yet. Open the 'Candidates' tab to generate or import candidate variations."
              )}
            </p>
          </div>
        ) : (
          <div className="funnel-container">
            {/* Step 1: Total */}
            <div className="funnel-step">
              <div className="funnel-step-label">
                <span>1. {tr("საწყისი კანდიდატების სივრცე", "Initial Parameter Space (Total Variations)")}</span>
                <span>{total.toLocaleString()} (100%)</span>
              </div>
              <div className="funnel-bar-track">
                <div className="funnel-bar-fill" style={{ width: "100%" }}>
                  {total.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Step 2: After Constraints */}
            <div className="funnel-step">
              <div className="funnel-step-label">
                <span>2. {tr("ფიზიკური და მათემატიკური შეზღუდვების შემდეგ", "After Physical & Mathematical Constraints")}</span>
                <span>
                  {afterConstraints.toLocaleString()} ({total > 0 ? ((afterConstraints / total) * 100).toFixed(1) : 0}%)
                </span>
              </div>
              <div className="funnel-bar-track">
                <div
                  className="funnel-bar-fill"
                  style={{
                    width: `${total > 0 ? Math.max(2, (afterConstraints / total) * 100) : 0}%`,
                  }}
                >
                  {afterConstraints.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Step 3: After Statistical Exclusion */}
            <div className="funnel-step">
              <div className="funnel-step-label">
                <span>3. {tr("სტატისტიკური პროგნოზების შემდეგ (P3-P4)", "After Statistical Exclusion (P3-P4)")}</span>
                <span>
                  {funnel?.after_statistical ?? afterConstraints} ({total > 0 ? (((funnel?.after_statistical ?? afterConstraints) / total) * 100).toFixed(1) : 0}%)
                </span>
              </div>
              <div className="funnel-bar-track">
                <div
                  className="funnel-bar-fill"
                  style={{
                    width: `${total > 0 ? Math.max(2, ((funnel?.after_statistical ?? afterConstraints) / total) * 100) : 0}%`,
                    background: "linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)",
                  }}
                >
                  {funnel?.after_statistical ?? afterConstraints}
                </div>
              </div>
            </div>

            {/* Step 4: Recommended */}
            <div className="funnel-step">
              <div className="funnel-step-label">
                <span>4. {tr("შერჩეული და რეკომენდებული საველედ", "Recommended for Real-world Field Experiments")}</span>
                <span>
                  {recommended} ({total > 0 ? ((recommended / total) * 100).toFixed(1) : 0}%)
                </span>
              </div>
              <div className="funnel-bar-track">
                <div
                  className="funnel-bar-fill recommended"
                  style={{
                    width: `${total > 0 ? Math.max(recommended > 0 ? 2 : 0, (recommended / total) * 100) : 0}%`,
                  }}
                >
                  {recommended}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Screening Run Breakdown */}
      {latestRun && summary && (
        <div className="study-card">
          <h4 className="study-card-title" style={{ marginBottom: 12 }}>
            {tr("გამორიცხვის დეტალები", "Filter Verdict Breakdown")}
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {Object.entries(summary.counts_by_filter).map(([filterName, count]) => (
              <div
                key={filterName}
                style={{
                  padding: "10px 14px",
                  background: "#f9fafb",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 500, color: "#475569" }}>
                  {filterName === "constraint"
                    ? tr("შეზღუდვებით გამორიცხული", "Violates Hard Constraint")
                    : filterName === "override"
                    ? tr("ხელით მინიჭებული (Override)", "Manual Override")
                    : filterName === "constraint_error"
                    ? tr("გამოთვლის შეცდომა (Error Flag)", "Calculation Error Flag")
                    : tr("შეზღუდვების გამვლელი (Open)", "Passed Constraints (Open)")}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--mono)" }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
