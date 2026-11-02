import { useState, useRef, useEffect, useMemo } from "react";
import {
  Download,
  Upload,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Pin,
  X,
  AlertCircle,
  Database,
  Filter,
  TrendingUp,
  FlaskConical,
  CheckCircle2,
  Search,
  Sliders,
} from "lucide-react";
import { apiGet, apiPost, ApiError } from "../api/client";
import { useApi } from "../api/hooks";
import type {
  Study,
  CandidateSet,
  Candidate,
  PaginatedCandidates,
  Parameter,
  Outcome,
  OverrideCreate,
  Evidence,
} from "../api/types";
import { tr } from "../../i18n";
import { useRoute } from "../../app/router";
import { ParetoExplorer } from "../components/ParetoExplorer";
import { RecordExperimentModal } from "../components/RecordExperimentModal";
import { CalibrationWizard } from "../components/CalibrationWizard";
import "../study.css";

interface CandidatesTabProps {
  study: Study;
  onCandidatesChanged?: () => void;
}

export function CandidatesTab({ study, onCandidatesChanged }: CandidatesTabProps) {
  const route = useRoute();
  const initialStatus = route.params.query?.status ?? "";
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [sortBy, setSortBy] = useState<string>("");
  const [searchIdx, setSearchIdx] = useState<string>("");

  useEffect(() => {
    if (route.params.query?.status !== undefined) {
      setStatusFilter(route.params.query.status);
      setPage(0);
    }
  }, [route.params.query?.status]);

  // Generate Modal
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [genMethod, setGenMethod] = useState<"grid" | "lhs" | "sobol">("grid");
  const [genN, setGenN] = useState("1000");
  const [genSeed, setGenSeed] = useState("42");
  const [genError, setGenError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Override Modal
  const [overrideCandidate, setOverrideCandidate] = useState<Candidate | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<"recommended" | "open" | "excluded" | "deprioritised">("recommended");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const {
    data: activeSet,
    refresh: refreshActiveSet,
  } = useApi<CandidateSet>(`active-cset-${study.id}`, () =>
    apiGet<CandidateSet>(`/studies/${study.id}/candidate-sets/active`).catch(() => null as unknown as CandidateSet)
  );

  const [showPareto, setShowPareto] = useState<boolean>(false);

  const { data: parameters } = useApi<Parameter[]>(`parameters-${study.id}`, () =>
    apiGet<Parameter[]>(`/studies/${study.id}/parameters`)
  );

  const { data: outcomes } = useApi<Outcome[]>(`outcomes-${study.id}`, () =>
    apiGet<Outcome[]>(`/studies/${study.id}/outcomes`)
  );

  const { data: evidenceList, refresh: refreshEvidence } = useApi<Evidence[]>(
    `evidence-${study.id}`,
    () => apiGet<Evidence[]>(`/studies/${study.id}/evidence`).catch(() => [])
  );

  const [recordCandidate, setRecordCandidate] = useState<Candidate | null>(null);
  const [showRecordModal, setShowRecordModal] = useState<boolean>(false);
  const [showCalibrationModal, setShowCalibrationModal] = useState<boolean>(false);

  const controlledParams = parameters?.filter((p) => p.role === "controlled" || p.role === "fixed") || [];

  const limit = 50;
  const queryParams = new URLSearchParams({
    offset: String(page * limit),
    limit: String(limit),
  });
  if (statusFilter) queryParams.set("status", statusFilter);
  if (sortBy) queryParams.set("sort_by", sortBy);

  const {
    data: candidatesData,
    loading: loadingCandidates,
    refresh: refreshCandidates,
  } = useApi<PaginatedCandidates>(
    `candidates-${study.id}-${page}-${statusFilter}-${sortBy}`,
    () => apiGet<PaginatedCandidates>(`/studies/${study.id}/candidates?${queryParams.toString()}`)
  );

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenError(null);
    setGenerating(true);

    try {
      const payload: Record<string, unknown> = {
        method: genMethod,
      };
      if (genMethod !== "grid") {
        payload.n = parseInt(genN, 10);
        if (genSeed) payload.seed = parseInt(genSeed, 10);
      }

      await apiPost(`/studies/${study.id}/candidate-sets/generate`, payload);
      setShowGenerateModal(false);
      setPage(0);
      refreshActiveSet();
      refreshCandidates();
      onCandidatesChanged?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setGenError(err.message);
      } else {
        setGenError((err as Error).message);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;

    setImportError(null);
    setImporting(true);

    const formData = new FormData();
    formData.append("file", importFile);
    formData.append("skip_invalid", String(skipInvalid));

    try {
      await apiPost(`/studies/${study.id}/candidate-sets/import`, formData);
      setShowImportModal(false);
      setImportFile(null);
      setPage(0);
      refreshActiveSet();
      refreshCandidates();
      onCandidatesChanged?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setImportError(err.message);
      } else {
        setImportError((err as Error).message);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideCandidate) return;

    setOverrideError(null);

    const payload: OverrideCreate = {
      values_hash: overrideCandidate.values_hash,
      status: overrideStatus,
      reason: overrideReason.trim(),
    };

    try {
      await apiPost(`/studies/${study.id}/overrides`, payload);
      setOverrideCandidate(null);
      setOverrideReason("");
      refreshCandidates();
      onCandidatesChanged?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setOverrideError(err.message);
      } else {
        setOverrideError((err as Error).message);
      }
    }
  };

  const handleExportCsv = () => {
    if (!candidatesData || candidatesData.items.length === 0) return;

    const headers = ["idx", "label", ...controlledParams.map((p) => p.key), "status", "filter", "reason"];
    const rows = candidatesData.items.map((c) => [
      c.idx,
      c.label || "",
      ...controlledParams.map((p) => c.values[p.key] ?? ""),
      c.decision?.status || "open",
      c.decision?.filter || "",
      `"${(c.decision?.reason || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `candidates_${study.id}_page${page + 1}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = candidatesData ? Math.ceil(candidatesData.total / limit) : 0;

  // Filter items if searching by candidate idx
  const displayedItems = useMemo(() => {
    if (!candidatesData?.items) return [];
    if (!searchIdx.trim()) return candidatesData.items;
    return candidatesData.items.filter((c) =>
      String(c.idx).includes(searchIdx.trim()) || (c.label && c.label.toLowerCase().includes(searchIdx.trim().toLowerCase()))
    );
  }, [candidatesData?.items, searchIdx]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Active Candidate Set & Action Header */}
      <div
        className="study-card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "14px 20px",
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
            <Database size={16} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--ll-text-primary)" }}>
              {tr("აქტიური კანდიდატების სიმრავლე", "Active Candidate Space Matrix")}
            </h4>
            <div style={{ fontSize: 11.5, color: "var(--ll-text-secondary)", marginTop: 2 }}>
              {activeSet ? (
                <>
                  <span>Method: <strong style={{ textTransform: "uppercase" }}>{activeSet.method}</strong></span>
                  {" • "}
                  <span>Total Space: <strong style={{ fontFamily: "var(--ll-font-mono)" }}>{activeSet.count.toLocaleString()}</strong> candidates</span>
                  {" • "}
                  <span style={{ color: "var(--ll-text-muted)" }}>{new Date(activeSet.created_at).toLocaleDateString()}</span>
                </>
              ) : (
                tr("კანდიდატები ჯერ არ არის გენერირებული.", "No active candidate set. Generate DoE points to begin screening.")
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            onClick={() => setShowPareto(!showPareto)}
            style={{ color: showPareto ? "var(--ll-blue)" : undefined }}
          >
            <TrendingUp size={13} color="var(--ll-blue)" />
            <span>{showPareto ? tr("პარეტოს დახურვა", "Hide Pareto") : tr("პარეტოს ფრონტირი", "Pareto Frontier")}</span>
          </button>

          <button
            className="btn-secondary"
            onClick={() => {
              setRecordCandidate(null);
              setShowRecordModal(true);
            }}
          >
            <FlaskConical size={13} color="var(--ll-emerald)" />
            <span>{tr("რეალური ცდის აღრიცხვა", "Record Lab Run")}</span>
          </button>

          <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
            <Upload size={13} />
            <span>{tr("იმპორტი (CSV/XLSX)", "Import CSV")}</span>
          </button>

          <button className="btn-primary" onClick={() => setShowGenerateModal(true)}>
            <Sparkles size={13} />
            <span>{tr("გენერირება (DoE)", "Generate DoE")}</span>
          </button>
        </div>
      </div>

      {/* Pareto Frontier Explorer Section */}
      {showPareto && (
        <div className="study-card" style={{ padding: "16px 20px", marginBottom: 0 }}>
          <ParetoExplorer
            study={study}
            outcomes={outcomes || []}
            onSelectCandidate={() => {}}
          />
        </div>
      )}

      {/* Candidates List with Filters & Controls */}
      <div className="study-card" style={{ padding: 0, overflow: "hidden", marginBottom: 0 }}>
        {/* Filter Strip */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 16px",
            background: "var(--ll-surface-subtle)",
            borderBottom: "1px solid var(--ll-border)",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          {/* Status Filter Segmented Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {[
              { id: "", label: tr("ყველა", "All") },
              { id: "recommended", label: tr("რეკომენდებული", "Recommended"), dot: "dot-recommended" },
              { id: "open", label: tr("ღია (შემოწმებადი)", "Open Viable"), dot: "dot-open" },
              { id: "deprioritised", label: tr("დეპრიორიტიზებული", "Deprioritised"), dot: "dot-deprioritised" },
              { id: "excluded", label: tr("უარყოფილი", "Excluded"), dot: "dot-excluded" },
              { id: "tested_pass", label: tr("Tested Pass", "Tested Pass") },
              { id: "tested_fail", label: tr("Tested Fail", "Tested Fail") },
            ].map((f) => {
              const active = statusFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  className="btn-ghost"
                  style={{
                    padding: "3px 8px",
                    fontSize: 11.5,
                    fontWeight: active ? 650 : 500,
                    background: active ? "var(--ll-surface)" : "transparent",
                    color: active ? "var(--ll-text-primary)" : "var(--ll-text-secondary)",
                    boxShadow: active ? "var(--ll-shadow-xs)" : "none",
                    borderRadius: "var(--ll-radius-sm)",
                  }}
                  onClick={() => {
                    setStatusFilter(f.id);
                    setPage(0);
                  }}
                >
                  {f.dot && <span className={`dot ${f.dot}`} style={{ marginRight: 4 }} />}
                  <span>{f.label}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Search & Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ll-text-muted)" }} />
              <input
                type="text"
                placeholder="Jump to #IDX..."
                className="form-input"
                style={{ width: 120, height: 26, fontSize: 11, paddingLeft: 24 }}
                value={searchIdx}
                onChange={(e) => setSearchIdx(e.target.value)}
              />
            </div>

            <button
              className="btn-secondary"
              onClick={handleExportCsv}
              disabled={!candidatesData || candidatesData.items.length === 0}
              style={{ height: 26, padding: "0 8px", fontSize: 11 }}
              title="Export visible candidates to CSV"
            >
              <Download size={12} />
              <span>CSV</span>
            </button>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <button
                  className="btn-secondary"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  style={{ height: 26, width: 26, padding: 0 }}
                >
                  <ChevronLeft size={13} />
                </button>
                <span style={{ fontSize: 11, padding: "0 6px", fontFamily: "var(--ll-font-mono)", color: "var(--ll-text-secondary)" }}>
                  {page + 1} / {totalPages}
                </span>
                <button
                  className="btn-secondary"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  style={{ height: 26, width: 26, padding: 0 }}
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Data Table */}
        {loadingCandidates ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ll-text-muted)" }}>
            {tr("იტვირთება...", "Loading candidates...")}
          </div>
        ) : !candidatesData || candidatesData.items.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ll-text-muted)" }}>
            {tr("მითითებული ფილტრით კანდიდატები ვერ მოიძებნა.", "No candidates found matching the selected filter.")}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="study-table">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>#IDX</th>
                  {controlledParams.map((p) => (
                    <th key={p.key}>
                      {p.label || p.key} {p.unit ? <span style={{ color: "var(--ll-text-muted)", textTransform: "none" }}>({p.unit})</span> : ""}
                    </th>
                  ))}
                  <th style={{ width: 140 }}>{tr("სტატუსი", "Decision")}</th>
                  <th>{tr("მიზეზი / ფილტრი", "Scientific Filter & Rationale")}</th>
                  <th style={{ width: 110, textAlign: "right" }}>{tr("მოქმედება", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {displayedItems.map((cand) => {
                  const dec = cand.decision;
                  const status = dec?.status || "open";

                  return (
                    <tr key={cand.id}>
                      <td style={{ fontFamily: "var(--ll-font-mono)", color: "var(--ll-text-muted)", fontSize: 11 }}>
                        #{cand.idx}
                      </td>

                      {controlledParams.map((p) => (
                        <td key={p.key} style={{ fontFamily: "var(--ll-font-mono)", fontSize: 12 }}>
                          {cand.values[p.key] !== undefined ? String(cand.values[p.key]) : "—"}
                        </td>
                      ))}

                      <td>
                        {status === "tested_pass" ? (
                          <span className="badge badge-status-tested_pass" title="Verified Physical Ground Truth Pass">
                            <CheckCircle2 size={11} />
                            <span>TESTED PASS</span>
                          </span>
                        ) : status === "tested_fail" ? (
                          <span className="badge badge-status-tested_fail" title="Verified Physical Ground Truth Fail">
                            <AlertCircle size={11} />
                            <span>TESTED FAIL</span>
                          </span>
                        ) : (
                          <span className={`badge badge-status-${status}`}>{status}</span>
                        )}
                      </td>

                      <td style={{ fontSize: 11.5, color: status === "excluded" ? "var(--ll-rose-text)" : "var(--ll-text-secondary)" }}>
                        {dec ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span
                              style={{
                                fontFamily: "var(--ll-font-mono)",
                                fontSize: 10,
                                background: dec.filter === "evidence_match" ? "var(--ll-emerald-soft)" : "var(--ll-surface-hover)",
                                color: dec.filter === "evidence_match" ? "var(--ll-emerald-text)" : "var(--ll-text-secondary)",
                                padding: "1px 5px",
                                borderRadius: "var(--ll-radius-sm)",
                                border: "1px solid var(--ll-border)",
                              }}
                            >
                              [{dec.filter}]
                            </span>
                            <span>{dec.reason}</span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <button
                            className="btn-ghost"
                            onClick={() => {
                              setRecordCandidate(cand);
                              setShowRecordModal(true);
                            }}
                            style={{ padding: "3px 6px", fontSize: 10.5, color: "var(--ll-emerald)" }}
                            title={tr("ამ კანდიდატისთვის რეალური ექსპერიმენტის აღრიცხვა", "Record real physical bench run for this candidate")}
                          >
                            <FlaskConical size={11} />
                            <span>Run</span>
                          </button>

                          <button
                            className="btn-ghost"
                            onClick={() => {
                              setOverrideCandidate(cand);
                              setOverrideStatus(status === "excluded" ? "recommended" : "excluded");
                              setOverrideReason("");
                              setOverrideError(null);
                            }}
                            style={{ padding: "3px 6px", fontSize: 10.5, color: "var(--ll-text-muted)" }}
                            title="Human Scientific Override"
                          >
                            <Pin size={11} />
                            <span>Pin</span>
                          </button>
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

      {/* Generate Candidates Modal */}
      {showGenerateModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 className="modal-title">{tr("კანდიდატების გენერირება (Design of Experiments)", "Generate Candidates (DoE)")}</h3>
              <button type="button" className="btn-ghost" onClick={() => setShowGenerateModal(false)} style={{ padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleGenerate}>
              <div className="modal-body">
                {genError && (
                  <div
                    style={{
                      padding: 10,
                      background: "var(--ll-rose-soft)",
                      border: "1px solid var(--ll-rose-border)",
                      borderRadius: "var(--ll-radius-md)",
                      color: "var(--ll-rose-text)",
                      fontSize: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>{genError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">{tr("გენერირების მეთოდი", "Sampling Method")}</label>
                  <select className="form-select" value={genMethod} onChange={(e) => setGenMethod(e.target.value as any)}>
                    <option value="grid">Grid (Cartesian Full Factorial Grid with Discrete Levels)</option>
                    <option value="lhs">Latin Hypercube Sampling (LHS Space-Filling Stratification)</option>
                    <option value="sobol">Sobol Sequence (Scrambled Low-Discrepancy Quasi-Monte Carlo)</option>
                  </select>
                </div>

                {genMethod === "grid" ? (
                  <div style={{ padding: 12, background: "var(--ll-surface-subtle)", border: "1px solid var(--ll-border)", borderRadius: "var(--ll-radius-md)", fontSize: 12, color: "var(--ll-text-secondary)" }}>
                    <p style={{ margin: 0 }}>
                      {tr(
                        "ბადე აგენერირებს მართვადი პარამეტრების დონეების დეკარტულ ნამრავლს. მაქსიმალური დასაშვები ლიმიტია 250,000 კანდიდატი.",
                        "Grid evaluates the Cartesian product of configured parameter levels. Cap limit is 250,000 candidates."
                      )}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="form-group">
                      <label className="form-label">{tr("კანდიდატების რაოდენობა (N)", "Sample Size (N)")}</label>
                      <input
                        type="number"
                        min="10"
                        max="250000"
                        className="form-input"
                        value={genN}
                        onChange={(e) => setGenN(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{tr("შემთხვევითობის თესლი (Seed)", "Random Seed")}</label>
                      <input
                        type="number"
                        className="form-input"
                        value={genSeed}
                        onChange={(e) => setGenSeed(e.target.value)}
                        placeholder="e.g. 42"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowGenerateModal(false)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary" disabled={generating}>
                  {generating ? tr("გენერირდება...", "Generating...") : tr("გენერირება", "Generate Candidates")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 className="modal-title">{tr("კანდიდატების იმპორტი ფაილიდან", "Import Candidates Table")}</h3>
              <button type="button" className="btn-ghost" onClick={() => setShowImportModal(false)} style={{ padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleImport}>
              <div className="modal-body">
                {importError && (
                  <div
                    style={{
                      padding: 10,
                      background: "var(--ll-rose-soft)",
                      border: "1px solid var(--ll-rose-border)",
                      borderRadius: "var(--ll-radius-md)",
                      color: "var(--ll-rose-text)",
                      fontSize: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>{importError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">{tr("CSV ან Excel (.xlsx) ფაილი", "CSV or Excel (.xlsx) File")}</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx"
                    className="form-input"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    required
                  />
                  <span style={{ fontSize: 11, color: "var(--ll-text-muted)", marginTop: 4 }}>
                    {tr(
                      "ფაილის სვეტების სათაურები უნდა ემთხვეოდეს მართვადი პარამეტრების იდენტიფიკატორებს. ერთეულები ავტომატურად გადაიყვანება.",
                      "Headers should match controlled parameter keys. Physical units in brackets are automatically converted via Pint."
                    )}
                  </span>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={skipInvalid}
                    onChange={(e) => setSkipInvalid(e.target.checked)}
                  />
                  <span>{tr("არავალიდური სტრიქონების გამოტოვება (Skip invalid rows)", "Skip invalid rows instead of rejecting entire file")}</span>
                </label>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowImportModal(false)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary" disabled={importing || !importFile}>
                  {importing ? tr("იტვირთება...", "Importing...") : tr("იმპორტი", "Import Candidates")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Override Modal */}
      {overrideCandidate && (
        <div className="modal-overlay">
          <div className="modal-dialog" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 className="modal-title">{tr("სტატუსის გადაწერა (Human Override)", "Human Scientific Override")}</h3>
              <button type="button" className="btn-ghost" onClick={() => setOverrideCandidate(null)} style={{ padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveOverride}>
              <div className="modal-body">
                {overrideError && (
                  <div
                    style={{
                      padding: 10,
                      background: "var(--ll-rose-soft)",
                      border: "1px solid var(--ll-rose-border)",
                      borderRadius: "var(--ll-radius-md)",
                      color: "var(--ll-rose-text)",
                      fontSize: 12,
                    }}
                  >
                    {overrideError}
                  </div>
                )}

                <div style={{ fontSize: 12, color: "var(--ll-text-secondary)" }}>
                  Candidate #{overrideCandidate.idx} • Hash: <code style={{ fontFamily: "var(--ll-font-mono)", fontSize: 11 }}>{overrideCandidate.values_hash.slice(0, 10)}...</code>
                </div>

                <div className="form-group">
                  <label className="form-label">{tr("ახალი სტატუსი", "Override Status")}</label>
                  <select
                    className="form-select"
                    value={overrideStatus}
                    onChange={(e) => setOverrideStatus(e.target.value as any)}
                  >
                    <option value="recommended">{tr("რეკომენდებული (Recommended)", "Recommended")}</option>
                    <option value="open">{tr("ღია შემოწმებადი (Open)", "Open (Viable)")}</option>
                    <option value="deprioritised">{tr("დეპრიორიტიზებული (Deprioritised)", "Deprioritised")}</option>
                    <option value="excluded">{tr("გამორიცხული (Excluded)", "Excluded")}</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">{tr("მეცნიერული დასაბუთება (Hard Rule #5)", "Scientific Rationale (Hard Rule #5)")}</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="Provide verifiable reason for manual human override..."
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setOverrideCandidate(null)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary">
                  {tr("შენახვა", "Save Override")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Experiment Modal */}
      {showRecordModal && (
        <RecordExperimentModal
          isOpen={showRecordModal}
          onClose={() => {
            setShowRecordModal(false);
            setRecordCandidate(null);
          }}
          study={study}
          candidate={recordCandidate || undefined}
          parameters={parameters || []}
          outcomes={outcomes || []}
          existingEvidenceCount={evidenceList?.filter((e) => e.status === "valid" && !e.retracted_at).length || 0}
          onEvidenceRecorded={() => {
            refreshCandidates();
            refreshEvidence();
            onCandidatesChanged?.();
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
            refreshCandidates();
            refreshEvidence();
            onCandidatesChanged?.();
          }}
        />
      )}
    </div>
  );
}
