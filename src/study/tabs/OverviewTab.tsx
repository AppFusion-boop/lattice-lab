import { useState, useMemo } from "react";
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
  Sliders,
  Layers,
  ChevronRight,
} from "lucide-react";
import { apiPost, apiGet } from "../api/client";
import { useApi, useJob } from "../api/hooks";
import type { Study, ScreeningRun, Job, CandidateSet, Parameter, Outcome, Evidence } from "../api/types";
import { tr } from "../../i18n";
import { navigate } from "../../app/router";
import { RecordExperimentModal } from "../components/RecordExperimentModal";
import { CalibrationWizard } from "../components/CalibrationWizard";
import "../study.css";

interface OverviewTabProps {
  study: Study;
  onRefreshStudy?: () => void;
}

export function OverviewTab({ study, onRefreshStudy }: OverviewTabProps) {
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
    (study.description && study.description.toLowerCase().includes("microscop"));

  const validEvidence = evidenceList?.filter((e) => e.status === "valid" && !e.retracted_at) || [];

  // Domain-adaptive verdict description
  const domainNarrative = useMemo(() => {
    const isTunnel = study.name.toLowerCase().includes("blast") || study.name.toLowerCase().includes("tunnel");
    const isSkyscraper = study.name.toLowerCase().includes("skyscraper") || study.name.toLowerCase().includes("cement");
    const isMicrochannel = study.name.toLowerCase().includes("cold") || study.name.toLowerCase().includes("channel");
    const isDrug = study.domain === "chemistry" || study.domain === "biology" || study.name.toLowerCase().includes("drug");

    if (isTunnel) {
      return {
        constraints: tr("ტუმბოს მაქსიმალური წარმადობისა და წნევის ფიზიკური შეზღუდვებით", "physical pump capacity limits and pressure constraints"),
        deprioritised: tr("სიმულირებული ზეწნევის გამო (> 8,000 Pa)", "simulated peak overpressure (> 8,000 Pa) under uncertainty"),
        recommended: tr("აკმაყოფილებს აფეთქების ჩახშობის სამიზნე კრიტერიუმს (≥ 70%)", "achieves target blast wave overpressure attenuation"),
      };
    }
    if (isSkyscraper) {
      return {
        constraints: tr("კუმშვაზე სიმტკიცის, მინაბოჭკოსა და პოლიმერის შემცველობის შეზღუდვებით", "compressive strength (fc >= 80 MPa) and fiber-polymer ratio constraints"),
        deprioritised: tr("ქარის დინამიური აჩქარების გადაჭარბების გამო (> 18 milli-g)", "peak dynamic wind gust acceleration exceeding tolerance (> 18 milli-g)"),
        recommended: tr("აჩვენებს ოპტიმალურ დემპფირებასა და ნახშირბადის დაბალ კვალს", "achieves certified structural damping and low embodied carbon"),
      };
    }
    if (isMicrochannel) {
      return {
        constraints: tr("ფარდობითი გეომეტრიისა და არხების ნაბიჯის წარმოებადობის შეზღუდვებით", "channel aspect ratio (<= 8.5) and minimum fin pitch constraints"),
        deprioritised: tr("გადახურების ან ჰიდრავლიკური წნევის ვარდნის გადაჭარბების გამო", "junction temperature (> 75 °C) or hydraulic pressure drop (> 40 kPa)"),
        recommended: tr("უზრუნველყოფს ეფექტურ გაგრილებას მინიმალური ტუმბვის ენერგიით", "delivers maximum heat flux dissipation with minimal pumping power"),
      };
    }
    if (isDrug) {
      return {
        constraints: tr("ლიპინსკის ხუთის წესითა და მოლეკულური მასის შეზღუდვებით", "Lipinski Rule of Five and molecular weight filters"),
        deprioritised: tr("არასასურველი ტოქსიკურობისა და დაბალი გამტარიანობის გამო", "predicted cellular toxicity or poor membrane permeability"),
        recommended: tr("აჩვენებს მაღალ ფარმაკოლოგიურ თავსებადობას", "demonstrates high drug-likeness and favorable therapeutic window"),
      };
    }

    return {
      constraints: tr("ფიზიკური და უსაფრთხოების მკაცრი შეზღუდვებით", "physical feasibility and safety constraints"),
      deprioritised: tr("სიმულირებული შედეგების ზღვრების გადაჭარბების გამო", "simulated outcome bounds exceeding acceptable criteria under uncertainty"),
      recommended: tr("აკმაყოფილებს ყველა სამიზნე მეცნიერულ კრიტერიუმს", "satisfies all specified target criteria with high statistical confidence"),
    };
  }, [study]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Top Screening Action Bar */}
      <div
        className="study-card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "12px 18px",
          marginBottom: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--ll-radius-md)",
              background: "var(--ll-emerald-soft)",
              color: "var(--ll-emerald)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Sparkles size={16} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 650, color: "var(--ll-text-primary)" }}>
              {tr("სკრინინგის ძრავა (Sequential Screening Engine)", "Sequential Screening Engine")}
            </h4>
            <div style={{ fontSize: 11, color: "var(--ll-text-secondary)", marginTop: 1 }}>
              {latestRun ? (
                <>
                  <span>
                    {tr("ბოლო სკრინინგი:", "Last screened:")} {new Date(latestRun.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {" • "}
                  <span>{savedTestsPct}% {tr("ლაბორატორია დაზოგილია", "bench tests saved")}</span>
                </>
              ) : (
                tr("გაუშვით სკრინინგი უსარგებლო ექსპერიმენტების მათემატიკურად გამოსარიცხად.", "Run sequential screening to eliminate futile parameter regimes.")
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Clopper-Pearson MC Draws Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ll-text-secondary)" }}>
            <span style={{ fontWeight: 500 }}>Monte Carlo Draws:</span>
            <select
              className="form-select"
              style={{ height: 28, padding: "0 8px", fontSize: 11.5, width: 85 }}
              value={mcDraws}
              onChange={(e) => setMcDraws(parseInt(e.target.value, 10))}
              disabled={runningJob}
              title="Monte Carlo draws per candidate. Minimum 60 draws required for 95% Clopper-Pearson exclusion bound."
            >
              <option value="20">20 draws</option>
              <option value="60">60 draws (95% CI)</option>
              <option value="100">100 draws</option>
              <option value="200">200 draws</option>
            </select>
          </div>

          <button
            className="btn-primary"
            onClick={handleRunScreening}
            disabled={runningJob || !activeSet || activeSet.count === 0}
            style={{ padding: "6px 14px" }}
          >
            {runningJob ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}
            <span>{runningJob ? tr("მიმდინარეობს სკრინინგი...", "Screening...") : tr("სკრინინგის გაშვება", "Run Screening")}</span>
          </button>
        </div>
      </div>

      {/* Live Job Progress Banner */}
      {runningJob && job && (
        <div
          style={{
            padding: "10px 16px",
            background: "var(--ll-emerald-soft)",
            border: "1px solid var(--ll-emerald-border)",
            borderRadius: "var(--ll-radius-lg)",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, color: "var(--ll-emerald-text)", marginBottom: 6 }}>
            <span>{job.message || tr("მუშავდება კანდიდატები...", "Evaluating candidate batch...")}</span>
            <span>{Math.round(job.progress * 100)}%</span>
          </div>
          <div style={{ width: "100%", height: 6, background: "#d1fae5", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.round(job.progress * 100)}%`,
                height: "100%",
                background: "var(--ll-emerald)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Monolithic Full-Width KPI Ribbon */}
      <div className="kpi-ribbon">
        <div className="kpi-block">
          <div className="kpi-label">
            <Layers size={13} color="var(--ll-text-muted)" />
            <span>{tr("საწყისი სივრცე", "Initial Space")}</span>
          </div>
          <div className="kpi-val">{total.toLocaleString()}</div>
          <div className="kpi-sub">{tr("გამოკვლეული ვარიაციები", "Multidimensional DoE pool")}</div>
        </div>

        <div className="kpi-block">
          <div className="kpi-label">
            <Scale size={13} color="var(--ll-rose)" />
            <span>{tr("უარყოფილი სივრცე", "Ruled Out Space")}</span>
          </div>
          <div className="kpi-val" style={{ color: "var(--ll-rose)" }}>
            {excludedPct}%
          </div>
          <div className="kpi-sub">
            {excluded.toLocaleString()} {tr("არასიცოცხლისუნარიანი", "unfeasible eliminated")}
          </div>
        </div>

        <div className="kpi-block">
          <div className="kpi-label">
            <ShieldCheck size={13} color="var(--ll-blue)" />
            <span>{tr("შემოწმებადი აუზი", "Viable Pool")}</span>
          </div>
          <div className="kpi-val" style={{ color: "var(--ll-blue)" }}>
            {afterConstraints.toLocaleString()}
          </div>
          <div className="kpi-sub">
            {deprioritised > 0 ? `${deprioritised} ${tr("დეპრიორიტიზებული", "deprioritised")}` : tr("გამვლელი კანდიდატები", "passing candidates")}
          </div>
        </div>

        <div className="kpi-block">
          <div className="kpi-label">
            <Target size={13} color="var(--ll-emerald)" />
            <span>{tr("რეკომენდებული სერია", "Recommended Batch")}</span>
          </div>
          <div className="kpi-val" style={{ color: "var(--ll-emerald)" }}>
            {recommended > 0 ? recommended.toLocaleString() : afterDeprioritised.toLocaleString()}
          </div>
          <div className="kpi-sub">
            {recommended > 0 ? `${savedTestsPct}% ${tr("ლაბორატორია დაზოგილია", "lab tests saved")}` : tr("მზადაა ტესტირებისთვის", "ready for field testing")}
          </div>
        </div>
      </div>

      {/* Scientific Executive Verdict Banner */}
      {latestRun && total > 0 && (
        <div className="verdict-banner">
          <div className="verdict-header">
            <div className="verdict-badge-row">
              {recommended > 0 ? (
                <span className="verdict-pill pill-success">
                  <Target size={13} />
                  {tr(
                    `${recommended} შერჩეული კანდიდატი (${savedTestsPct}% რესურსის ეკონომია)`,
                    `${recommended} Field Candidates Recommended (${savedTestsPct}% Lab Work Saved)`,
                  )}
                </span>
              ) : (
                <span className="verdict-pill pill-viable">
                  <ShieldCheck size={13} />
                  {tr(
                    `${afterConstraints} შემოწმებადი კანდიდატი (${excludedPct}% ეკონომია)`,
                    `${afterConstraints} Candidates Viable (${excludedPct}% Unfeasible Ruled Out)`,
                  )}
                </span>
              )}
            </div>
            <span className="verdict-timestamp">
              {tr("სკრინინგის დრო:", "Screened:")} {new Date(latestRun.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
                  `ფიზიკური შეზღუდვებისა (${domainNarrative.constraints}) და სიმულაციური მოდელის ანალიზის შედეგად, საწყისი ${total.toLocaleString()} ვარიაციიდან ${excluded.toLocaleString()} (${excludedPct}%) უარყოფილია, ხოლო ${deprioritised.toLocaleString()} დეპრიორიტიზებულია. ${recommended.toLocaleString()} მაღალ-სანდო კანდიდატი (${recommendedPct}%) ${domainNarrative.recommended} და რეკომენდებულია საველე ექსპერიმენტებისთვის — რაც ლაბორატორიულ დანახარჯებს ${savedTestsPct}%-ით ამცირებს.`,
                  `Through physical constraints (${domainNarrative.constraints}) and simulation under uncertainty, Lattice Lab evaluated ${total.toLocaleString()} candidate variations. ${excluded.toLocaleString()} (${excludedPct}%) were eliminated as unfeasible and ${deprioritised.toLocaleString()} were deprioritised. ${recommended.toLocaleString()} high-confidence candidates (${recommendedPct}%) ${domainNarrative.recommended}, narrowing field acquisition by ${savedTestsPct}%.`,
                )
              ) : (
                tr(
                  `საწყისი ${total.toLocaleString()} ვარიაციიდან ${excluded.toLocaleString()} (${excludedPct}%) ცალსახად უარყოფილია ფიზიკური შეზღუდვებით (${domainNarrative.constraints}). დარჩენილი ${afterConstraints.toLocaleString()} კანდიდატი წარმოადგენს შემოწმებად აუზს.`,
                  `Out of ${total.toLocaleString()} initial variations, ${excluded.toLocaleString()} (${excludedPct}%) were definitively eliminated by physical constraints (${domainNarrative.constraints}). The surviving ${afterConstraints.toLocaleString()} candidates form your viable pool ready for detailed evaluation.`,
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
                <ListFilter size={13} />
                <span>
                  {recommended > 0
                    ? tr(`რეკომენდებული ${recommended} კანდიდატი`, `View ${recommended} Recommended`)
                    : tr(`შემოწმებადი ${afterConstraints} კანდიდატი`, `View ${afterConstraints} Viable`)}
                </span>
                <ArrowRight size={13} />
              </button>

              <button className="btn-secondary" onClick={() => setShowRecordModal(true)}>
                <FlaskConical size={13} />
                <span>{tr("რეალური ცდის აღრიცხვა", "Record Lab Run")}</span>
              </button>

              {isMicroscopeStudy && (
                <button
                  className="btn-secondary"
                  onClick={() => navigate(`studies/${study.id}/micrograph`)}
                  style={{ color: "var(--ll-emerald)" }}
                >
                  <Microscope size={13} />
                  <span>{tr("მიკროსკოპის ხედი", "Micrograph View")}</span>
                </button>
              )}

              <button className="btn-secondary" onClick={() => navigate(`studies/${study.id}/flow`)}>
                <Workflow size={13} />
                <span>{tr("3D ფლოუში დათვალიერება", "Inspect 3D Flow")}</span>
              </button>

              <button className="btn-secondary" onClick={() => navigate(`studies/${study.id}/evidence`)}>
                <FileSpreadsheet size={13} />
                <span>{tr("სამუშაო ფურცელი (Run Sheet)", "Lab Run Sheet")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Two-Column Scientific Dashboard */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        {/* Left Column: Elimination Funnel & Candidate Pool */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Candidate Pool Composition Bar */}
          {total > 0 && (
            <div className="study-card" style={{ marginBottom: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 650, color: "var(--ll-text-primary)" }}>
                  {tr("კანდიდატთა აუზის შემადგენლობა (Composition)", "Candidate Pool Composition")}
                </h4>
                <span style={{ fontSize: 11, color: "var(--ll-text-muted)" }}>
                  {tr("დააწკაპუნეთ გასაფილტრად", "Click segment to filter")}
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
                  <span>{tr("შემოწმებადი:", "Open:")} <strong>{openCount}</strong> ({openPct}%)</span>
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
          <div className="study-card" style={{ marginBottom: 0 }}>
            <div className="study-card-header">
              <h4 className="study-card-title">{tr("გამორიცხვის ძაბრი (Screening Funnel)", "Screening Funnel")}</h4>
              {latestRun && (
                <span style={{ fontSize: 11, color: "var(--ll-text-muted)" }}>
                  {tr("ბოლო გაშვება:", "Last Run:")} {new Date(latestRun.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>

            {total === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--ll-text-muted)" }}>
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
                    {tr("სრული მრავალგანზომილებიანი სივრცე DoE ბადის მიხედვით.", "Full multidimensional candidate space across experimental variables.")}
                  </div>
                </div>

                {/* Step 2: Feasibility Gate */}
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
                      `${excluded.toLocaleString()} ვარიაცია გამორიცხულია ${domainNarrative.constraints}.`,
                      `${excluded.toLocaleString()} unfeasible variations eliminated by ${domainNarrative.constraints}.`,
                    )}
                  </div>
                </div>

                {/* Step 3: Simulation Gate */}
                <div className="funnel-step">
                  <div className="funnel-step-label">
                    <span className="funnel-step-name">3. {tr("სიმულაციური სკრინინგის შემდეგ (Simulation Gate)", "Simulation Gate")}</span>
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
                          `${deprioritised.toLocaleString()} კანდიდატი დეპრიორიტიზებულია ${domainNarrative.deprioritised}.`,
                          `${deprioritised.toLocaleString()} candidates deprioritised due to ${domainNarrative.deprioritised}.`,
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
                  <div className="funnel-sublabel" style={{ color: recommended > 0 ? "var(--ll-emerald-text)" : "var(--ll-text-secondary)", fontWeight: recommended > 0 ? 600 : 400 }}>
                    {recommended > 0
                      ? tr(
                          `${recommended} კანდიდატი ${domainNarrative.recommended} მაღალი სტატისტიკური სანდოობით.`,
                          `${recommended} candidates achieve target outcome criteria with high statistical confidence.`,
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
        </div>

        {/* Right Column: Key Metrics, Bench Evidence & Micrograph Card */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Physical Ground Truth & Calibration Instrument Card */}
          <div
            className="study-card"
            style={{
              background: "var(--ll-surface)",
              border: "1px solid var(--ll-border)",
              marginBottom: 0,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "var(--ll-radius-md)",
                    background: "var(--ll-emerald-soft)",
                    color: "var(--ll-emerald)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <FlaskConical size={16} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 650, color: "var(--ll-text-primary)" }}>
                    {tr("ემპირიული ჭეშმარიტება & კალიბრაცია", "Physical Ground Truth & Calibration")}
                  </h4>
                  <div style={{ fontSize: 11, color: "var(--ll-text-muted)", marginTop: 1 }}>
                    {validEvidence.length} {tr("ვალიდური ლაბორატორიული გაზომვა", "valid bench measurements logged")}
                  </div>
                </div>
              </div>
            </div>

            <p style={{ margin: "0 0 14px 0", fontSize: 12, color: "var(--ll-text-secondary)", lineHeight: 1.45 }}>
              {validEvidence.length >= 3
                ? tr(
                    "დაგროვილია საკმარისი ემპირიული მონაცემები მოდელის ფიზიკური კალიბრაციისთვის. მოარგეთ სიმულაციის პარამეტრები რეალურ შედეგებს (Zero-Guesswork).",
                    "Sufficient physical measurements logged for model parameter calibration. Tune simulation parameters to match empirical reality.",
                  )
                : tr(
                    "შეიტანეთ რეალური ლაბორატორიული გაზომვები, რათა მოდელმა შეძლოს თვით-კალიბრაცია (საჭიროა მინიმუმ 3 ვალიდური ჩანაწერი).",
                    "Log physical bench measurements to anchor screening in ground truth (minimum 3 records required for auto-calibration).",
                  )}
            </p>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn-primary"
                onClick={() => setShowRecordModal(true)}
              >
                <FlaskConical size={13} />
                <span>{tr("რეალური ცდის შეტანა", "Record Bench Run")}</span>
              </button>

              {validEvidence.length >= 3 && (
                <button
                  className="btn-secondary"
                  onClick={() => setShowCalibrationModal(true)}
                  style={{ color: "var(--ll-blue)" }}
                >
                  <Sparkles size={13} />
                  <span>{tr("მოდელის კალიბრაცია", "Calibrate Model")}</span>
                </button>
              )}

              <button
                className="btn-ghost"
                onClick={() => navigate(`studies/${study.id}/evidence`)}
              >
                <span>{tr("ყველა მტკიცებულება", "View All Evidence")}</span>
                <ChevronRight size={12} />
              </button>
            </div>
          </div>

          {/* Dedicated Micrograph Hero Card for Microscope Studies */}
          {isMicroscopeStudy && (
            <div
              className="study-card"
              style={{
                background: "var(--ll-surface)",
                border: "1px solid var(--ll-border)",
                marginBottom: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "var(--ll-radius-md)",
                    background: "var(--ll-blue-soft)",
                    color: "var(--ll-blue)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Microscope size={16} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 650, color: "var(--ll-text-primary)" }}>
                    {tr("გამავალი მიკროსკოპის ხედი", "Digital Transmissive Micrograph")}
                  </h4>
                  <div style={{ fontSize: 11, color: "var(--ll-text-muted)" }}>Live 2D Wave Optics & PSF Blur</div>
                </div>
              </div>

              <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "var(--ll-text-secondary)", lineHeight: 1.4 }}>
                {tr(
                  "აბეს დიფრაქციული გაბუნდოვნება (PSF), ლამბერტ-ბერის შთანთქმა და დენსიტომეტრიული ანალიზი.",
                  "Abbe diffraction PSF blur, Beer–Lambert transmission, and optical densitometry.",
                )}
              </p>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-primary"
                  onClick={() => navigate(`studies/${study.id}/micrograph`)}
                  style={{ background: "var(--ll-blue)", borderColor: "var(--ll-blue)" }}
                >
                  <Microscope size={13} />
                  <span>{tr("მიკროსკოპის გახსნა", "Open Micrograph")}</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filter Verdict Breakdown */}
      {latestRun && summary && (
        <div className="study-card">
          <h4 className="study-card-title" style={{ marginBottom: 12 }}>
            <Scale size={14} color="var(--ll-emerald)" />
            <span>{tr("გამორიცხვის დეტალები (Screening Filter Breakdown)", "Screening Filter Breakdown")}</span>
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {Object.entries(summary.counts_by_filter).map(([filterName, count]) => (
              <div
                key={filterName}
                style={{
                  padding: "9px 12px",
                  background: "var(--ll-surface-subtle)",
                  border: "1px solid var(--ll-border)",
                  borderRadius: "var(--ll-radius-md)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--ll-text-secondary)" }}>
                  {filterName === "constraint"
                    ? tr("ფიზიკური შეზღუდვები", "Physical Feasibility Limit")
                    : filterName === "model"
                    ? tr("3D სიმულაციური მოდელი", "3D Simulation Model")
                    : filterName === "override"
                    ? tr("ხელით მინიჭებული", "Manual Override")
                    : filterName === "constraint_error"
                    ? tr("გამოთვლის შეცდომა", "Calculation Error Flag")
                    : tr("შეზღუდვების გამვლელი", "Passed Constraints (Open)")}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--ll-font-mono)", color: "var(--ll-text-primary)" }}>
                  {count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Record Physical Experiment Modal */}
      {showRecordModal && (
        <RecordExperimentModal
          isOpen={showRecordModal}
          onClose={() => setShowRecordModal(false)}
          study={study}
          parameters={parameters || []}
          outcomes={outcomes || []}
          existingEvidenceCount={validEvidence.length}
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
