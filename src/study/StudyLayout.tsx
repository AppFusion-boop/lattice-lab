import { useState } from "react";
import { ChevronRight, ArrowLeft, Download, FlaskConical } from "lucide-react";
import { apiGet } from "./api/client";
import { useApi } from "./api/hooks";
import type { Study, Parameter, Outcome, Evidence } from "./api/types";
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
import { RecordExperimentModal } from "./components/RecordExperimentModal";
import { CalibrationWizard } from "./components/CalibrationWizard";
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

  const [showRecordModal, setShowRecordModal] = useState<boolean>(false);
  const [showCalibrationModal, setShowCalibrationModal] = useState<boolean>(false);

  if (loading) {
    return (
      <div className="study-container" style={{ alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#84938b" }}>{tr("კვლევა იტვირთება...", "Loading study...")}</p>
      </div>
    );
  }

  if (error || !study) {
    return (
      <div className="study-container" style={{ padding: 32 }}>
        <ServerStatusBanner />
        <div className="study-card" style={{ maxWidth: 500, margin: "40px auto", textAlign: "center" }}>
          <h3 style={{ margin: "0 0 10px 0", color: "#991b1b" }}>
            {tr("კვლევა ვერ მოიძებნა", "Study not found")}
          </h3>
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px 0" }}>
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

  return (
    <div className="study-container">
      <ServerStatusBanner />

      {/* Header */}
      <header className="study-header">
        <div className="study-title-group">
          <div className="study-breadcrumb" onClick={() => navigate("studies")}>
            <span>{tr("კვლევები", "Studies")}</span>
            <ChevronRight size={13} />
          </div>
          <h2 className="study-title">{study.name}</h2>
          <span className={`badge badge-${study.domain}`}>{study.domain}</span>
          {study.archived && (
            <span className="badge badge-status-deprioritised">{tr("დაარქივებული", "Archived")}</span>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="btn-primary"
            onClick={() => setShowRecordModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "#059669",
              borderColor: "#059669",
            }}
            title={tr("რეალური ექსპერიმენტის აღრიცხვა (Ground Truth)", "Record real experiment bench measurement")}
          >
            <FlaskConical size={14} />
            <span>{tr("რეალური ცდის შეტანა", "Record Lab Run")}</span>
          </button>
          <button
            className="btn-secondary"
            onClick={handleExportLat}
            title={tr("სრული კვლევის ექსპორტი (.lat არქივი 3D სცენებით, DoE-თა და ემპირიით)", "Export full study package (.lat archive with 3D scenes, DoE, and evidence)")}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Download size={14} />
            <span>{tr("ექსპორტი (.lat)", "Export (.lat)")}</span>
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="study-nav-tabs">
        <button
          className={`study-tab-btn ${currentTab === "overview" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/overview`)}
        >
          {tr("მიმოხილვა (Overview)", "Overview")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "parameters" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/parameters`)}
        >
          {tr("პარამეტრები (Parameters)", "Parameters")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "flow" || currentTab === "models" || currentTab === "model" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/flow`)}
        >
          {tr("3D ფლოუ & სიმულაცია", "3D Flow & Simulation")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "outcomes" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/outcomes`)}
        >
          {tr("შედეგები (Outcomes)", "Outcomes")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "constraints" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/constraints`)}
        >
          {tr("შეზღუდვები (Constraints)", "Constraints")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "candidates" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/candidates`)}
        >
          {tr("კანდიდატები (Candidates)", "Candidates")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "evidence" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/evidence`)}
        >
          {tr("მტკიცებულებები (Evidence)", "Evidence")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "analysis" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/analysis`)}
        >
          {tr("ანალიზი (Analysis)", "Analysis")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "plan" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/plan`)}
        >
          {tr("გეგმა (Plan)", "Plan")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "report" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/report`)}
        >
          {tr("ანგარიში (Report)", "Report")}
        </button>
        <button
          className={`study-tab-btn ${currentTab === "audit" ? "active" : ""}`}
          onClick={() => navigate(`studies/${id}/audit`)}
        >
          {tr("აუდიტი (Audit)", "Audit")}
        </button>
      </nav>

      {/* Tab Content */}
      <main
        className={`study-content ${
          currentTab === "flow" || currentTab === "models" || currentTab === "model"
            ? "study-content-flow"
            : ""
        }`}
      >
        {currentTab === "overview" && <OverviewTab study={study} onRefreshStudy={refresh} />}
        {currentTab === "parameters" && <ParametersTab study={study} />}
        {(currentTab === "flow" || currentTab === "models" || currentTab === "model") && (
          <ModelTab study={study} />
        )}
        {currentTab === "outcomes" && <OutcomesTab study={study} />}
        {currentTab === "constraints" && <ConstraintsTab study={study} />}
        {currentTab === "candidates" && <CandidatesTab study={study} onCandidatesChanged={refresh} />}
        {currentTab === "evidence" && <EvidenceTab study={study} />}
        {currentTab === "analysis" && <AnalysisTab study={study} />}
        {currentTab === "plan" && <PlanTab study={study} />}
        {currentTab === "report" && <ReportTab study={study} />}
        {currentTab === "audit" && <AuditTab study={study} />}
      </main>

      {/* Global Record Real Experiment Modal */}
      {showRecordModal && (
        <RecordExperimentModal
          isOpen={showRecordModal}
          onClose={() => setShowRecordModal(false)}
          study={study}
          parameters={parameters || []}
          outcomes={outcomes || []}
          existingEvidenceCount={evidenceList?.length || 0}
          onEvidenceRecorded={() => {
            refresh();
            refreshEvidence();
          }}
          onOpenCalibration={() => setShowCalibrationModal(true)}
        />
      )}

      {/* Global Calibration Wizard Modal */}
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
            refreshEvidence();
          }}
        />
      )}
    </div>
  );
}
