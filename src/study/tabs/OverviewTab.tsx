import { useState } from "react";
import {
  Play,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  ListFilter,
  Workflow,
  FileSpreadsheet,
  ArrowRight,
  ShieldCheck,
  Target,
  FlaskConical,
  Database,
  Scale,
  Microscope,
} from "lucide-react";
import { apiPost, apiGet } from "../api/client";
import { useApi, useJob } from "../api/hooks";
import type { Study, ScreeningRun, Job, CandidateSet, Parameter, Outcome, Evidence } from "../api/types";
import { tr } from "../../i18n";
import { navigate } from "../../app/router";
import { RecordExperimentModal } from "../components/RecordExperimentModal";
import { CalibrationWizard } from "../components/CalibrationWizard";

interface OverviewTabProps {
  study: Study;
  onRefreshStudy?: () => void;
}

export function OverviewTab({ study }: OverviewTabProps) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [mcDraws, setMcDraws] = useState<number>(60);

  const {
    data: latestRun,
    refresh: refreshRun,
  } = useApi<ScreeningRun>(`screening-latest-${study.id}`, () =>
    apiGet<ScreeningRun>(`/studies/${study.id}/screening-runs/latest`).catch(() => null as unknown as ScreeningRun),
  );

  const { data: activeSet, refresh: refreshActiveSet } = useApi<CandidateSet>(
    `active-set-${study.id}`,
    () => apiGet<CandidateSet>(`/studies/${study.id}/candidate-sets/active`).catch(() => null as unknown as CandidateSet),
  );

  const { data: parameters } = useApi<Parameter[]>(`params-${study.id}`, () =>
    apiGet<Parameter[]>(`/studies/${study.id}/parameters`).catch(() => [])
  );
  const { data: outcomes } = useApi<Outcome[]>(`outcomes-${study.id}`, () =>
    apiGet<Outcome[]>(`/studies/${study.id}/outcomes`).catch(() => [])
  );
  const { data: evidenceList, refresh: refreshEvidence } = useApi<Evidence[]>(
    `evidence-${study.id}`,
    () => apiGet<Evidence[]>(`/studies/${study.id}/evidence`).catch(() => [])
  );

  const [showRecordModal, setShowRecordModal] = useState<boolean>(false);
  const [showCalibrationModal, setShowCalibrationModal] = useState<boolean>(false);

  const { job, loading: runningJob } = useJob(activeJobId, () => {
    refreshRun();
    refreshActiveSet();
    setActiveJobId(null);
  });

  const handleRunScreening = async () => {
    try {
      const jobRes = await apiPost<Job>(`/studies/${study.id}/screening-runs`, {
        settings: { mc_draws: mcDraws, adaptive: true },
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
  const afterStatistical = funnel?.after_statistical ?? afterConstraints;
  const afterDeprioritised = funnel?.after_deprioritised ?? afterStatistical;
  const recommended = funnel?.recommended ?? summary?.counts_by_status?.recommended ?? 0;
  const excluded = summary?.counts_by_status?.excluded ?? 0;
  const deprioritised = summary?.counts_by_status?.deprioritised ?? 0;
  const openCount = summary?.counts_by_status?.open ?? 0;

  const excludedPct = total > 0 ? ((excluded / total) * 100).toFixed(1) : "0";
  const deprioritisedPct = total > 0 ? ((deprioritised / total) * 100).toFixed(1) : "0";
  const recommendedPct = total > 0 ? ((recommended / total) * 100).toFixed(1) : "0";
  const openPct = total > 0 ? ((openCount / total) * 100).toFixed(1) : "0";
  const savedTestsPct =
    total > 0
      ? (((total - (recommended > 0 ? recommended : afterDeprioritised)) / total) * 100).toFixed(1)
      : "0";

  const isMicroscopeStudy =
    study.domain === "optical_microscopy" ||
    study.name.toLowerCase().includes("microscop") ||
    study.name.toLowerCase().includes("emulsion") ||
    study.name.toLowerCase().includes("microcapsule") ||
    Boolean(study.description && study.description.toLowerCase().includes("microscop"));

  return (
    <div className="overview-container">
      {/* Top Banner & Run Control */}
      <div className="study-card overview-header-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <h3 style={{ margin: "0 0 6px 0", fontSize: 16, fontWeight: 650, color: "#1a2c26" }}>
              {study.name}
            </h3>
            <p style={{ margin: 0, color: "#586b62", fontSize: 13, lineHeight: 1.4 }}>
              {study.description || tr("აღწერა არ არის მითითებული", "No description provided.")}
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 11, color: "#84938b", flexWrap: "wrap" }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              className="form-select"
              value={mcDraws}
              onChange={(e) => setMcDraws(Number(e.target.value))}
              style={{ fontSize: 12, padding: "7px 10px" }}
              title="Adaptive Monte Carlo maximum draws per candidate"
            >
              <option value={60}>{tr("ადაპტური (60 ცდა — 95% სანდოობა)", "Standard Adaptive (up to 60 draws)")}</option>
              <option value={200}>{tr("მაღალი სიზუსტე (200 ცდა)", "High Precision (up to 200 draws)")}</option>
              <option value={20}>{tr("სწრაფი გადახედვა (20 ცდა)", "Fast Preview (20 draws)")}</option>
            </select>
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

      {/* Dedicated Micrograph Hero Card for Microscope Studies */}
      {isMicroscopeStudy && (
        <div
          className="study-card"
          style={{
            background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)",
            color: "#1a2c26",
            border: "1px solid #bbf7d0",
            padding: "16px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                background: "#d1fae5",
                border: "1px solid #a7f3d0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: "#065f46",
              }}
            >
              <Microscope size={24} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#065f46" }}>
                  {tr("ციფრული გამავალი მიკროსკოპის ხედი", "Digital Transmissive Micrograph View")}
                </h4>
                <span
                  style={{
                    fontSize: 10,
                    background: "#dcfce7",
                    color: "#166534",
                    padding: "2px 7px",
                    borderRadius: 4,
                    border: "1px solid #86efac",
                    fontWeight: 650,
                  }}
                >
                  Live 2D Wave Optics
                </span>
              </div>
              <p style={{ margin: "4px 0 0 0", color: "#4b5563", fontSize: 12 }}>
                {tr(
                  "დაათვალიერეთ სიმულირებული მიკროგრაფი, აბეს დიფრაქციული გაბუნდოვნება (PSF), ლამბერტ-ბერის შთანთქმა და დენსიტომეტრიული ანალიზი.",
                  "Inspect live simulated 2D micrograph, Abbe diffraction PSF blur, Beer–Lambert transmission, and optical densitometry.",
                )}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => navigate(`studies/${study.id}/micrograph`)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "#059669",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 12,
                fontWeight: 650,
                cursor: "pointer",
              }}
            >
              <Microscope size={14} />
              <span>{tr("მიკროსკოპის გახსნა (Open Micrograph)", "Open Micrograph View")}</span>
              <ArrowRight size={13} />
            </button>
            <button
              onClick={() => navigate(`studies/${study.id}/flow`)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "#ffffff",
                color: "#374151",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Workflow size={13} />
              <span>{tr("3D ფლოუ", "3D Flow")}</span>
            </button>
          </div>
        </div>
      )}

      {/* Scientific Executive Verdict Banner */}
      {latestRun && total > 0 && (
        <div className="verdict-banner">
          <div className="verdict-header">
            <div className="verdict-badge-row">
              {recommended > 0 ? (
                <span className="verdict-pill pill-success">
                  <Target size={14} />
                  {tr(
                    `${recommended} შერჩეული კანდიდატი (${savedTestsPct}% რესურსის ეკონომია)`,
                    `${recommended} Field Candidates Recommended (${savedTestsPct}% Lab Work Saved)`,
                  )}
                </span>
              ) : (
                <span className="verdict-pill pill-viable">
                  <ShieldCheck size={14} />
                  {tr(
                    `${afterConstraints} შემოწმებადი კანდიდატი (${excludedPct}% ეკონომია)`,
                    `${afterConstraints} Candidates Viable (${excludedPct}% Unfeasible Ruled Out)`,
                  )}
                </span>
              )}
            </div>
            <span className="verdict-timestamp">
              {tr("სკრინინგის დრო:", "Screened:")} {new Date(latestRun.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          <div className="verdict-body">
            <h4 className="verdict-title">
              {recommended > 0
                ? tr("სამეცნიერო დასკვნა: პრიორიტეტული საველე ტესტირების სერია გამოყოფილია", "Scientific Verdict: Priority Field Acquisition Batch Identified")
                : tr("სამეცნიერო დასკვნა: შემოწმებადი კანდიდატების აუზი იზოლირებულია", "Scientific Verdict: Feasible Experimental Pool Isolated")}
            </h4>
            <p className="verdict-text">
              {recommended > 0 ? (
                tr(
                  `ფიზიკური შეზღუდვების (ტუმბოს წარმადობა) და 3D სიმულაციური მოდელის ანალიზის შედეგად, საწყისი ${total.toLocaleString()} ვარიაციიდან ${excluded.toLocaleString()} (${excludedPct}%) უარყოფილია, ხოლო ${deprioritised.toLocaleString()} დეპრიორიტიზებულია. ${recommended.toLocaleString()} კანდიდატი (${recommendedPct}%) აჩვენებს აფეთქების მაღალ ჩახშობას და რეკომენდებულია საველე ექსპერიმენტებისთვის — რაც ლაბორატორიულ დანახარჯებს ${savedTestsPct}%-ით ამცირებს.`,
                  `Through physical pump limits and 3D blast wave simulation under uncertainty, Lattice Lab evaluated ${total.toLocaleString()} candidate variations. ${excluded.toLocaleString()} (${excludedPct}%) were eliminated as physically unfeasible and ${deprioritised.toLocaleString()} were deprioritised by simulated overpressure. ${recommended.toLocaleString()} high-confidence candidates (${recommendedPct}%) achieve target blast mitigation, narrowing real-world acquisition by ${savedTestsPct}%.`,
                )
              ) : (
                tr(
                  `საწყისი ${total.toLocaleString()} ვარიაციიდან ${excluded.toLocaleString()} (${excludedPct}%) ცალსახად უარყოფილია ფიზიკური შეზღუდვებით. დარჩენილი ${afterConstraints.toLocaleString()} კანდიდატი წარმოადგენს შემოწმებად აუზს.`,
                  `Out of ${total.toLocaleString()} initial variations, ${excluded.toLocaleString()} (${excludedPct}%) were definitively eliminated by physical constraints. The surviving ${afterConstraints.toLocaleString()} candidates form your viable pool ready for 3D simulation or field trials.`,
                )
              )}
            </p>

            <div className="verdict-actions">
              <button
                className="btn-primary"
                onClick={() =>
                  navigate(
                    `studies/${study.id}/candidates?status=${
                      recommended > 0 ? "recommended" : "open"
                    }`,
                  )
                }
              >
                <ListFilter size={13} style={{ marginRight: 6 }} />
                <span>
                  {recommended > 0
                    ? tr(`რეკომენდებული ${recommended} კანდიდატის ნახვა`, `View ${recommended} Recommended Candidates`)
                    : tr(`შემოწმებადი ${afterConstraints} კანდიდატის ნახვა`, `View ${afterConstraints} Viable Candidates`)}
                </span>
                <ArrowRight size={13} style={{ marginLeft: 6 }} />
              </button>

              <button
                className="btn-primary"
                onClick={() => setShowRecordModal(true)}
                style={{
                  background: "#059669",
                  borderColor: "#059669",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <FlaskConical size={13} style={{ marginRight: 6 }} />
                <span>{tr("რეალური ცდის აღრიცხვა", "Record Lab Run")}</span>
              </button>

              {isMicroscopeStudy && (
                <button
                  className="btn-secondary"
                  onClick={() => navigate(`studies/${study.id}/micrograph`)}
                  style={{
                    color: "#059669",
                    borderColor: "#05966988",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <Microscope size={13} style={{ marginRight: 6 }} />
                  <span>{tr("მიკროსკოპის ხედი", "Micrograph View")}</span>
                </button>
              )}

              <button
                className="btn-secondary"
                onClick={() => navigate(`studies/${study.id}/flow`)}
              >
                <Workflow size={13} style={{ marginRight: 6 }} />
                <span>{tr("3D ფლოუში მოდელის დათვალიერება", "Inspect in 3D Flow")}</span>
              </button>

              <button
                className="btn-secondary"
                onClick={() => navigate(`studies/${study.id}/evidence`)}
              >
                <FileSpreadsheet size={13} style={{ marginRight: 6 }} />
                <span>{tr("საველე ცხრილის ექსპორტი (Run Sheet)", "Export Lab Run Sheet")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4 Focused Metric Stat Boxes */}
      <div className="stat-grid">
        <div className="stat-box">
          <div className="stat-box-label">{tr("საწყისი ვარიაციები", "Initial Space")}</div>
          <div className="stat-box-value">{total.toLocaleString()}</div>
          <div className="stat-box-sub">{tr("გამოკვლეული სივრცე", "Explored variations")}</div>
        </div>

        <div className="stat-box">
          <div className="stat-box-label">{tr("ფიზიკურად უარყოფილი", "Feasibility Ruled Out")}</div>
          <div className="stat-box-value" style={{ color: "#dc2626" }}>
            {excluded.toLocaleString()}
          </div>
          <div className="stat-box-sub">
            {excludedPct}% {tr("დაზოგილი ლაბორატორია", "lab tests saved")}
          </div>
        </div>

        <div className="stat-box">
          <div className="stat-box-label">{tr("სიმულირებული შემოწმებადი", "Simulated Viable")}</div>
          <div className="stat-box-value" style={{ color: "#2563eb" }}>
            {afterDeprioritised.toLocaleString()}
          </div>
          <div className="stat-box-sub">
            {deprioritised > 0 ? `${deprioritised} ${tr("დეპრიორიტიზებული", "deprioritised")}` : tr("გამვლელი აუზი", "passing pool")}
          </div>
        </div>

        <div className="stat-box">
          <div className="stat-box-label">{tr("საველე ტესტირების სერია", "Field Test Batch")}</div>
          <div className="stat-box-value" style={{ color: "#16a34a" }}>
            {recommended > 0 ? recommended.toLocaleString() : afterDeprioritised.toLocaleString()}
          </div>
          <div className="stat-box-sub">
            {recommended > 0 ? `${recommendedPct}% ${tr("პრიორიტეტული სამიზნე", "acquisition target")}` : tr("მზადაა ტესტირებისთვის", "ready for testing")}
          </div>
        </div>
      </div>

      {/* Empirical Ground Truth & Calibration Card */}
      <div
        className="study-card"
        style={{
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          padding: "16px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: "#dcfce7",
              color: "#15803d",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FlaskConical size={20} />
          </div>
          <div>
            <h4 style={{ margin: "0 0 2px 0", fontSize: 14, fontWeight: 700, color: "#166534" }}>
              {tr("ფიზიკური ემპირიული ჭეშმარიტება & კალიბრაცია", "Physical Ground Truth & Calibration")}
            </h4>
            <p style={{ margin: 0, fontSize: 12, color: "#15803d" }}>
              {evidenceList && evidenceList.length > 0
                ? tr(
                    `ჩაწერილია ${evidenceList.filter((e) => e.status === "valid" && !e.retracted_at).length} ვალიდური ლაბორატორიული გაზომვა. მონაცემები ემსახურება მოდელის კალიბრაციას და კანდიდატთა გადამოწმებას.`,
                    `${evidenceList.filter((e) => e.status === "valid" && !e.retracted_at).length} valid bench measurements logged as immutable ground truth.`,
                  )
                : tr(
                    "შეიტანეთ რეალური ლაბორატორიული ან საველე გაზომვები, რათა პროგრამამ მოარგოს სიმულაციური მოდელი რეალობას (Zero-Guesswork).",
                    "Input actual physical measurements from your test bench or field to anchor screening in physical reality.",
                  )}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {evidenceList && evidenceList.filter((e) => e.status === "valid" && !e.retracted_at).length >= 3 && (
            <button
              className="btn-primary"
              onClick={() => setShowCalibrationModal(true)}
              style={{
                background: "#0284c7",
                borderColor: "#0284c7",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                fontSize: 12,
              }}
            >
              <Sparkles size={13} />
              <span>{tr("მოდელის კალიბრაცია", "Calibrate Model")}</span>
            </button>
          )}

          <button
            className="btn-primary"
            onClick={() => setShowRecordModal(true)}
            style={{
              background: "#16a34a",
              borderColor: "#16a34a",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              fontSize: 12,
            }}
          >
            <FlaskConical size={13} />
            <span>{tr("რეალური ცდის შეტანა", "Record Real Lab Run")}</span>
          </button>
        </div>
      </div>

      {/* Candidate Pool Composition Bar */}
      {total > 0 && (
        <div className="study-card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 650, color: "#1a2c26" }}>
              {tr("კანდიდატთა აუზის შემადგენლობა (Composition)", "Candidate Pool Composition")}
            </h4>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {tr("დააწკაპუნეთ ჯგუფზე ცხრილში გასაფილტრად", "Click any category to filter Candidates")}
            </span>
          </div>

          {/* Segmented Track */}
          <div className="pool-bar-track">
            {recommended > 0 && (
              <div
                className="pool-segment seg-recommended"
                style={{ width: `${(recommended / total) * 100}%` }}
                onClick={() => navigate(`studies/${study.id}/candidates?status=recommended`)}
                title={`Recommended: ${recommended} (${recommendedPct}%)`}
              />
            )}
            {openCount > 0 && (
              <div
                className="pool-segment seg-open"
                style={{ width: `${(openCount / total) * 100}%` }}
                onClick={() => navigate(`studies/${study.id}/candidates?status=open`)}
                title={`Open Viable: ${openCount} (${openPct}%)`}
              />
            )}
            {deprioritised > 0 && (
              <div
                className="pool-segment seg-deprioritised"
                style={{ width: `${(deprioritised / total) * 100}%` }}
                onClick={() => navigate(`studies/${study.id}/candidates?status=deprioritised`)}
                title={`Deprioritised: ${deprioritised} (${deprioritisedPct}%)`}
              />
            )}
            {excluded > 0 && (
              <div
                className="pool-segment seg-excluded"
                style={{ width: `${(excluded / total) * 100}%` }}
                onClick={() => navigate(`studies/${study.id}/candidates?status=excluded`)}
                title={`Excluded: ${excluded} (${excludedPct}%)`}
              />
            )}
          </div>

          {/* Legend Chips */}
          <div className="pool-legend">
            <button
              className="pool-legend-btn"
              onClick={() => navigate(`studies/${study.id}/candidates?status=recommended`)}
            >
              <span className="dot dot-recommended" />
              <span>{tr("რეკომენდებული:", "Recommended:")} <strong>{recommended}</strong> ({recommendedPct}%)</span>
            </button>

            <button
              className="pool-legend-btn"
              onClick={() => navigate(`studies/${study.id}/candidates?status=open`)}
            >
              <span className="dot dot-open" />
              <span>{tr("შემოწმებადი (ღია):", "Open Viable:")} <strong>{openCount}</strong> ({openPct}%)</span>
            </button>

            {deprioritised > 0 && (
              <button
                className="pool-legend-btn"
                onClick={() => navigate(`studies/${study.id}/candidates?status=deprioritised`)}
              >
                <span className="dot dot-deprioritised" />
                <span>{tr("დეპრიორიტიზებული:", "Deprioritised:")} <strong>{deprioritised}</strong> ({deprioritisedPct}%)</span>
              </button>
            )}

            <button
              className="pool-legend-btn"
              onClick={() => navigate(`studies/${study.id}/candidates?status=excluded`)}
            >
              <span className="dot dot-excluded" />
              <span>{tr("უარყოფილი:", "Excluded:")} <strong>{excluded}</strong> ({excludedPct}%)</span>
            </button>
          </div>
        </div>
      )}

      {/* Scientific Funnel Chart */}
      <div className="study-card">
        <div className="study-card-header">
          <h4 className="study-card-title">{tr("ექსპერიმენტების სკრინინგის ძაბრი (Funnel)", "Experiment Screening Funnel")}</h4>
          {latestRun && (
            <span style={{ fontSize: 11, color: "#84938b" }}>
              {tr("ბოლო გაშვება:", "Last Run:")} {new Date(latestRun.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {total === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 16px", color: "#84938b" }}>
            <AlertCircle size={28} style={{ margin: "0 auto 8px auto", display: "block", opacity: 0.6 }} />
            <p style={{ margin: 0 }}>
              {tr(
                "კვლევას არ აქვს გენერირებული კანდიდატები. გადადით 'კანდიდატების' ჩანართზე შესაქმნელად.",
                "No candidates generated yet. Open the 'Candidates' tab to generate or import candidate variations.",
              )}
            </p>
          </div>
        ) : (
          <div className="funnel-container">
            {/* Step 1: Initial Space */}
            <div className="funnel-step">
              <div className="funnel-step-label">
                <span className="funnel-step-name">1. {tr("საწყისი კანდიდატების სივრცე", "Initial Parameter Space")}</span>
                <span className="funnel-step-val">{total.toLocaleString()} (100%)</span>
              </div>
              <div className="funnel-bar-track">
                <div className="funnel-bar-fill funnel-step-1" style={{ width: "100%" }}>
                  {total.toLocaleString()}
                </div>
              </div>
              <div className="funnel-sublabel">
                {tr(
                  "სრული მრავალგანზომილებიანი სივრცე გენერირებული პარამეტრების მიხედვით.",
                  "Full multidimensional parameter space generated across experimental variables.",
                )}
              </div>
            </div>

            {/* Step 2: After Constraints */}
            <div className="funnel-step">
              <div className="funnel-step-label">
                <span className="funnel-step-name">2. {tr("ფიზიკური შეზღუდვების შემდეგ (Feasibility Gate)", "Physical Feasibility Gate")}</span>
                <span className="funnel-step-val">
                  {afterConstraints.toLocaleString()} ({total > 0 ? ((afterConstraints / total) * 100).toFixed(1) : 0}%)
                </span>
              </div>
              <div className="funnel-bar-track">
                <div
                  className="funnel-bar-fill funnel-step-2"
                  style={{
                    width: `${total > 0 ? Math.max(2, (afterConstraints / total) * 100) : 0}%`,
                  }}
                >
                  {afterConstraints.toLocaleString()}
                </div>
              </div>
              <div className="funnel-sublabel">
                {tr(
                  `${excluded.toLocaleString()} ვარიაცია გამორიცხულია ტუმბოს მაქსიმალური წარმადობისა და ფიზიკური შეზღუდვებით.`,
                  `${excluded.toLocaleString()} unfeasible variations eliminated by pump capacity & physical bounds.`,
                )}
              </div>
            </div>

            {/* Step 3: 3D Simulation Screening */}
            <div className="funnel-step">
              <div className="funnel-step-label">
                <span className="funnel-step-name">3. {tr("3D ფიზიკური სიმულაციის შემდეგ", "3D Physics Simulation Gate")}</span>
                <span className="funnel-step-val">
                  {afterDeprioritised.toLocaleString()} ({total > 0 ? ((afterDeprioritised / total) * 100).toFixed(1) : 0}%)
                </span>
              </div>
              <div className="funnel-bar-track">
                <div
                  className="funnel-bar-fill funnel-step-3"
                  style={{
                    width: `${total > 0 ? Math.max(2, (afterDeprioritised / total) * 100) : 0}%`,
                  }}
                >
                  {afterDeprioritised.toLocaleString()}
                </div>
              </div>
              <div className="funnel-sublabel">
                {deprioritised > 0
                  ? tr(
                      `${deprioritised.toLocaleString()} კანდიდატი დეპრიორიტიზებულია სიმულირებული ზეწნევის გამო (> 8,000 Pa).`,
                      `${deprioritised.toLocaleString()} candidates deprioritised due to simulated peak overpressure under uncertainty (> 8,000 Pa).`,
                    )
                  : tr(
                      "სიმულაციური სკრინინგი 3D ფიზიკური მოდელის მიხედვით.",
                      "Simulation screening evaluated through active 3D physics flow model.",
                    )}
              </div>
            </div>

            {/* Step 4: Recommended Acquisition Batch */}
            <div className="funnel-step">
              <div className="funnel-step-label">
                <span className="funnel-step-name">
                  4.{" "}
                  {recommended > 0
                    ? tr("საველე ტესტირების რეკომენდებული სერია", "Recommended Field Acquisition Batch")
                    : tr("საველე ტესტირებისთვის მზადმყოფი აუზი", "Viable Candidates Pool Ready for Field Testing")}
                </span>
                <span className="funnel-step-val">
                  {recommended > 0
                    ? `${recommended.toLocaleString()} (${recommendedPct}%)`
                    : `${afterDeprioritised.toLocaleString()} (${total > 0 ? ((afterDeprioritised / total) * 100).toFixed(1) : 0}%)`}
                </span>
              </div>
              <div className="funnel-bar-track">
                <div
                  className="funnel-bar-fill funnel-step-4"
                  style={{
                    width: `${
                      total > 0
                        ? Math.max(
                            2,
                            ((recommended > 0 ? recommended : afterDeprioritised) / total) * 100,
                          )
                        : 0
                    }%`,
                  }}
                >
                  {recommended > 0 ? `${recommended} recommended` : `${afterDeprioritised.toLocaleString()} viable`}
                </div>
              </div>
              <div className="funnel-sublabel" style={{ color: recommended > 0 ? "#15803d" : "#64748b", fontWeight: recommended > 0 ? 600 : 400 }}>
                {recommended > 0
                  ? tr(
                      `${recommended} კანდიდატი აკმაყოფილებს აფეთქების ჩახშობის მიზანს (≥ 70%) მაღალი სტატისტიკური სანდოობით.`,
                      `${recommended} candidates achieve target blast mitigation (≥ 70%) with high statistical confidence.`,
                    )
                  : tr(
                      `ყველა ${afterDeprioritised.toLocaleString()} შემოწმებადი კანდიდატი მზადაა საველე ტესტირებისთვის.`,
                      `All ${afterDeprioritised.toLocaleString()} surviving candidates are viable for field testing.`,
                    )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter Verdict Breakdown */}
      {latestRun && summary && (
        <div className="study-card">
          <h4 className="study-card-title" style={{ marginBottom: 12 }}>
            {tr("გამორიცხვის დეტალები (Screening Filter Breakdown)", "Screening Filter Breakdown")}
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
                    ? tr("ფიზიკური შეზღუდვები (Hard Constraint)", "Physical Constraint Limit")
                    : filterName === "model"
                    ? tr("3D სიმულაციური მოდელი (Flow Model)", "3D Simulation (Flow Model)")
                    : filterName === "override"
                    ? tr("ხელით მინიჭებული (Override)", "Manual Override")
                    : filterName === "constraint_error"
                    ? tr("გამოთვლის შეცდომა (Error Flag)", "Calculation Error Flag")
                    : tr("შეზღუდვების გამვლელი (Open)", "Passed Constraints (Open)")}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--mono)" }}>{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Record Real Physical Experiment Modal */}
      {showRecordModal && (
        <RecordExperimentModal
          isOpen={showRecordModal}
          onClose={() => setShowRecordModal(false)}
          study={study}
          parameters={parameters || []}
          outcomes={outcomes || []}
          existingEvidenceCount={evidenceList?.filter((e) => e.status === "valid" && !e.retracted_at).length || 0}
          onEvidenceRecorded={() => {
            refreshRun();
            refreshActiveSet();
            refreshEvidence();
          }}
          onOpenCalibration={() => setShowCalibrationModal(true)}
        />
      )}

      {/* Calibration Wizard Modal */}
      {showCalibrationModal && (
        <CalibrationWizard
          isOpen={showCalibrationModal}
          onClose={() => setShowCalibrationModal(false)}
          study={study}
          parameters={parameters || []}
          outcomes={outcomes || []}
          evidence={evidenceList || []}
          onModelUpgraded={() => {
            refreshRun();
            refreshActiveSet();
            refreshEvidence();
          }}
        />
      )}
    </div>
  );
}
