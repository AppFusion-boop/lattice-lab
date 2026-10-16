import { useState, useMemo } from "react";
import {
  Box,
  SlidersHorizontal,
  Clock,
  Plus,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Workflow,
  ShieldCheck,
  Activity,
  Download,
  Sparkles,
} from "lucide-react";
import Workspace from "../../Workspace";
import { apiGet } from "../api/client";
import { useApi } from "../api/hooks";
import type { Study, ModelVersion, Parameter, Outcome, Evidence } from "../api/types";
import { tr } from "../../i18n";
import { BindingDialog } from "../components/BindingDialog";
import { TornadoChart } from "../components/TornadoChart";
import { FabricationExportModal } from "../components/FabricationExportModal";
import { CalibrationWizard } from "../components/CalibrationWizard";
import { tunnelProject } from "../../core/tunnel-demo";
import { molecularProject } from "../../core/molecule-demo";
import { microchannelProject } from "../../core/microchannel-demo";
import { skyscraperProject } from "../../core/skyscraper-demo";
import type { Project, Object3D } from "../../core/types";

interface ModelTabProps {
  study: Study;
}

export function ModelTab({ study }: ModelTabProps) {
  const [viewMode, setViewMode] = useState<"workspace" | "mappings" | "sensitivity" | "history">("workspace");
  const [showBindingDialog, setShowBindingDialog] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showCalibrationWizard, setShowCalibrationWizard] = useState<boolean>(false);
  const [expandedVersions, setExpandedVersions] = useState<Record<string, boolean>>({});

  const {
    data: models,
    loading,
    error,
    refresh,
  } = useApi<ModelVersion[]>(`models-${study.id}`, () =>
    apiGet<ModelVersion[]>(`/studies/${study.id}/models`),
  );

  const {
    data: parameters,
    refresh: refreshParams,
  } = useApi<Parameter[]>(`parameters-${study.id}`, () =>
    apiGet<Parameter[]>(`/studies/${study.id}/parameters`),
  );

  const {
    data: outcomes,
  } = useApi<Outcome[]>(`outcomes-${study.id}`, () =>
    apiGet<Outcome[]>(`/studies/${study.id}/outcomes`),
  );

  const {
    data: evidence,
  } = useApi<Evidence[]>(`evidence-${study.id}`, () =>
    apiGet<Evidence[]>(`/studies/${study.id}/evidence`),
  );

  const toggleExpand = (id: string) => {
    setExpandedVersions((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const latestModel = models && models.length > 0 ? models[0] : null;

  // Resolve active project: saved project from latest model, or demo for physics / chemistry studies
  const activeProject = useMemo<Project | undefined>(() => {
    if (latestModel?.project && typeof latestModel.project === "object") {
      return latestModel.project as Project;
    }
    if (
      study.name.toLowerCase().includes("microchannel") ||
      study.name.toLowerCase().includes("cold plate") ||
      study.name.toLowerCase().includes("heat")
    ) {
      return microchannelProject();
    }
    if (
      study.name.toLowerCase().includes("cement") ||
      study.name.toLowerCase().includes("skyscraper") ||
      study.name.toLowerCase().includes("concrete") ||
      study.name.toLowerCase().includes("tower") ||
      study.name.toLowerCase().includes("damped")
    ) {
      return skyscraperProject();
    }
    if (study.domain === "physics" || study.name.toLowerCase().includes("tunnel")) {
      return tunnelProject();
    }
    if (
      study.domain === "pharmacology" ||
      study.domain === "chemistry" ||
      study.name.toLowerCase().includes("molecule") ||
      study.name.toLowerCase().includes("drug") ||
      study.name.toLowerCase().includes("lead") ||
      study.name.toLowerCase().includes("oral")
    ) {
      return molecularProject();
    }
    return undefined;
  }, [latestModel, study]);

  const sceneObjects = useMemo<Object3D[]>(() => {
    if (!activeProject || !Array.isArray(activeProject.nodes)) return [];
    const sceneNode = activeProject.nodes.find((n) => n.kind === "scene3d" || n.kind === "scene");
    if (sceneNode && Array.isArray(sceneNode.params.objects)) {
      return sceneNode.params.objects as Object3D[];
    }
    return [];
  }, [activeProject]);

  return (
    <div className="model-tab-container">
      {/* Top Model Toolbar & Sub-navigation */}
      <div className="model-tab-toolbar">
        <div className="model-tab-toolbar-left">
          {/* Sub-view Switcher */}
          <div className="model-tab-modes">
            <button
              className={`model-mode-btn ${viewMode === "workspace" ? "active" : ""}`}
              onClick={() => setViewMode("workspace")}
              title={tr("ინტერაქტიული 3D სიმულაცია და ნოუდების გრაფი", "Interactive 3D simulation and node canvas")}
            >
              <Box size={13} />
              <span>{tr("3D სიმულაცია & ფლოუ", "3D Sim & Flow")}</span>
            </button>
            <button
              className={`model-mode-btn ${viewMode === "mappings" ? "active" : ""}`}
              onClick={() => setViewMode("mappings")}
              title={tr("კვლევის პარამეტრებისა და შედეგების მიბმის ცხრილი", "Parameter & outcome mapping tables")}
            >
              <SlidersHorizontal size={13} />
              <span>{tr("მიბმები & რედუქტორები", "Bindings & Reducers")}</span>
            </button>
            <button
              className={`model-mode-btn ${viewMode === "sensitivity" ? "active" : ""}`}
              onClick={() => setViewMode("sensitivity")}
              title={tr("სობოლის მგრძნობელობის ანალიზი და პარამეტრების გაყინვა", "Sobol sensitivity analysis & parameter freezing")}
            >
              <Activity size={13} />
              <span>{tr("მგრძნობელობა (Tornado)", "Sensitivity (Tornado)")}</span>
            </button>
            {models && models.length > 1 && (
              <button
                className={`model-mode-btn ${viewMode === "history" ? "active" : ""}`}
                onClick={() => setViewMode("history")}
                title={tr("მოდელის ვერსიების ისტორია", "Model version history")}
              >
                <Clock size={13} />
                <span>{tr("ისტორია", "History")} ({models.length})</span>
              </button>
            )}
          </div>

          {/* Model Status & Validation Pill */}
          {latestModel ? (
            <div className="model-status-chip">
              <span className="model-version-tag">v{latestModel.version}</span>
              <span className="model-name-tag" title={latestModel.notes || undefined}>
                {latestModel.notes || tr("აქტიური ფლოუ მოდელი", "Active Flow Model")}
              </span>
              {latestModel.validation_status === "validated" ? (
                <span className="badge badge-status-recommended" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <CheckCircle2 size={11} />
                  <span>{tr("ვალიდირებული", "Validated")}</span>
                </span>
              ) : latestModel.validation_status === "failed" ? (
                <span className="badge badge-status-excluded" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <XCircle size={11} />
                  <span>{tr("უარყოფილი", "Failed")}</span>
                </span>
              ) : (
                <span
                  className="badge badge-status-open"
                  style={{
                    display: "inline-flex",
                    gap: 4,
                    alignItems: "center",
                    background: "#fef3c7",
                    color: "#92400e",
                  }}
                  title={tr(
                    "არავალიდირებულ მოდელს მხოლოდ დეპრიორიტიზაცია შეუძლია; გამორიცხვა დაუშვებელია მტკიცებულებებით ვალიდაციამდე (Hard Rule 6).",
                    "Unvalidated predictor — may deprioritise candidates, cannot exclude until validated by physical evidence (Hard Rule 6).",
                  )}
                >
                  <AlertTriangle size={11} />
                  <span>{tr("არავალიდირებული (მხოლოდ დეპრიორიტიზაცია)", "Unvalidated (Deprioritise Only)")}</span>
                </span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
              {tr("მოდელის ვერსია ჯერ არ არის შენახული", "No saved model version yet")}
            </span>
          )}
        </div>

        {/* Right Toolbar Actions */}
        <div className="model-tab-toolbar-right">
          <button
            className="btn-secondary"
            style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 5 }}
            onClick={() => setShowExportModal(true)}
            title={tr("ფიზიკური დამზადების ექსპორტი (AutoCAD DXF, 3D STL, CSV)", "Export for CNC milling, Wire-EDM, and 3D printing (DXF, STL, CSV)")}
          >
            <Download size={13} />
            <span>{tr("CAD ექსპორტი (DXF/STL)", "CAD Export (DXF/STL)")}</span>
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 5 }}
            onClick={() => setShowCalibrationWizard(true)}
            title={tr("მოდელის ავტო-კალიბრაცია ლაბორატორიული მონაცემებით", "Auto-calibrate model with laboratory evidence")}
          >
            <Sparkles size={13} color="#059669" />
            <span>{tr("ავტო-კალიბრაცია", "Auto-Calibrate")}</span>
          </button>
          <button
            className="btn-primary"
            style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 5 }}
            onClick={() => setShowBindingDialog(true)}
            title={tr("ფლოუს პარამეტრების მიბმა და ახალი ვერსიის შენახვა", "Bind flow parameters & save as model version")}
          >
            <Plus size={13} />
            <span>{tr("ვერსიის შენახვა", "Save Version")}</span>
          </button>
        </div>
      </div>

      {/* Main Mode View Area */}
      {viewMode === "workspace" && (
        <div style={{ flex: 1, minHeight: 0, height: "100%", width: "100%", position: "relative" }}>
          <Workspace
            initialProject={activeProject}
            studyId={study.id}
            hideHeaderBrand={true}
          />
        </div>
      )}

      {viewMode === "mappings" && (
        <div className="model-tab-scroll-wrap">
          {loading && (
            <div className="study-card" style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
              {tr("მოდელის მონაცემები იტვირთება...", "Loading model data...")}
            </div>
          )}

          {error && (
            <div className="study-card" style={{ padding: 20, color: "#991b1b" }}>
              {error.message}
            </div>
          )}

          {!loading && !latestModel && (
            <div className="study-card" style={{ padding: 36, textAlign: "center" }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "#eff6ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px auto",
                  color: "#2563eb",
                }}
              >
                <Workflow size={24} />
              </div>
              <h4 style={{ margin: "0 0 8px 0", fontSize: 16, color: "#0f172a" }}>
                {tr("სიმულაციური მოდელი ჯერ არ არის მიბმული", "No Simulation Model Linked Yet")}
              </h4>
              <p
                style={{
                  margin: "0 auto 20px auto",
                  maxWidth: 520,
                  fontSize: 13,
                  color: "#64748b",
                  lineHeight: 1.5,
                }}
              >
                {tr(
                  "გადადით '3D სიმულაცია & ფლოუ' ჩანართზე ნოუდების რედაქტირებისთვის, ან დააჭირეთ 'ვერსიის შენახვა'-ს მიმდინარე ფლოუს კვლევასთან დასაკავშირებლად.",
                  "Switch to the '3D Sim & Flow' tab to construct your node graph, or click 'Save Version' to link the current flow model to this study's parameters.",
                )}
              </p>
              <button className="btn-primary" onClick={() => setShowBindingDialog(true)}>
                <Plus size={14} />
                <span>{tr("მიმდინარე ფლოუს დაკავშირება", "Link Flow to Study")}</span>
              </button>
            </div>
          )}

          {latestModel && (
            <div className="study-card">
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 16,
                  paddingBottom: 14,
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0f172a" }}>
                    {latestModel.notes || tr("აქტიური ფლოუ მოდელი", "Active Flow Model")}
                  </h4>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    {tr("შექმნილია:", "Created:")} {new Date(latestModel.created_at).toLocaleString()} •{" "}
                    {tr("ძრავი:", "Engine:")} {latestModel.engine_version || "unknown"}
                  </div>
                </div>

                <div style={{ fontSize: 11, color: "#64748b" }}>
                  <span>ID: </span>
                  <code>{latestModel.id}</code>
                </div>
              </div>

              {/* Bound Parameters Table */}
              <div style={{ marginBottom: 20 }}>
                <h5 style={{ margin: "0 0 8px 0", fontSize: 13, color: "#334155" }}>
                  {tr("დაკავშირებული პარამეტრები (Parameter Mappings):", "Parameter Mappings:")}
                </h5>
                <div className="evidence-table-container">
                  <table className="evidence-table">
                    <thead>
                      <tr>
                        <th>{tr("კვლევის პარამეტრი", "Study Parameter")}</th>
                        <th>{tr("სტატუსი", "Status")}</th>
                        <th>{tr("ფლოუს ნოუდი", "Flow Node")}</th>
                        <th>{tr("ნოუდის ველი", "Node Field")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestModel.parameter_bindings.map((pb) => (
                        <tr key={pb.parameter_key}>
                          <td>
                            <strong>{pb.parameter_key}</strong>
                          </td>
                          <td>
                            {pb.not_in_model ? (
                              <span style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 12 }}>
                                {tr("არ არის მოდელში (იგნორირებულია)", "Not in model (Ignored)")}
                              </span>
                            ) : (
                              <span style={{ color: "#166534", fontSize: 12, fontWeight: 500 }}>
                                {tr("აქტიური", "Active")}
                              </span>
                            )}
                          </td>
                          <td>{pb.node_id || "—"}</td>
                          <td>
                            <code>{pb.param_key || "—"}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bound Outcomes Table */}
              <div>
                <h5 style={{ margin: "0 0 8px 0", fontSize: 13, color: "#334155" }}>
                  {tr("დაკავშირებული შედეგები (Outcome Reducers):", "Outcome Reducers:")}
                </h5>
                <div className="evidence-table-container">
                  <table className="evidence-table">
                    <thead>
                      <tr>
                        <th>{tr("კვლევის შედეგი", "Study Outcome")}</th>
                        <th>{tr("ფლოუს ნოუდი", "Flow Node")}</th>
                        <th>{tr("გამომავალი პორტი", "Output Port")}</th>
                        <th>{tr("რედუქტორის ფორმულა", "Reducer")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestModel.outcome_bindings.map((ob) => (
                        <tr key={ob.outcome_key}>
                          <td>
                            <strong>{ob.outcome_key}</strong>
                          </td>
                          <td>{ob.node_id}</td>
                          <td>
                            <code>{ob.port}</code>
                          </td>
                          <td>
                            <span className="badge badge-role-controlled">{ob.reducer}</span>
                            {ob.threshold !== undefined && ob.threshold !== 0 && (
                              <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>
                                (threshold: {ob.threshold})
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Provenance & Signature */}
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: "1px solid #f1f5f9",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 11,
                  color: "#94a3b8",
                }}
              >
                <div>
                  <span>SHA-256 Signature: </span>
                  <code style={{ fontSize: 11, color: "#475569" }}>
                    {latestModel.signature?.slice(0, 32)}...
                  </code>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ShieldCheck size={12} color="#166534" />
                  <span>{tr("კრიპტოგრაფიულად ვალიდირებული ხელმოწერა", "Cryptographically Signed")}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode === "history" && (
        <div className="model-tab-scroll-wrap">
          <div className="study-card">
            <h4 style={{ margin: "0 0 12px 0", fontSize: 14, color: "#334155" }}>
              {tr("მოდელის ვერსიების ისტორია (Version History)", "Model Version History")}
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {models?.map((mv) => {
                const isOpen = !!expandedVersions[mv.id];
                return (
                  <div
                    key={mv.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      onClick={() => toggleExpand(mv.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        background: "#f8fafc",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="model-version-tag">v{mv.version}</span>
                        <strong>{mv.notes || "Model version"}</strong>
                      </div>
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>
                        {new Date(mv.created_at).toLocaleString()}
                      </span>
                    </div>

                    {isOpen && (
                      <div style={{ padding: 14, fontSize: 12, color: "#475569", background: "#ffffff" }}>
                        <div>
                          <strong>Engine:</strong> {mv.engine_version}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <strong>SHA-256:</strong> <code>{mv.signature}</code>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <strong>Parameters bound:</strong> {mv.parameter_bindings.length} •{" "}
                          <strong>Outcomes bound:</strong> {mv.outcome_bindings.length}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {viewMode === "sensitivity" && (
        <div className="model-tab-scroll-wrap" style={{ padding: "20px 24px" }}>
          <TornadoChart
            study={study}
            outcomes={outcomes || []}
            parameters={parameters || []}
            onParameterUpdated={() => {
              refreshParams();
            }}
          />
        </div>
      )}

      {/* Binding Dialog Modal */}
      {showBindingDialog && (
        <BindingDialog
          project={activeProject || (tunnelProject() as any)}
          isOpen={showBindingDialog}
          onClose={() => setShowBindingDialog(false)}
          defaultStudyId={study.id}
          onSuccess={() => {
            refresh();
          }}
        />
      )}

      {/* Fabrication CAD Export Modal */}
      {showExportModal && (
        <FabricationExportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          objects={sceneObjects}
          studyName={study.name}
        />
      )}

      {/* Auto-Calibration Wizard */}
      {showCalibrationWizard && (
        <CalibrationWizard
          isOpen={showCalibrationWizard}
          onClose={() => setShowCalibrationWizard(false)}
          study={study}
          parameters={parameters || []}
          outcomes={outcomes || []}
          evidence={evidence || []}
          onModelUpgraded={() => {
            refresh();
          }}
        />
      )}
    </div>
  );
}
