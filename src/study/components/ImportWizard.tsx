import React, { useState } from "react";
import { Upload, CheckCircle2, AlertTriangle, FileSpreadsheet, ArrowRight, ArrowLeft } from "lucide-react";
import type { Parameter, Outcome, Source, ImportPreview, ImportCommitResponse } from "../api/types";

interface ImportWizardProps {
  studyId: string;
  parameters: Parameter[];
  outcomes: Outcome[];
  sources: Source[];
  onComplete: () => void;
  onCancel: () => void;
}

export function ImportWizard({
  studyId,
  parameters,
  outcomes,
  sources,
  onComplete,
  onCancel,
}: ImportWizardProps) {
  const [step, setStep] = useState<"upload" | "map" | "result">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview data
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<"field" | "lab" | "literature" | "simulation" | "expert">("lab");
  const [sourceId, setSourceId] = useState<string>("");
  const [defaultStatus, setDefaultStatus] = useState<"valid" | "failed_run" | "outlier">("valid");
  const [skipInvalid, setSkipInvalid] = useState(true);

  // Result data
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);

  const controlledParams = parameters.filter((p) => p.role === "controlled");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setError(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", selected);
      const res = await fetch(`/api/v1/studies/${studyId}/imports/preview`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.detail?.message || `Preview failed: ${res.statusText}`);
      }

      const data: ImportPreview = await res.json();
      setPreview(data);
      // Initialize mapping with guessed defaults or "ignore"
      const initMap: Record<string, string> = {};
      for (const col of data.columns) {
        initMap[col] = data.guessed_mapping[col] || "ignore";
      }
      setMapping(initMap);
      setStep("map");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    setError(null);
    setLoading(true);

    // Validate that all controlled parameters are mapped
    const mappedTargets = new Set(Object.values(mapping));
    const missingControlled = controlledParams.filter((cp) => !mappedTargets.has(`param:${cp.key}`));
    if (missingControlled.length > 0) {
      setError(`Required controlled parameter(s) not mapped: ${missingControlled.map((p) => p.label).join(", ")}`);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/v1/studies/${studyId}/imports/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_token: preview.import_token,
          mapping,
          kind,
          source_id: sourceId || null,
          default_status: defaultStatus,
          skip_invalid: skipInvalid,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.detail?.message || `Commit failed: ${res.statusText}`);
      }

      const result: ImportCommitResponse = await res.json();
      setCommitResult(result);
      setStep("result");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="study-modal-overlay">
      <div className="study-modal" style={{ maxWidth: 840 }}>
        <div className="study-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileSpreadsheet size={18} color="var(--green, #247861)" />
            <span style={{ fontWeight: 650, fontSize: 15 }}>Tabular Evidence Import Wizard</span>
          </div>
          <button className="study-btn-secondary" onClick={onCancel} disabled={loading}>
            ✕
          </button>
        </div>

        <div className="study-modal-body" style={{ maxHeight: "75vh", overflowY: "auto" }}>
          {error && (
            <div style={{ padding: "10px 14px", background: "#fee2e2", color: "#991b1b", borderRadius: 6, fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}

          {step === "upload" && (
            <div style={{ textAlign: "center", padding: "36px 20px" }}>
              <div
                style={{
                  border: "2px dashed var(--line, #cbd5e1)",
                  borderRadius: 12,
                  padding: 40,
                  background: "#f8fafc",
                  cursor: "pointer",
                }}
                onClick={() => document.getElementById("file-upload-input")?.click()}
              >
                <Upload size={36} color="var(--muted, #64748b)" style={{ margin: "0 auto 12px" }} />
                <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 14 }}>
                  {loading ? "Analyzing file..." : "Click or drag CSV or XLSX file here"}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted, #64748b)" }}>
                  Supports CSV (comma or semicolon, UTF-8/BOM) and Excel (.xlsx) up to 20 MB / 100,000 rows
                </p>
                <input
                  id="file-upload-input"
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          {step === "map" && preview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Provenance & metadata settings */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, background: "#f8fafc", padding: 12, borderRadius: 8 }}>
                <div>
                  <label className="study-form-label">Evidence Kind</label>
                  <select
                    className="study-form-select"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                  >
                    <option value="lab">Lab Experiment</option>
                    <option value="field">Field Test</option>
                    <option value="literature">Literature Data</option>
                    <option value="simulation">External Simulation</option>
                    <option value="expert">Expert Observation</option>
                  </select>
                </div>

                <div>
                  <label className="study-form-label">Provenance Source</label>
                  <select
                    className="study-form-select"
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                  >
                    <option value="">(None / Direct Entry)</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.citation || s.id} [{s.kind}]
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="study-form-label">Default Run Status</label>
                  <select
                    className="study-form-select"
                    value={defaultStatus}
                    onChange={(e) => setDefaultStatus(e.target.value as any)}
                  >
                    <option value="valid">Valid (clean execution)</option>
                    <option value="failed_run">Failed Run (apparatus failure)</option>
                    <option value="outlier">Outlier</option>
                  </select>
                </div>
              </div>

              {/* Column mapping table */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 650, fontSize: 13 }}>
                    Map File Columns ({preview.total_rows} rows detected in {preview.filename})
                  </span>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={skipInvalid}
                      onChange={(e) => setSkipInvalid(e.target.checked)}
                    />
                    Skip invalid rows and import valid ones
                  </label>
                </div>

                <div style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 6, overflow: "hidden" }}>
                  <table className="study-table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>File Column</th>
                        <th>Parsed Unit</th>
                        <th>Target Attribute</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.columns.map((col) => {
                        const parsedUnit = preview.column_units[col] || "—";
                        const target = mapping[col] || "ignore";
                        return (
                          <tr key={col}>
                            <td style={{ fontWeight: 600 }}>{col}</td>
                            <td>
                              <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--muted, #64748b)" }}>
                                {parsedUnit}
                              </span>
                            </td>
                            <td>
                              <select
                                className="study-form-select"
                                value={target}
                                onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}
                                style={{ padding: "4px 8px", fontSize: 12 }}
                              >
                                <option value="ignore">Do not import (Ignore)</option>

                                <optgroup label="Controlled Parameters (Required)">
                                  {controlledParams.map((p) => (
                                    <option key={p.key} value={`param:${p.key}`}>
                                      ★ {p.label} [{p.unit || "unitless"}]
                                    </option>
                                  ))}
                                </optgroup>

                                {parameters.filter((p) => p.role !== "controlled").length > 0 && (
                                  <optgroup label="Uncertain / Fixed Parameters">
                                    {parameters
                                      .filter((p) => p.role !== "controlled")
                                      .map((p) => (
                                        <option key={p.key} value={`param:${p.key}`}>
                                          {p.label} [{p.unit || "unitless"}] ({p.role})
                                        </option>
                                      ))}
                                  </optgroup>
                                )}

                                <optgroup label="Outcomes">
                                  {outcomes.map((o) => (
                                    <option key={o.key} value={`outcome:${o.key}`}>
                                      Outcome: {o.label} [{o.unit || "unitless"}]
                                    </option>
                                  ))}
                                </optgroup>

                                <optgroup label="Outcome Uncertainties (SD)">
                                  {outcomes.map((o) => (
                                    <option key={o.key} value={`outcome_sd:${o.key}`}>
                                      SD: {o.label} [{o.unit || "unitless"}]
                                    </option>
                                  ))}
                                </optgroup>

                                <optgroup label="Metadata">
                                  <option value="candidate_id">Candidate ID</option>
                                  <option value="replicate">Replicate Number</option>
                                  <option value="status">Status (valid / failed_run / outlier)</option>
                                  <option value="status_reason">Status Reason</option>
                                  <option value="recorded_at">Timestamp / Date</option>
                                  <option value="notes">Notes</option>
                                </optgroup>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sample preview table */}
              <div>
                <span style={{ fontWeight: 650, fontSize: 13, display: "block", marginBottom: 6 }}>
                  Sample Rows Preview (First 5 Rows)
                </span>
                <div style={{ overflowX: "auto", border: "1px solid var(--line, #e2e8f0)", borderRadius: 6 }}>
                  <table className="study-table" style={{ margin: 0, fontSize: 11 }}>
                    <thead>
                      <tr>
                        {preview.columns.map((col) => (
                          <th key={col}>
                            <div>{col}</div>
                            <span style={{ fontSize: 10, color: "var(--green, #247861)", fontWeight: "normal" }}>
                              {mapping[col] || "ignore"}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample_rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {preview.columns.map((_, cIdx) => (
                            <td key={cIdx}>{row[cIdx] !== null && row[cIdx] !== undefined ? String(row[cIdx]) : "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === "result" && commitResult && (
            <div style={{ padding: "20px 0" }}>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <CheckCircle2 size={48} color="var(--green, #247861)" style={{ margin: "0 auto 12px" }} />
                <h3 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 700 }}>Import Complete</h3>
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted, #64748b)" }}>
                  Successfully imported <strong>{commitResult.imported_count}</strong> evidence records.
                  {commitResult.skipped_count > 0 && ` (${commitResult.skipped_count} invalid rows skipped)`}
                </p>
              </div>

              {Boolean(commitResult.errors && commitResult.errors.length > 0) && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#b45309", marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                    <AlertTriangle size={16} /> Skipped Row Warnings ({commitResult.errors?.length})
                  </div>
                  <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #fed7aa", borderRadius: 6, background: "#fffbeb" }}>
                    <table className="study-table" style={{ margin: 0, fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 80 }}>Row #</th>
                          <th>Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(commitResult.errors || []).map((err, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{String(err.row ?? "")}</td>
                            <td style={{ color: "#991b1b" }}>{String(err.error ?? "")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="study-modal-footer">
          {step === "upload" && (
            <button className="study-btn-secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
          )}

          {step === "map" && (
            <>
              <button
                className="study-btn-secondary"
                onClick={() => setStep("upload")}
                disabled={loading}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <ArrowLeft size={14} /> Back
              </button>
              <button
                className="study-btn-primary"
                onClick={handleCommit}
                disabled={loading}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {loading ? "Importing..." : "Commit Import"} <ArrowRight size={14} />
              </button>
            </>
          )}

          {step === "result" && (
            <button className="study-btn-primary" onClick={onComplete}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
