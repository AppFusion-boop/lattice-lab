import { useState } from "react";
import { Database, RefreshCw, ChevronLeft, ChevronRight, FileArchive, Download } from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import { useApi } from "../api/hooks";
import type { AuditLog, Backup, Study } from "../api/types";
import { tr } from "../../i18n";

interface AuditTabProps {
  study: Study;
}

const ENTITY_OPTIONS = [
  { value: "", label: "ყველა ობიექტი (All Entities)" },
  { value: "study", label: "კვლევა (Study)" },
  { value: "parameter", label: "პარამეტრი (Parameter)" },
  { value: "outcome", label: "შედეგი (Outcome)" },
  { value: "constraint", label: "შეზღუდვა (Constraint)" },
  { value: "source", label: "წყარო (Source)" },
  { value: "evidence", label: "მტკიცებულება (Evidence)" },
  { value: "candidate_set", label: "კანდიდატთა სიმრავლე (Candidate Set)" },
  { value: "override", label: "გადაწერა (Override)" },
  { value: "run_sheet", label: "სამუშაო ფურცელი (Run Sheet)" },
  { value: "screening_run", label: "სკრინინგი (Screening Run)" },
  { value: "database", label: "მონაცემთა ბაზა (Database)" },
];

const ACTION_OPTIONS = [
  { value: "", label: "ყველა მოქმედება (All Actions)" },
  { value: "create", label: "შექმნა (Create)" },
  { value: "update", label: "განახლება (Update)" },
  { value: "delete", label: "წაშლა (Delete)" },
  { value: "retract", label: "გაწვევა (Retract)" },
  { value: "supersede", label: "ჩანაცვლება (Supersede)" },
  { value: "generate", label: "გენერირება (Generate)" },
  { value: "import", label: "იმპორტი (Import)" },
  { value: "override", label: "გადაწერა (Override)" },
  { value: "backup", label: "სარეზერვო ასლი (Backup)" },
];

