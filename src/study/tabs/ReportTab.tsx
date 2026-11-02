import { useState } from "react";
import { Download, Copy, Printer, Check, FileText, RefreshCw, BookOpen } from "lucide-react";
import { apiGet } from "../api/client";
import { useApi } from "../api/hooks";
import type { Study } from "../api/types";
import { tr } from "../../i18n";
import { PaperExportModal } from "../components/PaperExportModal";

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
  const [showPaperModal, setShowPaperModal] = useState(false);

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
      <div className="study-card no-print" style={{ marginBottom: 0 }}>
        <div className="study-card-header" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FileText size={20} color="var(--ll-emerald)" />
            <div>
              <h3 className="study-card-title">
                <span>{tr("მეცნიერული ანგარიში (Defensible Scientific Report)", "Defensible Scientific Report")}</span>
              </h3>
              <p className="study-card-sub">
                {tr(
                  "სრული აუდიტორული ანგარიში სტატისტიკური გარანტიებით, ბუკინგემის Π ჯგუფებით და მეთოდოლოგიური შეზღუდვებით.",
                  "Reproducible audit report with statistical guarantees, Buckingham Π groups, and methodological limitations."
                )}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn-primary"
              onClick={() => setShowPaperModal(true)}
              style={{
                background: "var(--ll-blue)",
                borderColor: "var(--ll-blue)",
              }}
              title={tr("სრული სამეცნიერო სტატიის გენერირება (LaTeX, PDF, BibTeX)", "Export full scientific research paper")}
            >
              <BookOpen size={13} />
              <span>{tr("სამეცნიერო სტატია (Paper)", "Research Paper")}</span>
            </button>

            <button className="btn-secondary" onClick={refresh} title="Regenerate Report">
              <RefreshCw size={13} />
              <span>{tr("განახლება", "Refresh")}</span>
            </button>

            <button className="btn-secondary" onClick={handleCopy} disabled={!report}>
              {copied ? <Check size={13} color="var(--ll-emerald)" /> : <Copy size={13} />}
              <span>{copied ? tr("დაკოპირდა!", "Copied!") : tr("Markdown კოპირება", "Copy Markdown")}</span>
            </button>

            <a
              href={`/api/v1/studies/${study.id}/report.md`}
              download={`study_report_${study.id}.md`}
              className="btn-secondary"
              style={{ textDecoration: "none" }}
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
      </div>

      {loading && (
        <div className="study-card" style={{ padding: 40, textAlign: "center", color: "var(--ll-text-muted)" }}>
          {tr("მეცნიერული ანგარიში გენერირდება...", "Generating scientific report...")}
        </div>
      )}

      {error && (
        <div className="study-card" style={{ padding: 16, color: "var(--ll-rose-text)", background: "var(--ll-rose-soft)", border: "1px solid var(--ll-rose-border)" }}>
          {error.message}
        </div>
      )}

      {report && (
        <div
          className="study-card"
          style={{
            padding: "32px 36px",
            fontFamily: "var(--ll-font-mono)",
            fontSize: 12.5,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
            background: "var(--ll-surface)",
            color: "var(--ll-text-primary)",
            boxShadow: "var(--ll-shadow-card)",
            border: "1px solid var(--ll-border)",
            borderRadius: "var(--ll-radius-lg)",
            overflowX: "auto",
          }}
        >
          {report.markdown}
        </div>
      )}

      {showPaperModal && (
        <PaperExportModal
          study={study}
          isOpen={showPaperModal}
          onClose={() => setShowPaperModal(false)}
        />
      )}
    </div>
  );
}

