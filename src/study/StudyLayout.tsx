import { ChevronRight, ArrowLeft } from "lucide-react";
import { apiGet } from "./api/client";
import { useApi } from "./api/hooks";
import type { Study } from "./api/types";
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
import { AuditTab } from "./tabs/AuditTab";
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
        {currentTab === "audit" && <AuditTab study={study} />}
      </main>
    </div>
  );
}
