import { useState } from "react";
import {
  ChevronRight,
  ArrowLeft,
  Download,
  FlaskConical,
  BookOpen,
  LayoutDashboard,
  Sliders,
  Target,
  ShieldAlert,
  Workflow,
  Microscope,
  Database,
  LineChart,
  Compass,
  FileText,
  History,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { apiGet } from "./api/client";
import { useApi } from "./api/hooks";
import type { Study, Parameter, Outcome, Evidence, ModelVersion, CandidateSet } from "./api/types";
import { navigate } from "../app/router";
import { tr } from "../i18n";
import { ServerStatusBanner } from "./components/ServerStatusBanner";
import { OverviewTab } from "./tabs/OverviewTab";
import { ParametersTab } from "./tabs/ParametersTab";
import { OutcomesTab } from "./tabs/OutcomesTab";
import { ConstraintsTab } from "./tabs/ConstraintsTab";
import { CandidatesTab } from "./tabs/CandidatesTab";
import { ModelTab } from "./tabs/ModelTab";
import { EvidenceTab } from "./tabs/EvidenceTab";
import { AnalysisTab } from "./tabs/AnalysisTab";
import { PlanTab } from "./tabs/PlanTab";
import { ReportTab } from "./tabs/ReportTab";
import { AuditTab } from "./tabs/AuditTab";
import { MicrographTab } from "./tabs/MicrographTab";
import { RecordExperimentModal } from "./components/RecordExperimentModal";
import { CalibrationWizard } from "./components/CalibrationWizard";
import { PaperExportModal } from "./components/PaperExportModal";
import "./study.css";

interface StudyLayoutProps {
  id: string;
  tab: string;
}

export function StudyLayout({ id, tab }: StudyLayoutProps) {
  const currentTab = tab || "overview";

  const {
    data: study,
    loading,
    error,
    refresh,
  } = useApi<Study>(`study-${id}`, () => apiGet<Study>(`/studies/${id}`));

  const { data: parameters } = useApi<Parameter[]>(`params-${id}`, () =>
    apiGet<Parameter[]>(`/studies/${id}/parameters`).catch(() => [])
  );
  const { data: outcomes } = useApi<Outcome[]>(`outcomes-${id}`, () =>
    apiGet<Outcome[]>(`/studies/${id}/outcomes`).catch(() => [])
  );
  const { data: evidenceList, refresh: refreshEvidence } = useApi<Evidence[]>(
    `evidence-${id}`,
    () => apiGet<Evidence[]>(`/studies/${id}/evidence`).catch(() => [])
  );
  const { data: models } = useApi<ModelVersion[]>(
    `models-top-${id}`,
    () => apiGet<ModelVersion[]>(`/studies/${id}/models`).catch(() => [])
  );
  const { data: activeSet } = useApi<CandidateSet>(
    `active-set-top-${id}`,
    () => apiGet<CandidateSet>(`/studies/${id}/candidate-sets/active`).catch(() => null as unknown as CandidateSet)
  );

  const [showRecordModal, setShowRecordModal] = useState<boolean>(false);
  const [showCalibrationModal, setShowCalibrationModal] = useState<boolean>(false);
  const [showPaperModal, setShowPaperModal] = useState<boolean>(false);

  if (loading) {
    return (
      <div className="study-container" style={{ alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--ll-text-muted)" }}>{tr("კვლევა იტვირთება...", "Loading study...")}</p>
      </div>
    );
  }

  if (error || !study) {
    return (
      <div className="study-container" style={{ padding: 32 }}>
        <ServerStatusBanner />
        <div className="study-card" style={{ maxWidth: 480, margin: "60px auto", textAlign: "center", padding: 32 }}>
          <h3 style={{ margin: "0 0 10px 0", color: "var(--ll-rose)", fontSize: 16 }}>
            {tr("კვლევა ვერ მოიძებნა", "Study not found")}
          </h3>
          <p style={{ color: "var(--ll-text-secondary)", fontSize: 13, margin: "0 0 20px 0", lineHeight: 1.5 }}>
            {error?.message || tr("მითითებული იდენტიფიკატორით კვლევა არ არსებობს.", "The requested study could not be loaded.")}
          </p>
          <button className="btn-secondary" onClick={() => navigate("studies")}>
            <ArrowLeft size={14} />
            <span>{tr("კვლევების სიაში დაბრუნება", "Return to Studies")}</span>
          </button>
        </div>
      </div>
    );
  }

  const handleExportLat = () => {
    if (!study) return;
    const slug = (study.name || "study").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[-\s]+/g, "_");
    const link = document.createElement("a");
    link.href = `/api/v1/studies/${study.id}/export.lat`;
    link.setAttribute("download", `${slug || "study"}.lat`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const isMicroscopeStudy =
    study.domain === "optical_microscopy" ||
    study.name.toLowerCase().includes("microscop") ||
    study.name.toLowerCase().includes("emulsion") ||
    study.name.toLowerCase().includes("microcapsule") ||
    (study.description && study.description.toLowerCase().includes("microscop"));

  const latestModel = models && models.length > 0 ? models[0] : null;

  return (
    <div className="study-workbench">
      {/* Left Scientific Navigation Sidebar */}
      <aside className="study-sidebar">
        {/* Study Identity Header */}
        <div className="study-sidebar-header">
          <button
            className="study-sidebar-back"
            onClick={() => navigate("studies")}
            title={tr("კვლევების კატალოგში დაბრუნება", "Back to Studies Catalog")}
          >
            <ArrowLeft size={13} />
            <span>{tr("კატალოგში დაბრუნება", "Studies Catalog")}</span>
          </button>

          <div className="study-sidebar-identity">
            <h2 className="study-sidebar-title" title={study.name}>{study.name}</h2>
            <div className="study-sidebar-meta">
              <span className={`badge badge-${study.domain}`}>{study.domain}</span>
              {latestModel && (
                <span
                  className="badge"
                  style={{
                    background: latestModel.validation_status === "validated" ? "var(--ll-emerald-soft)" : "var(--ll-surface-hover)",
                    color: latestModel.validation_status === "validated" ? "var(--ll-emerald-text)" : "var(--ll-text-secondary)",
                    borderColor: latestModel.validation_status === "validated" ? "var(--ll-emerald-border)" : "var(--ll-border)",
                    fontSize: 10,
                  }}
                  title={latestModel.notes || `Model Version ${latestModel.version}`}
                >
                  <ShieldCheck size={11} />
                  <span>v{latestModel.version} {latestModel.validation_status === "validated" ? tr("ვალიდური", "Valid") : tr("საწყისი", "Draft")}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Grouped Workflow Navigation */}
        <nav className="study-sidebar-nav" aria-label="Study Workbench Navigation">
          {/* Group 1: Dashboard */}
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-heading">{tr("დაფა", "Dashboard")}</div>
            <button
              className={`sidebar-nav-item ${currentTab === "overview" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/overview`)}
              title={tr("სკრინინგის რეზიუმე და გამორიცხვის ძაბრი", "Screening summary and space elimination funnel")}
            >
              <div className="sidebar-nav-item-left">
                <LayoutDashboard size={14} />
                <span>{tr("მიმოხილვა", "Overview")}</span>
              </div>
            </button>
          </div>

          {/* Group 2: Physics & Model */}
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-heading">{tr("ფიზიკა & მოდელი", "Physics & Model")}</div>
            
            <button
              className={`sidebar-nav-item ${currentTab === "parameters" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/parameters`)}
              title={tr("კონტროლირებადი და გაურკვეველი პარამეტრები", "Controlled and uncertain experimental parameters")}
            >
              <div className="sidebar-nav-item-left">
                <Sliders size={14} />
                <span>{tr("პარამეტრები", "Parameters")}</span>
              </div>
              {parameters && parameters.length > 0 && (
                <span className="sidebar-nav-item-badge">{parameters.length}</span>
              )}
            </button>

            <button
              className={`sidebar-nav-item ${currentTab === "outcomes" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/outcomes`)}
              title={tr("გაზომვადი შედეგები და კრიტერიუმები", "Measured outcomes and target criteria")}
            >
              <div className="sidebar-nav-item-left">
                <Target size={14} />
                <span>{tr("შედეგები", "Outcomes")}</span>
              </div>
              {outcomes && outcomes.length > 0 && (
                <span className="sidebar-nav-item-badge">{outcomes.length}</span>
              )}
            </button>

            <button
              className={`sidebar-nav-item ${currentTab === "constraints" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/constraints`)}
              title={tr("ფიზიკური და უსაფრთხოების შეზღუდვები", "Physical, feasibility and safety constraints")}
            >
              <div className="sidebar-nav-item-left">
                <ShieldAlert size={14} />
                <span>{tr("შეზღუდვები", "Constraints")}</span>
              </div>
            </button>

            <button
              className={`sidebar-nav-item ${currentTab === "flow" || currentTab === "models" || currentTab === "model" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/flow`)}
              title={tr("3D ფლოუ გრაფი და სიმულატორი", "3D Flow Graph and Physics Simulator")}
            >
              <div className="sidebar-nav-item-left">
                <Workflow size={14} />
                <span>{tr("3D ფლოუ & სიმულაცია", "3D Flow & Sim")}</span>
              </div>
            </button>

            {isMicroscopeStudy && (
              <button
                className={`sidebar-nav-item ${currentTab === "micrograph" || currentTab === "microscope" ? "active" : ""}`}
                onClick={() => navigate(`studies/${id}/micrograph`)}
                title={tr("გამავალი მიკროსკოპის 2D ტალღური ოპტიკა", "Digital Transmissive Wave Optics Micrograph")}
              >
                <div className="sidebar-nav-item-left">
                  <Microscope size={14} color="var(--ll-emerald)" />
                  <span>{tr("მიკროსკოპი", "Micrograph View")}</span>
                </div>
              </button>
            )}
          </div>

          {/* Group 3: Space & Evidence */}
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-heading">{tr("სივრცე & მონაცემები", "Space & Evidence")}</div>
            
            <button
              className={`sidebar-nav-item ${currentTab === "candidates" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/candidates`)}
              title={tr("DoE კანდიდატთა მატრიცა და პარეტოს ფრონტირი", "DoE candidate space matrix and Pareto trade-offs")}
            >
              <div className="sidebar-nav-item-left">
                <Database size={14} />
                <span>{tr("კანდიდატები (DoE)", "Candidate Matrix")}</span>
              </div>
              {activeSet?.count ? (
                <span className="sidebar-nav-item-badge">{activeSet.count.toLocaleString()}</span>
              ) : null}
            </button>

            <button
              className={`sidebar-nav-item ${currentTab === "evidence" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/evidence`)}
              title={tr("ლაბორატორიული ემპირიული გაზომვები", "Physical bench and field measurement records")}
            >
              <div className="sidebar-nav-item-left">
                <FlaskConical size={14} />
                <span>{tr("მტკიცებულებები", "Evidence Store")}</span>
              </div>
              {evidenceList && evidenceList.length > 0 && (
                <span className="sidebar-nav-item-badge">{evidenceList.length}</span>
              )}
            </button>

            <button
              className={`sidebar-nav-item ${currentTab === "analysis" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/analysis`)}
              title={tr("ფაზური დიაგრამები, მგრძნობელობა (სობოლი), ბუკინგემის Π ჯგუფები", "2D Phase diagrams, Sobol sensitivity, and Buckingham Pi")}
            >
              <div className="sidebar-nav-item-left">
                <LineChart size={14} />
                <span>{tr("ანალიზი & გარანტიები", "Scientific Analysis")}</span>
              </div>
            </button>
          </div>

          {/* Group 4: Execution & Audit */}
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-heading">{tr("გეგმა & ანგარიში", "Execution & Output")}</div>
            
            <button
              className={`sidebar-nav-item ${currentTab === "plan" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/plan`)}
              title={tr("აქტიური სწავლება და შემდეგი პარტიის შერჩევა", "Active learning and optimal next-batch prioritization")}
            >
              <div className="sidebar-nav-item-left">
                <Compass size={14} />
                <span>{tr("შემდეგი პარტია (Plan)", "Next-Batch Plan")}</span>
              </div>
            </button>

            <button
              className={`sidebar-nav-item ${currentTab === "report" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/report`)}
              title={tr("სამეცნიერო ანგარიში და აუდიტირებადი სინთეზი", "Scientific report and defensible synthesis")}
            >
              <div className="sidebar-nav-item-left">
                <FileText size={14} />
                <span>{tr("მეცნიერული ანგარიში", "Scientific Report")}</span>
              </div>
            </button>

            <button
              className={`sidebar-nav-item ${currentTab === "audit" ? "active" : ""}`}
              onClick={() => navigate(`studies/${id}/audit`)}
              title={tr("კრიპტოგრაფიული აუდიტის ჟურნალი და სარეზერვო ასლები", "Cryptographic audit trail and backups")}
            >
              <div className="sidebar-nav-item-left">
                <History size={14} />
                <span>{tr("აუდიტი & არქივი", "Audit & Backups")}</span>
              </div>
            </button>
          </div>
        </nav>

        {/* Sidebar Footer Quick Actions */}
        <div className="study-sidebar-footer">
          <button
            className="btn-primary"
            onClick={() => setShowRecordModal(true)}
            style={{ width: "100%", justifyContent: "center" }}
            title={tr("რეალური ექსპერიმენტის აღრიცხვა (Ground Truth)", "Record real experiment bench measurement")}
          >
            <FlaskConical size={13} />
            <span>{tr("რეალური ცდის შეტანა", "Record Lab Run")}</span>
          </button>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <button
              className="btn-secondary"
              onClick={handleExportLat}
              style={{ fontSize: 11, padding: "5px 6px" }}
              title={tr("კვლევის პაკეტის ექსპორტი (.lat)", "Export package (.lat)")}
            >
              <Download size={12} />
              <span>{tr("ექსპორტი", ".lat")}</span>
            </button>
            <button
              className="btn-secondary"
              onClick={() => setShowPaperModal(true)}
              style={{ fontSize: 11, padding: "5px 6px", color: "var(--ll-blue)" }}
              title={tr("სამეცნიერო სტატია", "Research Paper")}
            >
              <BookOpen size={12} />
              <span>{tr("სტატია", "Paper")}</span>
            </button>
          </div>

          <div style={{ fontSize: 10, color: "var(--ll-text-muted)", textAlign: "center", fontFamily: "var(--ll-font-mono)", marginTop: 2 }}>
            RNG Seed: {study.rng_seed ?? 42} · 95% CL
          </div>
        </div>
      </aside>

      {/* Main Viewport Workspace */}
      <main
        className={`study-main-viewport ${
          currentTab === "flow" || currentTab === "models" || currentTab === "model"
            ? "viewport-flow"
            : ""
        }`}
      >
        <ServerStatusBanner />

        {currentTab === "flow" || currentTab === "models" || currentTab === "model" ? (
          <ModelTab study={study} />
        ) : (
          <div className="study-viewport-content">
            {currentTab === "overview" && (
              <OverviewTab study={study} onRefreshStudy={refresh} />
            )}
            {currentTab === "parameters" && <ParametersTab study={study} />}
            {currentTab === "outcomes" && <OutcomesTab study={study} />}
            {currentTab === "constraints" && <ConstraintsTab study={study} />}
            {currentTab === "candidates" && <CandidatesTab study={study} />}
            {currentTab === "micrograph" && <MicrographTab study={study} />}
            {currentTab === "evidence" && <EvidenceTab study={study} />}
            {currentTab === "analysis" && <AnalysisTab study={study} />}
            {currentTab === "plan" && <PlanTab study={study} />}
            {currentTab === "report" && <ReportTab study={study} />}
            {currentTab === "audit" && <AuditTab study={study} />}
          </div>
        )}
      </main>

      {/* Global Modals */}
      {showRecordModal && (
        <RecordExperimentModal
          isOpen={showRecordModal}
          onClose={() => setShowRecordModal(false)}
          study={study}
          parameters={parameters || []}
          outcomes={outcomes || []}
          onEvidenceRecorded={() => {
            refreshEvidence();
            refresh();
          }}
        />
      )}

      {showCalibrationModal && (
        <CalibrationWizard
          isOpen={showCalibrationModal}
          onClose={() => setShowCalibrationModal(false)}
          study={study}
          parameters={parameters || []}
          outcomes={outcomes || []}
          evidence={evidenceList || []}
          onModelUpgraded={() => {
            refresh();
          }}
        />
      )}

      {showPaperModal && (
        <PaperExportModal
          isOpen={showPaperModal}
          onClose={() => setShowPaperModal(false)}
          study={study}
        />
      )}
    </div>
  );
}
