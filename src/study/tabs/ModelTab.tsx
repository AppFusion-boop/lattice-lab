import { useState } from "react";
import {
  Workflow,
  Plus,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { apiGet } from "../api/client";
import { useApi } from "../api/hooks";
import type { Study, ModelVersion } from "../api/types";
import { navigate } from "../../app/router";
import { tr } from "../../i18n";
import { BindingDialog } from "../components/BindingDialog";
import { tunnelProject } from "../../core/tunnel-demo";

interface ModelTabProps {
  study: Study;
}

export function ModelTab({ study }: ModelTabProps) {
  const [showBindingDialog, setShowBindingDialog] = useState<boolean>(false);
  const [expandedVersions, setExpandedVersions] = useState<Record<string, boolean>>({});

  const {
    data: models,
    loading,
    error,
    refresh,
  } = useApi<ModelVersion[]>(`models-${study.id}`, () =>
    apiGet<ModelVersion[]>(`/studies/${study.id}/models`),
  );

  const toggleExpand = (id: string) => {
    setExpandedVersions((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const latestModel = models && models.length > 0 ? models[0] : null;

  return (
    <div className="study-tab-content">
      {/* Tab Header Actions */}
      <div className="study-tab-header">
        <div>
          <h3 className="study-section-title">
            {tr("სიმულაციური ფლოუ მოდელი (Simulation Flow Model)", "Simulation Flow Model")}
          </h3>
          <p className="study-section-desc">
            {tr(
              "ფიზიკური და მათემატიკური ნოუდების გრაფის ინტეგრაცია კანდიდატების სიმულაციური ტესტირებისთვის.",
              "Integrate physical event & sensor graph simulations to evaluate candidates under uncertainty.",
            )}
          </p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn-secondary"
            onClick={() => {
              // Open Flow editor with this study context
              navigate(`flow?studyId=${study.id}`);
            }}
            title={tr("ფლოუს რედაქტორში გადასვლა", "Open Workflow Editor")}
          >
            <ExternalLink size={14} />
            <span>{tr("ფლოუს რედაქტორი", "Open Flow Editor")}</span>
          </button>

          <button
            className="btn-primary"
            onClick={() => setShowBindingDialog(true)}
          >
            <Plus size={14} />
            <span>{tr("მოდელის ვერსიის შექმნა", "Create Model Version")}</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="study-card" style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
          {tr("მოდელის ვერსიები იტვირთება...", "Loading model versions...")}
        </div>
      )}

      {error && (
        <div className="study-card" style={{ padding: 20, color: "#991b1b" }}>
          {error.message}
        </div>
      )}

      {/* No model attached state */}
      {!loading && (!models || models.length === 0) && (
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
              "თქვენ შეგიძლიათ ააგოთ ფლოუ ნოუდების რედაქტორში (სენსორები, ტალღები, ნისლი, ფორმულები) და დააკავშიროთ ამ კვლევის პარამეტრებთან და შედეგებთან. ეს საშუალებას მოგცემთ მონტე-კარლოს მეთოდით გამორიცხოთ უპერსპექტივო ექსპერიმენტები ფიზიკურ ტესტირებამდე.",
              "You can construct a node graph in the Flow editor (sensors, scene events, formulas) and bind it to this study's parameters and outcomes to simulate candidates under uncertainty before conducting physical lab runs.",
            )}
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            <button
              className="btn-primary"
              onClick={() => setShowBindingDialog(true)}
            >
              <Workflow size={14} />
              <span>{tr("მიმდინარე ფლოუს დაკავშირება", "Link Flow to Study")}</span>
            </button>
            <button
              className="btn-secondary"
              onClick={() => navigate(`flow?studyId=${study.id}`)}
            >
              <ExternalLink size={14} />
              <span>{tr("ფლოუს რედაქტორში გადასვლა", "Open Flow Editor")}</span>
            </button>
          </div>
        </div>
      )}

      {/* Latest Model Version Card */}
      {latestModel && (
        <div className="study-card" style={{ marginBottom: 24 }}>
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
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  background: "#0f172a",
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "4px 10px",
                  borderRadius: 6,
                }}
              >
                v{latestModel.version}
              </span>
              <div>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0f172a" }}>
                  {latestModel.notes || tr("აქტიური ფლოუ მოდელი", "Active Flow Model")}
                </h4>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  {tr("შექმნილია:", "Created:")} {new Date(latestModel.created_at).toLocaleString()} •{" "}
                  {tr("ძრავი:", "Engine:")} {latestModel.engine_version || "unknown"}
                </div>
              </div>
            </div>

            {/* Validation Badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {latestModel.validation_status === "validated" ? (
                <span className="badge badge-status-recommended" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <CheckCircle2 size={12} />
                  <span>{tr("ვალიდირებული მოდელი", "Validated Predictor")}</span>
                </span>
              ) : latestModel.validation_status === "failed" ? (
                <span className="badge badge-status-excluded" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <XCircle size={12} />
                  <span>{tr("ვალიდაცია ვერ გაიარა", "Validation Failed")}</span>
                </span>
              ) : (
                <span
                  className="badge badge-status-open"
                  style={{ display: "inline-flex", gap: 4, alignItems: "center", background: "#fef3c7", color: "#92400e" }}
                  title={tr(
                    "არავალიდირებულ მოდელს მხოლოდ კანდიდატების დეპრიორიტიზაცია შეუძლია; გამორიცხვა დაუშვებელია მტკიცებულებებით ვალიდაციამდე (Hard Rule 6).",
                    "Unvalidated predictor — may deprioritise candidates, cannot exclude until validated by evidence (Hard Rule 6).",
                  )}
                >
                  <AlertTriangle size={12} />
                  <span>{tr("არავალიდირებული (მხოლოდ დეპრიორიტიზაცია)", "Unvalidated (Deprioritise Only)")}</span>
                </span>
              )}
            </div>
          </div>

          {/* Bound Parameters */}
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
                      <td><code>{pb.param_key || "—"}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bound Outcomes */}
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
                      <td><code>{ob.port}</code></td>
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

          {/* Signature & Provenance */}
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
              <code style={{ fontSize: 11, color: "#475569" }}>{latestModel.signature?.slice(0, 24)}...</code>
            </div>
            <div>ID: {latestModel.id}</div>
          </div>
        </div>
      )}

      {/* Previous Versions Accordion */}
      {models && models.length > 1 && (
        <div className="study-card">
          <h4 style={{ margin: "0 0 12px 0", fontSize: 14, color: "#334155" }}>
            {tr("წინა ვერსიების ისტორია (Version History)", "Version History")}
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {models.slice(1).map((mv) => {
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
                      <strong>v{mv.version}</strong>
                      <span style={{ color: "#64748b" }}>{mv.notes || "Model version"}</span>
                    </div>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>
                      {new Date(mv.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {isOpen && (
                    <div style={{ padding: 14, fontSize: 12, color: "#475569" }}>
                      <div>Engine: {mv.engine_version}</div>
                      <div>Signature: <code>{mv.signature}</code></div>
                      <div style={{ marginTop: 6 }}>
                        Parameters bound: {mv.parameter_bindings.length} • Outcomes: {mv.outcome_bindings.length}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Binding Dialog Modal */}
      {showBindingDialog && (
        <BindingDialog
          project={latestModel?.project || (tunnelProject() as any)}
          isOpen={showBindingDialog}
          onClose={() => setShowBindingDialog(false)}
          defaultStudyId={study.id}
          onSuccess={() => {
            refresh();
          }}
        />
      )}
    </div>
  );
}

