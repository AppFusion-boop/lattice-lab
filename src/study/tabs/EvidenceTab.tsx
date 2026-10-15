import React, { useState } from "react";
import {
  Plus,
  FileSpreadsheet,
  BarChart2,
  Table as TableIcon,
  Filter,
  Eye,
  RotateCcw,
  AlertOctagon,
  X,
  RefreshCw,
} from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import { useApi } from "../api/hooks";
import type { Evidence, Outcome, Parameter, Source, Study } from "../api/types";
import { tr } from "../../i18n";
import { ImportWizard } from "../components/ImportWizard";
import { EvidenceScatterPlot } from "../components/EvidenceScatterPlot";

interface EvidenceTabProps {
  study: Study;
}

export function EvidenceTab({ study }: EvidenceTabProps) {
  const [viewMode, setViewMode] = useState<"table" | "plot">("table");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [includeRetracted, setIncludeRetracted] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modals & Drawers
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showImportWizard, setShowImportWizard] = useState<boolean>(false);
  const [detailEvidence, setDetailEvidence] = useState<Evidence | null>(null);
  const [supersedeTarget, setSupersedeTarget] = useState<Evidence | null>(null);
  const [retractTarget, setRetractTarget] = useState<Evidence | null>(null);

  // Queries
  const {
    data: evidenceList,
    loading: evidenceLoading,
    error: evidenceError,
    refresh: refreshEvidence,
  } = useApi<Evidence[]>(
    `evidence-${study.id}-${includeRetracted}`,
    () => apiGet<Evidence[]>(`/studies/${study.id}/evidence?include_retracted=${includeRetracted}`)
  );

  const { data: rawParameters } = useApi<Parameter[]>(
    `params-${study.id}`,
    () => apiGet<Parameter[]>(`/studies/${study.id}/parameters`)
  );
  const parameters = rawParameters ?? [];

  const { data: rawOutcomes } = useApi<Outcome[]>(
    `outcomes-${study.id}`,
    () => apiGet<Outcome[]>(`/studies/${study.id}/outcomes`)
  );
  const outcomes = rawOutcomes ?? [];

  const { data: rawSources, refresh: refreshSources } = useApi<Source[]>(
    `sources-${study.id}`,
    () => apiGet<Source[]>(`/studies/${study.id}/sources`)
  );
  const sources = rawSources ?? [];

  // Form states for Add / Supersede
  const [formSourceId, setFormSourceId] = useState<string>("");
  const [formKind, setFormKind] = useState<"field" | "lab" | "literature" | "simulation" | "expert">("lab");
  const [formStatus, setFormStatus] = useState<"valid" | "failed_run" | "outlier">("valid");
  const [formStatusReason, setFormStatusReason] = useState<string>("");
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [formOutcomes, setFormOutcomes] = useState<Record<string, { value?: string; sd?: string; n?: string }>>({});
  const [formReason, setFormReason] = useState<string>("");
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Retract form
  const [retractReason, setRetractReason] = useState<string>("");
  const [retractSubmitting, setRetractSubmitting] = useState<boolean>(false);
  const [retractError, setRetractError] = useState<string | null>(null);

  const openAddModal = () => {
    setFormSourceId(sources[0]?.id || "");
    setFormKind("lab");
    setFormStatus("valid");
    setFormStatusReason("");
    setFormValues({});
    setFormOutcomes({});
    setFormReason("");
    setFormError(null);
    setShowAddModal(true);
  };

  const openSupersedeModal = (ev: Evidence) => {
    setFormSourceId(ev.source_id || sources[0]?.id || "");
    setFormKind(ev.kind);
    setFormStatus(ev.status);
    setFormStatusReason(ev.status_reason || "");

    const prefillVals: Record<string, any> = { ...ev.values };
    setFormValues(prefillVals);

    const prefillOutcomes: Record<string, { value?: string; sd?: string; n?: string }> = {};
    for (const [k, v] of Object.entries(ev.outcomes)) {
      if (typeof v === "number") {
        prefillOutcomes[k] = { value: String(v) };
      } else if (v && typeof v === "object") {
        const obj = v as any;
        prefillOutcomes[k] = {
          value: obj.value !== undefined ? String(obj.value) : "",
          sd: obj.sd !== undefined ? String(obj.sd) : "",
          n: obj.n !== undefined ? String(obj.n) : "",
        };
      }
    }
    setFormOutcomes(prefillOutcomes);
    setFormReason("");
    setFormError(null);
    setSupersedeTarget(ev);
  };

  const handleSaveEvidence = async (isSupersede = false) => {
    setFormError(null);
    setFormSubmitting(true);

    try {
      // Validate controlled parameters
      const controlled = parameters.filter((p) => p.role === "controlled");
      const cleanValues: Record<string, any> = {};
      for (const p of controlled) {
        const val = formValues[p.key];
        if (val === undefined || val === "") {
          throw new Error(tr(`სავალდებულო პარამეტრი შევსებული არ არის: ${p.label || p.key}`, `Required parameter missing: ${p.label || p.key}`));
        }
        if (p.kind === "continuous" || p.kind === "integer") {
          const num = parseFloat(String(val));
          if (isNaN(num)) throw new Error(`Invalid number for ${p.label || p.key}`);
          cleanValues[p.key] = p.kind === "integer" ? Math.round(num) : num;
        } else {
          cleanValues[p.key] = val;
        }
      }

      // Uncertain parameters if provided
      for (const p of parameters.filter((p) => p.role === "uncertain")) {
        const val = formValues[p.key];
        if (val !== undefined && val !== "") {
          if (p.kind === "continuous" || p.kind === "integer") {
            const num = parseFloat(String(val));
            if (!isNaN(num)) cleanValues[p.key] = p.kind === "integer" ? Math.round(num) : num;
          } else {
            cleanValues[p.key] = val;
          }
        }
      }

      // Format outcomes
      const cleanOutcomes: Record<string, any> = {};
      for (const o of outcomes) {
        const entry = formOutcomes[o.key];
        if (entry && entry.value !== undefined && entry.value.trim() !== "") {
          const v = parseFloat(entry.value);
          if (isNaN(v)) throw new Error(`Invalid value for outcome ${o.label || o.key}`);

          const outObj: Record<string, any> = { value: v };
          if (entry.sd && entry.sd.trim() !== "") {
            const sd = parseFloat(entry.sd);
            if (!isNaN(sd)) outObj.sd = sd;
          }
          if (entry.n && entry.n.trim() !== "") {
            const n = parseInt(entry.n, 10);
            if (!isNaN(n)) outObj.n = n;
          }
          cleanOutcomes[o.key] = outObj;
        }
      }

      if (Object.keys(cleanOutcomes).length === 0) {
        throw new Error(tr("მინიმუმ ერთი შედეგი უნდა იყოს შევსებული.", "At least one outcome must be specified."));
      }

      if (formStatus !== "valid" && !formStatusReason.trim()) {
        throw new Error(tr("არავალიდური სტატუსისთვის მიზეზის მითითება სავალდებულოა.", "Status reason is required when status is not valid."));
      }

      if (isSupersede) {
        if (!supersedeTarget) return;
        if (!formReason.trim() || formReason.trim().length < 3) {
          throw new Error(tr("ჩანაცვლების მიზეზი სავალდებულოა (მინიმუმ 3 სიმბოლო).", "Reason for supersede is required (at least 3 characters)."));
        }

        await apiPost<Evidence>(`/evidence/${supersedeTarget.id}/supersede`, {
          kind: formKind,
          source_id: formSourceId || null,
          status: formStatus,
          status_reason: formStatus !== "valid" ? formStatusReason : null,
          values: cleanValues,
          outcomes: cleanOutcomes,
          reason: formReason.trim(),
        });
        setSupersedeTarget(null);
      } else {
        await apiPost<Evidence>(`/studies/${study.id}/evidence`, {
          kind: formKind,
          source_id: formSourceId || null,
          status: formStatus,
          status_reason: formStatus !== "valid" ? formStatusReason : null,
          values: cleanValues,
          outcomes: cleanOutcomes,
        });
        setShowAddModal(false);
      }

      refreshEvidence();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setFormError(e.message || "Failed to save evidence");
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleRetract = async () => {
    if (!retractTarget) return;
    if (!retractReason.trim() || retractReason.trim().length < 3) {
      setRetractError(tr("გაწვევის მიზეზი სავალდებულოა (მინიმუმ 3 სიმბოლო).", "Retraction reason is required (min 3 chars)."));
      return;
    }

    setRetractSubmitting(true);
    setRetractError(null);

    try {
      await apiPost<Evidence>(`/evidence/${retractTarget.id}/retract`, {
        reason: retractReason.trim(),
      });
      setRetractTarget(null);
      setRetractReason("");
      refreshEvidence();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setRetractError(e.message || "Retraction failed");
    } finally {
      setRetractSubmitting(false);
    }
  };

  // Filter evidence
  const allEvidence = evidenceList || [];
  const filteredEvidence = allEvidence.filter((ev) => {
    if (kindFilter && ev.kind !== kindFilter) return false;
    if (statusFilter && ev.status !== statusFilter) return false;
    if (sourceFilter && ev.source_id !== sourceFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchId = ev.id.toLowerCase().includes(q);
      const sourceCitation = ev.source_id ? sources.find((s) => s.id === ev.source_id)?.citation : "";
      const matchSource = sourceCitation ? sourceCitation.toLowerCase().includes(q) : false;
      const matchValues = JSON.stringify(ev.values).toLowerCase().includes(q);
      if (!matchId && !matchSource && !matchValues) return false;
    }
    return true;
  });

  return (
    <div>
      {/* Top action header */}
      <div
        className="study-card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          padding: "16px 20px",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 4px 0", fontSize: 16 }}>
            {tr("მტკიცებულებათა ბაზა (Evidence Store)", "Evidence Store")}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            {tr(
              "ექსპერიმენტული, სალაბორატორიო და ლიტერატურული მონაცემები. შეუცვლელი ჩანაწერები (§4.2, §6).",
              "Physical, experimental, and literature evidence. Immutable records matching study parameters."
            )}
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* View toggle */}
          <div style={{ display: "flex", background: "#f1f5f9", padding: 3, borderRadius: 6 }}>
            <button
              className={`study-tab-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
              style={{ padding: "4px 10px", fontSize: 12, border: "none" }}
            >
              <TableIcon size={14} style={{ marginRight: 4 }} />
              <span>{tr("ცხრილი", "Table")}</span>
            </button>
            <button
              className={`study-tab-btn ${viewMode === "plot" ? "active" : ""}`}
              onClick={() => setViewMode("plot")}
              style={{ padding: "4px 10px", fontSize: 12, border: "none" }}
            >
              <BarChart2 size={14} style={{ marginRight: 4 }} />
              <span>{tr("დიაგრამა", "Scatter Plot")}</span>
            </button>
          </div>

          <button className="btn-secondary" onClick={() => setShowImportWizard(true)}>
            <FileSpreadsheet size={14} />
            <span>{tr("იმპორტი (CSV/XLSX)", "Import CSV/XLSX")}</span>
          </button>

          <button className="btn-primary" onClick={openAddModal}>
            <Plus size={14} />
            <span>{tr("მტკიცებულების დამატება", "Add Evidence")}</span>
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="study-card"
        style={{
          padding: "12px 16px",
          marginBottom: 16,
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Filter size={14} color="#64748b" />

        <input
          type="text"
          placeholder={tr("ძიება ID, წყარო, მნიშვნელობა...", "Search ID, citation, values...")}
          className="study-form-input"
          style={{ width: 220 }}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <select
          className="study-form-input"
          style={{ width: 140 }}
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="">{tr("ყველა ტიპი", "All Kinds")}</option>
          <option value="field">{tr("საველე (Field)", "Field")}</option>
          <option value="lab">{tr("ლაბორატორია (Lab)", "Lab")}</option>
          <option value="literature">{tr("ლიტერატურა (Literature)", "Literature")}</option>
          <option value="simulation">{tr("სიმულაცია (Simulation)", "Simulation")}</option>
          <option value="expert">{tr("ექსპერტი (Expert)", "Expert")}</option>
        </select>

        <select
          className="study-form-input"
          style={{ width: 150 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">{tr("ყველა სტატუსი", "All Statuses")}</option>
          <option value="valid">{tr("ვალიდური (Valid)", "Valid")}</option>
          <option value="failed_run">{tr("წარუმატებელი (Failed Run)", "Failed Run")}</option>
          <option value="outlier">{tr("ამოვარდნილი (Outlier)", "Outlier")}</option>
        </select>

        <select
          className="study-form-input"
          style={{ maxWidth: 200 }}
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        >
          <option value="">{tr("ყველა წყარო", "All Sources")}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.citation || s.id}
            </option>
          ))}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", color: "#475569" }}>
          <input
            type="checkbox"
            checked={includeRetracted}
            onChange={(e) => setIncludeRetracted(e.target.checked)}
          />
          {tr("გაწვეულების ჩვენება", "Show retracted")}
        </label>

        <button
          className="btn-secondary"
          onClick={() => {
            refreshEvidence();
            refreshSources();
          }}
          title={tr("განახლება", "Refresh")}
          style={{ padding: "6px 10px", marginLeft: "auto" }}
        >
          <RefreshCw size={13} />
        </button>

        <span style={{ fontSize: 13, color: "#64748b" }}>
          {tr(`${filteredEvidence.length} ჩანაწერი`, `${filteredEvidence.length} records`)}
        </span>
      </div>

      {/* Main Content Area: Table or Scatter Plot */}
      {viewMode === "plot" ? (
        <div className="study-card">
          <EvidenceScatterPlot
            evidence={filteredEvidence}
            parameters={parameters}
            outcomes={outcomes}
          />
        </div>
      ) : (
        <div className="study-card">
          {evidenceLoading && allEvidence.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
              {tr("მტკიცებულებები იტვირთება...", "Loading evidence...")}
            </div>
          ) : evidenceError ? (
            <div style={{ padding: 20, color: "#dc2626", background: "#fef2f2", borderRadius: 6 }}>
              {evidenceError.message}
            </div>
          ) : filteredEvidence.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
              {tr("მტკიცებულებები არ მოიძებნა.", "No evidence records match the current filters.")}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="study-table" style={{ width: "100%", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>ID</th>
                    <th style={{ width: 90 }}>{tr("ტიპი", "Kind")}</th>
                    <th style={{ width: 100 }}>{tr("სტატუსი", "Status")}</th>
                    <th style={{ width: 150 }}>{tr("წყარო", "Source")}</th>
                    <th>{tr("პარამეტრები (Canonical Values)", "Parameters")}</th>
                    <th>{tr("შედეგები (Outcomes)", "Outcomes")}</th>
                    <th style={{ width: 110 }}>{tr("თარიღი", "Date")}</th>
                    <th style={{ width: 140, textAlign: "right" }}>{tr("მოქმედება", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvidence.map((ev) => {
                    const isRetracted = !!ev.retracted_at;
                    let statusBadgeClass = "badge-status-recommended";
                    if (isRetracted) {
                      statusBadgeClass = "badge-status-excluded";
                    } else if (ev.status === "failed_run") {
                      statusBadgeClass = "badge-status-deprioritised";
                    } else if (ev.status === "outlier") {
                      statusBadgeClass = "badge-status-excluded";
                    }

                    return (
                      <tr
                        key={ev.id}
                        style={{
                          opacity: isRetracted ? 0.65 : 1,
                          background: isRetracted ? "#fafafa" : undefined,
                        }}
                      >
                        <td>
                          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
                            {ev.id}
                          </span>
                          {ev.supersedes_id && (
                            <div style={{ fontSize: 10, color: "#64748b" }}>
                              ↳ replaces {ev.supersedes_id.slice(-6)}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="badge badge-generic">{ev.kind}</span>
                        </td>
                        <td>
                          {isRetracted ? (
                            <span className="badge badge-status-excluded" title={ev.retraction_reason || ""}>
                              {tr("გაწვეული", "retracted")}
                            </span>
                          ) : (
                            <span className={`badge ${statusBadgeClass}`} title={ev.status_reason || ""}>
                              {ev.status}
                            </span>
                          )}
                        </td>
                        <td>
                          {(() => {
                            const citation = ev.source_id ? sources.find((s) => s.id === ev.source_id)?.citation : "";
                            return (
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#334155",
                                  maxWidth: 140,
                                  display: "inline-block",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={citation || ev.source_id || ""}
                              >
                                {citation || ev.source_id || "—"}
                              </span>
                            );
                          })()}
                        </td>
                        <td>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {Object.entries(ev.values).map(([k, v]) => (
                              <span
                                key={k}
                                style={{
                                  fontSize: 11,
                                  background: "#f1f5f9",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  fontFamily: "var(--font-mono, monospace)",
                                }}
                              >
                                {k}: {typeof v === "number" ? v.toFixed(2) : String(v)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {Object.entries(ev.outcomes).map(([k, rawVal]) => {
                              let text = "";
                              if (typeof rawVal === "number") {
                                text = rawVal.toFixed(2);
                              } else if (rawVal && typeof rawVal === "object") {
                                const v = (rawVal as any).value;
                                const s = (rawVal as any).sd;
                                text = typeof v === "number" ? v.toFixed(2) : String(v);
                                if (s !== undefined) text += ` ± ${s}`;
                              }
                              return (
                                <span
                                  key={k}
                                  style={{
                                    fontSize: 11,
                                    background: "#ecfdf5",
                                    color: "#065f46",
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    fontFamily: "var(--font-mono, monospace)",
                                  }}
                                >
                                  {k}: {text}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
                          {ev.recorded_at || ev.created_at.slice(0, 10)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: 4 }}>
                            <button
                              className="btn-secondary"
                              onClick={() => setDetailEvidence(ev)}
                              title={tr("დეტალები", "View Details")}
                              style={{ padding: "4px 6px" }}
                            >
                              <Eye size={12} />
                            </button>
                            {!isRetracted && (
                              <>
                                <button
                                  className="btn-secondary"
                                  onClick={() => openSupersedeModal(ev)}
                                  title={tr("ჩანაცვლება / შესწორება", "Supersede with updated values")}
                                  style={{ padding: "4px 6px" }}
                                >
                                  <RotateCcw size={12} />
                                </button>
                                <button
                                  className="btn-secondary"
                                  onClick={() => {
                                    setRetractTarget(ev);
                                    setRetractReason("");
                                    setRetractError(null);
                                  }}
                                  title={tr("გაწვევა", "Retract record")}
                                  style={{ padding: "4px 6px", color: "#dc2626" }}
                                >
                                  <AlertOctagon size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal: Add or Supersede Evidence */}
      {(showAddModal || supersedeTarget) && (
        <div className="study-modal-overlay">
          <div className="study-modal" style={{ maxWidth: 640 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                {supersedeTarget
                  ? tr("მტკიცებულების ჩანაცვლება (Supersede)", "Supersede Evidence Record")
                  : tr("ახალი მტკიცებულების დამატება", "Add Evidence Record")}
              </h3>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowAddModal(false);
                  setSupersedeTarget(null);
                }}
                style={{ padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>

            {formError && (
              <div style={{ padding: "10px 14px", background: "#fef2f2", color: "#991b1b", borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
                {formError}
              </div>
            )}

            <div style={{ maxHeight: "65vh", overflowY: "auto", paddingRight: 6 }}>
              {supersedeTarget && (
                <div style={{ marginBottom: 16 }}>
                  <label className="study-form-label" style={{ color: "#b91c1c", fontWeight: 600 }}>
                    {tr("ჩანაცვლების მიზეზი (სავალდებულო):", "Supersede Reason (Required):")}
                  </label>
                  <input
                    type="text"
                    className="study-form-input"
                    placeholder={tr("მაგ. კალიბრაციის შესწორება, ხელახალი გაზომვა...", "e.g. Recalibrated sensor drift...")}
                    value={formReason}
                    onChange={(e) => setFormReason(e.target.value)}
                  />
                </div>
              )}

              {/* Source & Kind */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label className="study-form-label">{tr("წყარო (Source):", "Source:")}</label>
                  <select
                    className="study-form-input"
                    value={formSourceId}
                    onChange={(e) => setFormSourceId(e.target.value)}
                  >
                    <option value="">{tr("წყაროს გარეშე", "No source record")}</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.citation || s.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="study-form-label">{tr("ტიპი (Kind):", "Kind:")}</label>
                  <select
                    className="study-form-input"
                    value={formKind}
                    onChange={(e) => setFormKind(e.target.value as any)}
                  >
                    <option value="field">{tr("საველე (Field)", "Field")}</option>
                    <option value="lab">{tr("ლაბორატორია (Lab)", "Lab")}</option>
                    <option value="literature">{tr("ლიტერატურა (Literature)", "Literature")}</option>
                    <option value="simulation">{tr("სიმულაცია (Simulation)", "Simulation")}</option>
                    <option value="expert">{tr("ექსპერტი (Expert)", "Expert")}</option>
                  </select>
                </div>
              </div>

              {/* Status & Status Reason */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label className="study-form-label">{tr("სტატუსი (Status):", "Status:")}</label>
                  <select
                    className="study-form-input"
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                  >
                    <option value="valid">{tr("ვალიდური (Valid)", "Valid")}</option>
                    <option value="failed_run">{tr("წარუმატებელი ცდა (Failed Run)", "Failed Run")}</option>
                    <option value="outlier">{tr("ამოვარდნილი მნიშვნელობა (Outlier)", "Outlier")}</option>
                  </select>
                </div>

                {formStatus !== "valid" && (
                  <div>
                    <label className="study-form-label">{tr("სტატუსის მიზეზი (სავალდებულო):", "Status Reason:")}</label>
                    <input
                      type="text"
                      className="study-form-input"
                      placeholder={tr("მაგ. გაჟონვა, აპარატურის გათიშვა...", "e.g. Pump choked...")}
                      value={formStatusReason}
                      onChange={(e) => setFormStatusReason(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Parameters section */}
              <h4 style={{ margin: "16px 0 8px 0", fontSize: 13, textTransform: "uppercase", color: "#64748b" }}>
                {tr("პარამეტრების მნიშვნელობები", "Parameter Values")}
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {parameters.map((p) => {
                  const isControlled = p.role === "controlled";
                  return (
                    <div key={p.key}>
                      <label className="study-form-label">
                        {p.label || p.key} {p.unit ? `[${p.unit}]` : ""} {isControlled && <span style={{ color: "#dc2626" }}>*</span>}
                      </label>
                      <input
                        type={p.kind === "continuous" || p.kind === "integer" ? "number" : "text"}
                        step={p.kind === "continuous" ? "any" : "1"}
                        className="study-form-input"
                        placeholder={`Value in ${p.unit || "canonical"}`}
                        value={formValues[p.key] !== undefined ? formValues[p.key] : ""}
                        onChange={(e) =>
                          setFormValues({ ...formValues, [p.key]: e.target.value })
                        }
                      />
                    </div>
                  );
                })}
              </div>

              {/* Outcomes section */}
              <h4 style={{ margin: "16px 0 8px 0", fontSize: 13, textTransform: "uppercase", color: "#64748b" }}>
                {tr("შედეგები (Outcomes & Uncertainty)", "Outcomes & Uncertainty")}
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {outcomes.map((o) => {
                  const entry = formOutcomes[o.key] || {};
                  return (
                    <div
                      key={o.key}
                      style={{
                        padding: 10,
                        background: "#f8fafc",
                        borderRadius: 6,
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 6 }}>
                        {o.label || o.key} {o.unit ? `[${o.unit}]` : ""}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 11, color: "#64748b" }}>{tr("მნიშვნელობა", "Value")}</label>
                          <input
                            type="number"
                            step="any"
                            className="study-form-input"
                            value={entry.value || ""}
                            onChange={(e) =>
                              setFormOutcomes({
                                ...formOutcomes,
                                [o.key]: { ...entry, value: e.target.value },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: "#64748b" }}>SD (±)</label>
                          <input
                            type="number"
                            step="any"
                            className="study-form-input"
                            value={entry.sd || ""}
                            onChange={(e) =>
                              setFormOutcomes({
                                ...formOutcomes,
                                [o.key]: { ...entry, sd: e.target.value },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: "#64748b" }}>N ({tr("რაოდენობა", "reps")})</label>
                          <input
                            type="number"
                            step="1"
                            className="study-form-input"
                            value={entry.n || ""}
                            onChange={(e) =>
                              setFormOutcomes({
                                ...formOutcomes,
                                [o.key]: { ...entry, n: e.target.value },
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowAddModal(false);
                  setSupersedeTarget(null);
                }}
                disabled={formSubmitting}
              >
                {tr("გაუქმება", "Cancel")}
              </button>
              <button
                className="btn-primary"
                onClick={() => handleSaveEvidence(!!supersedeTarget)}
                disabled={formSubmitting}
              >
                {formSubmitting
                  ? tr("ინახება...", "Saving...")
                  : supersedeTarget
                  ? tr("ჩანაცვლება", "Supersede Record")
                  : tr("დამატება", "Add Evidence")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Retract Evidence */}
      {retractTarget && (
        <div className="study-modal-overlay">
          <div className="study-modal" style={{ maxWidth: 460 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#b91c1c", marginBottom: 12 }}>
              <AlertOctagon size={22} />
              <h3 style={{ margin: 0, fontSize: 16 }}>{tr("მტკიცებულების გაწვევა", "Retract Evidence Record")}</h3>
            </div>

            <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.5, margin: "0 0 14px 0" }}>
              {tr(
                `ჩანაწერი ${retractTarget.id} სამუდამოდ მოინიშნება როგორც გაწვეული. მონაცემთა შეუცვლელობის პრინციპით ის არ წაიშლება ბაზიდან, თუმცა აღარ მიიღებს მონაწილეობას სკრინინგში.`,
                `Evidence record ${retractTarget.id} will be marked as retracted with an append-only audit entry. It will no longer be considered for candidate screening or surrogate models.`
              )}
            </p>

            {retractError && (
              <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#991b1b", borderRadius: 6, marginBottom: 14, fontSize: 12 }}>
                {retractError}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label className="study-form-label" style={{ fontWeight: 600 }}>
                {tr("გაწვევის მიზეზი (სავალდებულო, მინ. 3 სიმბოლო):", "Retraction Reason (Required, min 3 chars):")}
              </label>
              <input
                type="text"
                className="study-form-input"
                placeholder={tr("მაგ. ინსტრუმენტის დეფექტი, აღმოჩენილი შეცდომა...", "e.g. Sensor calibration error discovered...")}
                value={retractReason}
                onChange={(e) => setRetractReason(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                className="btn-secondary"
                onClick={() => setRetractTarget(null)}
                disabled={retractSubmitting}
              >
                {tr("გაუქმება", "Cancel")}
              </button>
              <button
                className="btn-primary"
                onClick={handleRetract}
                disabled={retractSubmitting}
                style={{ background: "#dc2626", borderColor: "#dc2626" }}
              >
                {retractSubmitting ? tr("მიმდინარეობს...", "Retracting...") : tr("გაწვევის დადასტურება", "Confirm Retraction")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer: Detail Evidence */}
      {detailEvidence && (
        <div className="study-modal-overlay" onClick={() => setDetailEvidence(null)}>
          <div
            className="study-modal"
            style={{ maxWidth: 540 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                {tr("მტკიცებულების დეტალები", "Evidence Details")}
              </h3>
              <button className="btn-secondary" onClick={() => setDetailEvidence(null)} style={{ padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ maxHeight: "70vh", overflowY: "auto", fontSize: 13 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>ID</div>
                  <code style={{ fontSize: 12 }}>{detailEvidence.id}</code>
                </div>
                <div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>{tr("სტატუსი", "Status")}</div>
                  <span className="badge badge-generic">{detailEvidence.status}</span>
                </div>
                <div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>{tr("ტიპი", "Kind")}</div>
                  <span>{detailEvidence.kind}</span>
                </div>
                <div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>{tr("შექმნის დრო", "Created At")}</div>
                  <span>{new Date(detailEvidence.created_at).toLocaleString()}</span>
                </div>
              </div>

              {detailEvidence.source_id && (
                <div style={{ marginBottom: 12, padding: 8, background: "#f8fafc", borderRadius: 6 }}>
                  <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>{tr("წყარო (Source)", "Source")}</div>
                  <div style={{ fontWeight: 500 }}>
                    {sources.find((s) => s.id === detailEvidence.source_id)?.citation || detailEvidence.source_id}
                  </div>
                </div>
              )}

              {detailEvidence.retracted_at && (
                <div style={{ marginBottom: 12, padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{tr("გაწვეულია", "Retracted Record")}</div>
                  <div style={{ fontSize: 12 }}>{detailEvidence.retraction_reason}</div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                    {new Date(detailEvidence.retracted_at).toLocaleString()}
                  </div>
                </div>
              )}

              <h4 style={{ margin: "12px 0 6px 0", fontSize: 12, textTransform: "uppercase", color: "#64748b" }}>
                {tr("პარამეტრები", "Parameter Values")}
              </h4>
              <pre
                style={{
                  background: "#f1f5f9",
                  padding: 8,
                  borderRadius: 6,
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 12,
                  margin: 0,
                }}
              >
                {JSON.stringify(detailEvidence.values, null, 2)}
              </pre>

              <h4 style={{ margin: "14px 0 6px 0", fontSize: 12, textTransform: "uppercase", color: "#64748b" }}>
                {tr("შედეგები", "Outcomes")}
              </h4>
              <pre
                style={{
                  background: "#f1f5f9",
                  padding: 8,
                  borderRadius: 6,
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 12,
                  margin: 0,
                }}
              >
                {JSON.stringify(detailEvidence.outcomes, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Import Wizard Modal */}
      {showImportWizard && (
        <ImportWizard
          studyId={study.id}
          parameters={parameters}
          outcomes={outcomes}
          sources={sources}
          onComplete={() => {
            setShowImportWizard(false);
            refreshEvidence();
          }}
          onCancel={() => setShowImportWizard(false)}
        />
      )}
    </div>
  );
}
