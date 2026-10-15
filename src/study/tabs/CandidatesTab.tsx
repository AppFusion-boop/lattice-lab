import { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { apiGet, apiPost, ApiError } from "../api/client";
import { useApi } from "../api/hooks";
import type {
  Study,
  CandidateSet,
  Candidate,
  PaginatedCandidates,
  Parameter,
  OverrideCreate,
} from "../api/types";
import { tr } from "../../i18n";
import { useRoute } from "../../app/router";

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

  const { data: parameters } = useApi<Parameter[]>(`parameters-${study.id}`, () =>
    apiGet<Parameter[]>(`/studies/${study.id}/parameters`)
  );

  const controlledParams = parameters?.filter((p) => p.role === "controlled") || [];

  const limit = 100;
  const offset = page * limit;

  const {
    data: candidatesData,
    loading: loadingCandidates,
    refresh: refreshCandidates,
  } = useApi<PaginatedCandidates>(
    `candidates-${study.id}-${activeSet?.id}-${statusFilter}-${sortBy}-${offset}`,
    () => {
      let query = `/studies/${study.id}/candidates?offset=${offset}&limit=${limit}`;
      if (statusFilter) query += `&status=${statusFilter}`;
      if (sortBy) query += `&sort=${sortBy}`;
      return apiGet<PaginatedCandidates>(query);
    }
  );

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenError(null);
    setGenerating(true);

    const settings: Record<string, unknown> = {};
    if (genMethod === "lhs" || genMethod === "sobol") {
      settings.n = parseInt(genN, 10) || 1000;
      if (genSeed) settings.seed = parseInt(genSeed, 10);
    }

    try {
      await apiPost(`/studies/${study.id}/candidate-sets`, {
        method: genMethod,
        settings,
      });
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

  return (
    <div>
      {/* Top Card: Active Candidate Set Info & Generation Controls */}
      <div className="study-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h4 className="study-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Database size={16} color="var(--green)" />
              <span>{tr("აქტიური კანდიდატების სიმრავლე", "Active Candidate Set")}</span>
            </h4>
            <div style={{ marginTop: 4, fontSize: 12, color: "#586b62" }}>
              {activeSet ? (
                <>
                  <span>
                    {tr("მეთოდი:", "Method:")} <strong style={{ textTransform: "uppercase" }}>{activeSet.method}</strong>
                  </span>{" "}
                  •{" "}
                  <span>
                    {tr("რაოდენობა:", "Count:")} <strong>{activeSet.count.toLocaleString()}</strong>
                  </span>{" "}
                  •{" "}
                  <span>
                    {tr("შექმნილია:", "Created:")} {new Date(activeSet.created_at).toLocaleString()}
                  </span>
                </>
              ) : (
                tr("კანდიდატები ჯერ არ არის გენერირებული.", "No candidate set currently active.")
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
              <Upload size={13} />
              <span>{tr("იმპორტი (CSV/XLSX)", "Import Table")}</span>
            </button>
            <button className="btn-primary" onClick={() => setShowGenerateModal(true)}>
              <Sparkles size={13} />
              <span>{tr("გენერირება (DoE)", "Generate Candidates")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Candidates List with Filters */}
      <div className="study-card">
        <div className="study-card-header" style={{ flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <Filter size={13} color="#64748b" />
              <span>{tr("ფილტრი სტატუსით:", "Status Filter:")}</span>
              <select
                className="form-select"
                style={{ padding: "4px 8px", fontSize: 11 }}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">{tr("ყველა სტატუსი", "All Statuses")}</option>
                <option value="open">{tr("ღია (Open)", "Open")}</option>
                <option value="excluded">{tr("გამორიცხული (Excluded)", "Excluded")}</option>
                <option value="recommended">{tr("რეკომენდებული (Recommended)", "Recommended")}</option>
                <option value="deprioritised">{tr("დეპრიორიტეტიზებული", "Deprioritised")}</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span>{tr("დალაგება:", "Sort:")}</span>
              <select
                className="form-select"
                style={{ padding: "4px 8px", fontSize: 11 }}
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">{tr("ინდექსით", "By Index")}</option>
                <option value="status">{tr("სტატუსით", "By Status")}</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              className="btn-secondary"
              onClick={handleExportCsv}
              disabled={!candidatesData || candidatesData.items.length === 0}
              style={{ padding: "4px 10px", fontSize: 11 }}
            >
              <Download size={12} />
              <span>{tr("ექსპორტი CSV", "Export Page CSV")}</span>
            </button>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                <button
                  className="btn-secondary"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  style={{ padding: "4px 6px" }}
                >
                  <ChevronLeft size={13} />
                </button>
                <span style={{ padding: "0 6px", fontFamily: "var(--mono)" }}>
                  {page + 1} / {totalPages}
                </span>
                <button
                  className="btn-secondary"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  style={{ padding: "4px 6px" }}
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>
        </div>

        {loadingCandidates ? (
          <div style={{ padding: 32, textAlign: "center", color: "#84938b" }}>{tr("იტვირთება...", "Loading candidates...")}</div>
        ) : !candidatesData || candidatesData.items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#84938b" }}>
            {tr("მითითებული ფილტრით კანდიდატები ვერ მოიძებნა.", "No candidates found matching the selected filter.")}
          </div>
        ) : (
          <table className="study-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#IDX</th>
                {controlledParams.map((p) => (
                  <th key={p.key}>
                    {p.label} {p.unit ? `(${p.unit})` : ""}
                  </th>
                ))}
                <th style={{ width: 120 }}>{tr("სტატუსი", "Decision")}</th>
                <th>{tr("მიზეზი / ფილტრი", "Filter / Reason")}</th>
                <th style={{ width: 60, textAlign: "right" }}>{tr("Override", "Override")}</th>
              </tr>
            </thead>
            <tbody>
              {candidatesData.items.map((cand) => {
                const dec = cand.decision;
                const status = dec?.status || "open";

                return (
                  <tr key={cand.id}>
                    <td style={{ fontFamily: "var(--mono)", color: "#84938b", fontSize: 11 }}>
                      {cand.idx}
                    </td>

                    {controlledParams.map((p) => (
                      <td key={p.key} style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                        {cand.values[p.key] !== undefined ? String(cand.values[p.key]) : "—"}
                      </td>
                    ))}

                    <td>
                      <span className={`badge badge-status-${status}`}>{status}</span>
                    </td>

                    <td style={{ fontSize: 11, color: status === "excluded" ? "#991b1b" : "#475569" }}>
                      {dec ? (
                        <>
                          <strong>[{dec.filter}]</strong> {dec.reason}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setOverrideCandidate(cand);
                          setOverrideStatus(status === "excluded" ? "recommended" : "excluded");
                          setOverrideReason("");
                          setOverrideError(null);
                        }}
                        style={{ padding: "2px 8px", fontSize: 10 }}
                        title="Manual Human Override"
                      >
                        <Pin size={11} />
                        <span>Pin</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Generate Candidates Modal */}
      {showGenerateModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 className="modal-title">{tr("კანდიდატების გენერირება (Design of Experiments)", "Generate Candidates (DoE)")}</h3>
              <button onClick={() => setShowGenerateModal(false)} style={{ color: "#64748b" }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleGenerate}>
              <div className="modal-body">
                {genError && (
                  <div
                    style={{
                      padding: 10,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 6,
                      color: "#991b1b",
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
                    <option value="grid">Grid (სრული ფაქტორული ბადე დონეებით)</option>
                    <option value="lhs">Latin Hypercube Sampling (LHS კვაზი-რანდომული სტრატიფიკაცია)</option>
                    <option value="sobol">Sobol Sequence (სკრემბლირებული დაბალი დისკრეპანციის თანმიმდევრობა)</option>
                  </select>
                </div>

                {genMethod === "grid" ? (
                  <div style={{ padding: 12, background: "#f8faf8", borderRadius: 6, fontSize: 12, color: "#475569" }}>
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
                  {generating ? tr("გენერირდება...", "Generating...") : tr("გენერირება", "Generate")}
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
              <button onClick={() => setShowImportModal(false)} style={{ color: "#64748b" }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleImport}>
              <div className="modal-body">
                {importError && (
                  <div
                    style={{
                      padding: 10,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 6,
                      color: "#991b1b",
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
                  <span style={{ fontSize: 11, color: "#84938b", marginTop: 4 }}>
                    {tr(
                      "ფაილის სვეტების სათაურები უნდა ემთხვეოდეს მართვადი პარამეტრების იდენტიფიკატორებს (მაგ. droplet [um], flow [L/min]).",
                      "Headers should match controlled parameter keys (e.g. droplet [um], flow [L/min]). Units in brackets are automatically converted."
                    )}
                  </span>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={skipInvalid}
                    onChange={(e) => setSkipInvalid(e.target.checked)}
                  />
                  <span>{tr("არავალიდური სტრიქონების გამოტოვება (Skip invalid rows)", "Skip invalid rows instead of rejecting file")}</span>
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
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 className="modal-title">{tr("ადამიანური გადაწყვეტილების მინიჭება (Override)", "Manual Expert Override")}</h3>
              <button onClick={() => setOverrideCandidate(null)} style={{ color: "#64748b" }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveOverride}>
              <div className="modal-body">
                {overrideError && (
                  <div
                    style={{
                      padding: 10,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 6,
                      color: "#991b1b",
                      fontSize: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>{overrideError}</span>
                  </div>
                )}

                <div style={{ padding: 10, background: "#f8faf8", borderRadius: 6, fontSize: 12 }}>
                  <div style={{ color: "#64748b", marginBottom: 4 }}>
                    {tr("კანდიდატი #", "Candidate #")} {overrideCandidate.idx}:
                  </div>
                  <div style={{ fontFamily: "var(--mono)", color: "#1a2c26" }}>
                    {JSON.stringify(overrideCandidate.values)}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">{tr("ახალი სტატუსი", "Override Status")}</label>
                  <select
                    className="form-select"
                    value={overrideStatus}
                    onChange={(e) => setOverrideStatus(e.target.value as any)}
                  >
                    <option value="recommended">{tr("რეკომენდებული (Recommended)", "Recommended")}</option>
                    <option value="open">{tr("ღია (Open)", "Open")}</option>
                    <option value="excluded">{tr("გამორიცხული (Excluded)", "Excluded")}</option>
                    <option value="deprioritised">{tr("დეპრიორიტეტიზებული (Deprioritised)", "Deprioritised")}</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">{tr("დასაბუთება (სავალდებულო, მინ. 3 სიმბოლო)", "Reason (Mandatory, min 3 chars)")}</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="e.g. Critical boundary configuration approved by principal researcher"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    required
                    minLength={3}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setOverrideCandidate(null)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary" disabled={overrideReason.trim().length < 3}>
                  {tr("დამახსოვრება", "Save Override")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
