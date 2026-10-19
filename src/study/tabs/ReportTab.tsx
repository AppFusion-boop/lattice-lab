import { useState } from "react";
import { Download, Copy, Printer, Check, FileText, RefreshCw } from "lucide-react";
import { apiGet } from "../api/client";
import { useApi } from "../api/hooks";
import type { Study } from "../api/types";
import { tr } from "../../i18n";

interface ReportTabProps {
  study: Study;
}

interface ReportData {
  study_id: string;
  generated_at: string;
  markdown: string;
}

export function ReportTab({ study }: ReportTabProps) {
  const [copied, setCopied] = useState(false);

  const {
    data: report,
    loading,
    error,
    refresh,
  } = useApi<ReportData>(`report-${study.id}`, () =>
    apiGet<ReportData>(`/studies/${study.id}/report`)
  );

  const handleCopy = async () => {
    if (!report?.markdown) return;
    await navigator.clipboard.writeText(report.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        className="study-card no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FileText size={20} color="#0284c7" />
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>
              {tr("მეცნიერული ანგარიში (Defensible Scientific Report)", "Defensible Scientific Report")}
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
              {tr(
                "სრული აუდიტორული ანგარიში სტატისტიკური გარანტიებით, ბუკინგემის Π ჯგუფებით და მეთოდოლოგიური შეზღუდვებით.",
                "Reproducible audit report with statistical guarantees, Buckingham Π groups, and methodological limitations."
              )}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn-secondary" onClick={refresh} title="Regenerate Report">
            <RefreshCw size={13} />
            <span>{tr("განახლება", "Refresh")}</span>
          </button>

          <button className="btn-secondary" onClick={handleCopy} disabled={!report}>
            {copied ? <Check size={13} color="#16a34a" /> : <Copy size={13} />}
            <span>{copied ? tr("დაკოპირდა!", "Copied!") : tr("Markdown კოპირება", "Copy Markdown")}</span>
          </button>

          <a
            href={`/api/v1/studies/${study.id}/report.md`}
            download={`study_report_${study.id}.md`}
            className="btn-secondary"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Download size={13} />
            <span>{tr(".md ჩამოტვირთვა", "Download .md")}</span>
          </a>

          <button className="btn-primary" onClick={() => window.print()}>
            <Printer size={13} />
            <span>{tr("ბეჭდვა / PDF", "Print / Save PDF")}</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="study-card" style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
          Generating scientific report...
        </div>
      )}

      {error && (
        <div className="study-card" style={{ padding: 20, color: "#b91c1c" }}>
          {error.message}
        </div>
      )}

      {report && (
        <div
          className="study-card"
          style={{
            padding: "28px 32px",
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            lineHeight: 1.65,
            whiteSpace: "pre-wrap",
            background: "#ffffff",
            color: "#0f172a",
            overflowX: "auto",
          }}
        >
          {report.markdown}
        </div>
      )}
    </div>
  );
}