export function AuditTab({ study }: AuditTabProps) {
  const [entityFilter, setEntityFilter] = useState<string>("");
  const [actionFilter, setActionFilter] = useState<string>("");
  const [offset, setOffset] = useState<number>(0);
  const limit = 50;

  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState<boolean>(false);

  const queryParams = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  if (entityFilter) queryParams.set("entity", entityFilter);
  if (actionFilter) queryParams.set("action", actionFilter);

  const {
    data: auditData,
    loading,
    error,
    refresh,
  } = useApi<AuditLog>(
    `audit-${study.id}-${entityFilter}-${actionFilter}-${offset}`,
    () => apiGet<AuditLog>(`/studies/${study.id}/audit?${queryParams.toString()}`)
  );

  const handleCreateBackup = async () => {
    try {
      setBackingUp(true);
      setBackupMessage(null);
      const res = await apiPost<Backup>(`/studies/${study.id}/backup`, {});
      const sizeKb = (res.size_bytes / 1024).toFixed(1);
      setBackupMessage(
        tr(
          `სარეზერვო ასლი შეიქმნა: ${res.filename} (${sizeKb} KB)`,
          `Backup created successfully: ${res.filename} (${sizeKb} KB)`
        )
      );
      refresh();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setBackupMessage(tr(`შეცდომა სარეზერვო ასლის შექმნისას: ${e.message}`, `Backup failed: ${e.message}`));
    } finally {
      setBackingUp(false);
    }
  };

  const handleExportZip = () => {
    const downloadUrl = `/api/v1/studies/${study.id}/export.zip`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.setAttribute("download", `study_${study.id}_export.zip`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportLat = () => {
    const slug = (study.name || "study").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[-\s]+/g, "_");
    const link = document.createElement("a");
    link.href = `/api/v1/studies/${study.id}/export.lat`;
    link.setAttribute("download", `${slug || "study"}.lat`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const total = auditData?.total ?? 0;
  const items = auditData?.items ?? [];
  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="study-card">
      <div className="study-card-header" style={{ alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h3 className="study-card-title">
            <Database size={18} color="var(--ll-emerald)" />
            <span>{tr("აუდიტის ჟურნალი & სარეზერვო ასლი", "Audit Log & Archival Backups")}</span>
          </h3>
          <p className="study-card-sub">
            {tr(
              "შეუცვლელი, მხოლოდ მიწერადი ჟურნალი. ყველა ცვლილება დადასტურებულია SQLite ტრიგერებით (§5, §6).",
              "Append-only, immutable audit trail enforced by database triggers (§5, §6)."
            )}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            onClick={handleCreateBackup}
            disabled={backingUp}
            title={tr("სრული SQLite ბაზის წერტილოვანი სარეზერვო ასლი", "Create point-in-time SQLite backup file")}
          >
            <Database size={13} />
            <span>{backingUp ? tr("იქმნება...", "Creating...") : tr("SQLite სარეზერვო ასლი", "Create Backup")}</span>
          </button>
          <button
            className="btn-secondary"
            onClick={handleExportZip}
            title={tr("კვლევის რეპორტების ZIP არქივის ჩამოტვირთვა", "Export complete study archive as standalone ZIP")}
          >
            <FileArchive size={13} />
            <span>{tr("რეპორტების ZIP", "Reports ZIP")}</span>
          </button>
          <button
            className="btn-primary"
            onClick={handleExportLat}
            title={tr("სრული კვლევის პორტაბელური პაკეტის ექსპორტი (.lat ფაილი 3D სცენებით, DoE-თა და ემპირიით)", "Export complete portable study package (.lat archive)")}
          >
            <Download size={13} />
            <span>{tr("პაკეტის ექსპორტი (.lat)", "Export Package (.lat)")}</span>
          </button>
        </div>
      </div>

      {backupMessage && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 16,
            borderRadius: "var(--ll-radius-md)",
            fontSize: 12.5,
            background: backupMessage.includes("შეცდომა") || backupMessage.includes("failed") ? "var(--ll-rose-soft)" : "var(--ll-emerald-soft)",
            color: backupMessage.includes("შეცდომა") || backupMessage.includes("failed") ? "var(--ll-rose-text)" : "var(--ll-emerald-text)",
            border: `1px solid ${backupMessage.includes("შეცდომა") || backupMessage.includes("failed") ? "var(--ll-rose-border)" : "var(--ll-emerald-border)"}`,
          }}
        >
          {backupMessage}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <select
          className="form-select"
          style={{ maxWidth: 220, fontSize: 12 }}
          value={entityFilter}
          onChange={(e) => {
            setEntityFilter(e.target.value);
            setOffset(0);
          }}
        >
          {ENTITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          className="form-select"
          style={{ maxWidth: 200, fontSize: 12 }}
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setOffset(0);
          }}
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <button
          className="btn-ghost"
          onClick={() => refresh()}
          title={tr("განახლება", "Refresh")}
          style={{ padding: "5px 8px" }}
        >
          <RefreshCw size={13} />
        </button>

        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--ll-text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {tr(`სულ: ${total} ჩანაწერი`, `Total: ${total} entries`)}
        </div>
      </div>

      {/* Audit Log Table */}
      {loading && items.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--ll-text-muted)" }}>
          {tr("აუდიტის მონაცემები იტვირთება...", "Loading audit log...")}
        </div>
      ) : error ? (
        <div style={{ padding: 16, color: "var(--ll-rose-text)", background: "var(--ll-rose-soft)", border: "1px solid var(--ll-rose-border)", borderRadius: "var(--ll-radius-md)" }}>
          {error.message}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--ll-text-muted)" }}>
          {tr("ჩანაწერები არ მოიძებნა", "No audit entries match filter.")}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="study-table" style={{ width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th style={{ width: 170 }}>{tr("დრო (Timestamp)", "Timestamp")}</th>
                <th style={{ width: 100 }}>{tr("მომხმარებელი", "Actor")}</th>
                <th style={{ width: 100 }}>{tr("მოქმედება", "Action")}</th>
                <th style={{ width: 120 }}>{tr("ობიექტი", "Entity")}</th>
                <th style={{ width: 140 }}>{tr("ობიექტის ID", "Entity ID")}</th>
                <th>{tr("დეტალები", "Details")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => {
                let badgeClass = "badge-status-open";
                if (entry.action === "create" || entry.action === "backup") {
                  badgeClass = "badge-status-recommended";
                } else if (entry.action === "delete" || entry.action === "retract") {
                  badgeClass = "badge-status-excluded";
                } else if (entry.action === "update" || entry.action === "supersede") {
                  badgeClass = "badge-status-deprioritised";
                }

                return (
                  <tr key={entry.id}>
                    <td style={{ color: "var(--ll-text-muted)" }}>{entry.id}</td>
                    <td style={{ whiteSpace: "nowrap", fontFamily: "var(--ll-font-mono)", fontSize: 11.5 }}>
                      {new Date(entry.at).toLocaleString()}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: "var(--ll-text-secondary)" }}>{entry.actor}</span>
                    </td>
                    <td>
                      <span className={`badge ${badgeClass}`}>{entry.action}</span>
                    </td>
                    <td>
                      <code style={{ fontSize: 11.5, background: "var(--ll-surface-subtle)", border: "1px solid var(--ll-border)", padding: "2px 6px", borderRadius: 4 }}>
                        {entry.entity}
                      </code>
                    </td>
                    <td style={{ fontFamily: "var(--ll-font-mono)", fontSize: 11, color: "var(--ll-text-muted)" }}>
                      {entry.entity_id || "—"}
                    </td>
                    <td>
                      <div
                        style={{
                          maxHeight: 60,
                          overflowY: "auto",
                          fontFamily: "var(--ll-font-mono)",
                          fontSize: 11,
                          color: "var(--ll-text-secondary)",
                          background: "var(--ll-surface-subtle)",
                          padding: "4px 8px",
                          borderRadius: 4,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}
                      >
                        {JSON.stringify(entry.details, null, 2)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 16,
              paddingTop: 12,
              borderTop: "1px solid var(--ll-border)",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--ll-text-muted)" }}>
              {tr(
                `გვერდი ${currentPage} / ${totalPages} (${total} ჩანაწერიდან)`,
                `Page ${currentPage} of ${totalPages} (from ${total} total)`
              )}
            </span>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                style={{ padding: "4px 10px", fontSize: 12 }}
              >
                <ChevronLeft size={13} />
                <span>{tr("წინა", "Previous")}</span>
              </button>
              <button
                className="btn-secondary"
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + limit)}
                style={{ padding: "4px 10px", fontSize: 12 }}
              >
                <span>{tr("შემდეგი", "Next")}</span>
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
