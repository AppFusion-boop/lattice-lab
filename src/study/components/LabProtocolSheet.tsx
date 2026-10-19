import { useState } from "react";
import {
  Printer,
  Download,
  CheckSquare,
  Plus,
  Wrench,
} from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import { useApi } from "../api/hooks";
import type {
  Study,
  RunSheet,
  Parameter,
  Outcome,
} from "../api/types";
import { tr } from "../../i18n";

interface LabProtocolSheetProps {
  study: Study;
  parameters?: Parameter[];
  outcomes?: Outcome[];
}

interface RunSheetWithRows extends Omit<RunSheet, "rows" | "hardware_changeovers" | "saved_changeovers"> {
  rows?: Array<{
    run_order: number;
    run_id: string;
    candidate_id: string;
    replicate: number;
    values: Record<string, unknown>;
    label?: string | null;
    block_id?: number;
    hardware_changeover?: boolean;
  }>;
  hardware_changeovers?: number;
  saved_changeovers?: number;
}

export function LabProtocolSheet({
  study,
  parameters = [],
  outcomes = [],
}: LabProtocolSheetProps) {
  const [replicates, setReplicates] = useState<number>(3);
  const [candidateStatus, setCandidateStatus] = useState<"recommended" | "open">("recommended");
  const [hardToChangeKeys, setHardToChangeKeys] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [checkRangeVerified, setCheckRangeVerified] = useState<boolean>(true);
  const [checkSensorsZeroed, setCheckSensorsZeroed] = useState<boolean>(true);
  const [checkAmbientLogged, setCheckAmbientLogged] = useState<boolean>(true);
  const [checkRandomizedOrder, setCheckRandomizedOrder] = useState<boolean>(true);

  const {
    data: runSheets,
    refresh,
  } = useApi<RunSheetWithRows[]>(`run-sheets-${study.id}`, () =>
    apiGet<RunSheetWithRows[]>(`/studies/${study.id}/run-sheets`)
  );

  const activeRunSheet = runSheets && runSheets.length > 0 ? runSheets[0] : null;
  const rows = activeRunSheet?.rows || [];

  const controlledParams = parameters.filter((p) => p.role === "controlled");
  const uncertainParams = parameters.filter((p) => p.role === "uncertain");

  const toggleHardKey = (key: string) => {
    setHardToChangeKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleGenerateRunSheet = async () => {
    setIsGenerating(true);
    setGenerateError(null);
    try {
      await apiPost(`/studies/${study.id}/run-sheets`, {
        candidate_status: candidateStatus,
        replicates,
        seed: study.rng_seed || 42,
        hard_to_change_keys: hardToChangeKeys,
      });
      refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerateError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Top Action Bar (Hidden on print) */}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "14px 18px",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "#ecfdf5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#059669",
            }}
          >
            <Printer size={18} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
              {tr("ლაბორატორიული ტესტირების პროტოკოლი (Bench Run Sheet)", "Printable Bench Testing Protocol")}
            </h4>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
              {tr(
                "რანდომიზებული ან სპლიტ-პლოტ რიგითობა, ინსტრუმენტული კალიბრაციის ჩეკლისტი და ხარისხის დადასტურება.",
                "Randomized or Split-Plot hardware-grouped execution order, QA checklist, and sign-off."
              )}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{tr("სტატუსი:", "Pool:")}</span>
            <select
              value={candidateStatus}
              onChange={(e) => setCandidateStatus(e.target.value as "recommended" | "open")}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
            >
              <option value="recommended">Recommended (or Open fallback)</option>
              <option value="open">All Open Viable Candidates</option>
            </select>
          </label>

          <label style={{ fontSize: 12, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{tr("გამეორებები (Replicates):", "Replicates:")}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={replicates}
              onChange={(e) => setReplicates(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              style={{ width: 54, padding: "4px 6px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
            />
          </label>

          <button
            onClick={handleGenerateRunSheet}
            disabled={isGenerating}
            className="btn-primary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Plus size={13} />
            <span>
              {isGenerating
                ? tr("გენერირდება...", "Generating...")
                : tr("რანდომიზებული ფურცლის გენერირება", "Generate Run Sheet")}
            </span>
          </button>

          {activeRunSheet && (
            <>
              <a
                href={`/api/v1/run-sheets/${activeRunSheet.id}.csv`}
                download
                className="btn-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                <Download size={13} />
                <span>{tr("CSV ჩამოტვირთვა", "Download CSV")}</span>
              </a>

              <button
                onClick={handlePrint}
                className="btn-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <Printer size={13} />
                <span>{tr("ბეჭდვა (A4 / PDF)", "Print (A4 / PDF)")}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Split-Plot Hardware-Changeover Selector */}
      {controlledParams.length > 0 && (
        <div
          className="no-print"
          style={{
            padding: "10px 16px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Wrench size={14} color="#0284c7" />
            <strong style={{ color: "#1e293b" }}>
              {tr("რთულად შესაცვლელი აპარატურული პარამეტრები (Split-Plot Grouping):", "Hard-to-Change Hardware Factors (Split-Plot Grouping):")}
            </strong>
            {controlledParams.map((p) => {
              const checked = hardToChangeKeys.includes(p.key);
              return (
                <label
                  key={p.key}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: checked ? "#e0f2fe" : "#ffffff",
                    border: `1px solid ${checked ? "#0284c7" : "#cbd5e1"}`,
                    color: checked ? "#0369a1" : "#475569",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleHardKey(p.key)}
                    style={{ margin: 0 }}
                  />
                  <span>{p.label || p.key}</span>
                </label>
              );
            })}
          </div>
          {activeRunSheet && (activeRunSheet.hardware_changeovers ?? 0) > 0 && (
            <span
              style={{
                padding: "3px 10px",
                borderRadius: 999,
                background: "#dcfce7",
                color: "#166534",
                fontWeight: 600,
              }}
            >
              Split-Plot Active: {activeRunSheet.hardware_changeovers} rig setup blocks
              {activeRunSheet.saved_changeovers
                ? ` (${activeRunSheet.saved_changeovers} changeovers saved)`
                : ""}
            </span>
          )}
        </div>
      )}

      {generateError && (
        <div
          className="no-print"
          style={{
            padding: "10px 14px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          {generateError}
        </div>
      )}

      {/* Main Printable Document Section */}
      <div
        id="printable-lab-protocol"
        style={{
          background: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          padding: "36px 40px",
          color: "#0f172a",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          maxWidth: 940,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {/* Document Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: "2px solid #0f172a",
            paddingBottom: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: "#64748b", textTransform: "uppercase" }}>
              LATTICE LAB • PHYSICAL TEST PROTOCOL
            </div>
            <h1 style={{ margin: "4px 0 6px", fontSize: 20, fontWeight: 800 }}>
              {study.name}
            </h1>
            <div style={{ fontSize: 12, color: "#475569" }}>
              <strong>Study ID:</strong> <code>{study.id}</code> • <strong>Domain:</strong> {study.domain || "General Science"}
            </div>
          </div>

          <div style={{ textAlign: "right", fontSize: 12, color: "#475569" }}>
            <div>
              <strong>Date:</strong> {new Date().toLocaleDateString()}
            </div>
            <div>
              <strong>RNG Seed:</strong> {activeRunSheet?.seed ?? study.rng_seed ?? 42}
            </div>
            {activeRunSheet && (
              <div>
                <strong>Sheet ID:</strong> <code>{activeRunSheet.id}</code> ({activeRunSheet.count} runs)
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Pre-Test QA Checklist */}
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            padding: "12px 16px",
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <CheckSquare size={14} color="#0284c7" />
            <span>{tr("ტესტირებისწინა ხარისხისა და კალიბრაციის ჩეკლისტი (Pre-Run QA Checklist)", "Pre-Run Calibration & QA Checklist")}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, color: "#334155" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checkRangeVerified}
                onChange={(e) => setCheckRangeVerified(e.target.checked)}
              />
              <span>
                Verify controlled parameter actuators ({controlledParams.map((p) => p.key).join(", ") || "all"})
              </span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checkSensorsZeroed}
                onChange={(e) => setCheckSensorsZeroed(e.target.checked)}
              />
              <span>
                Zero & tare outcome instruments ({outcomes.map((o) => `${o.key} [${o.unit || "-"}]`).join(", ") || "all"})
              </span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checkAmbientLogged}
                onChange={(e) => setCheckAmbientLogged(e.target.checked)}
              />
              <span>
                Record ambient / uncertain conditions ({uncertainParams.map((p) => p.key).join(", ") || "baseline"})
              </span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checkRandomizedOrder}
                onChange={(e) => setCheckRandomizedOrder(e.target.checked)}
              />
              <span>
                Execute runs strictly in randomized sequence (seed #{activeRunSheet?.seed ?? study.rng_seed ?? 42})
              </span>
            </label>
          </div>
        </div>

        {/* Dynamic Uncertain / Ambient Conditions Log */}
        {uncertainParams.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(3, uncertainParams.length)}, 1fr)`,
              gap: 12,
              marginBottom: 20,
              fontSize: 11,
            }}
          >
            {uncertainParams.map((up) => (
              <div key={up.id} style={{ padding: "8px 12px", border: "1px dashed #cbd5e1", borderRadius: 4 }}>
                <span style={{ color: "#64748b" }}>{up.label || up.key} Measured:</span>
                <div style={{ height: 16, borderBottom: "1px solid #94a3b8", marginTop: 4 }}>
                  ______ {up.unit || ""}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Physical Run Order Table */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ fontSize: 13, color: "#0f172a" }}>
              {tr("რანდომიზებული საგამოცდო მატრიცა (Randomized Test Matrix)", "Randomized Physical Test Matrix")}
            </strong>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {hardToChangeKeys.length > 0
                ? `Split-Plot randomized by (${hardToChangeKeys.join(", ")})`
                : "Fisher–Yates shuffled to prevent systematic temporal drift"}
            </span>
          </div>

          {rows.length === 0 ? (
            <div
              style={{
                padding: "28px 16px",
                textAlign: "center",
                background: "#f8fafc",
                border: "1px dashed #cbd5e1",
                borderRadius: 6,
                color: "#64748b",
                fontSize: 12,
              }}
            >
              No run sheet generated yet for this study. Click <strong>"Generate Run Sheet"</strong> above after running screening to populate real candidate rows.
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 11,
                textAlign: "left",
              }}
            >
              <thead>
                <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
                  <th style={{ padding: "6px 8px", width: 58 }}>Run #</th>
                  <th style={{ padding: "6px 8px" }}>Candidate</th>
                  <th style={{ padding: "6px 8px", width: 42 }}>Rep</th>
                  {controlledParams.map((p) => (
                    <th key={p.id} style={{ padding: "6px 8px" }}>
                      {p.label || p.key} {p.unit ? `[${p.unit}]` : ""}
                    </th>
                  ))}
                  {outcomes.map((o) => (
                    <th key={o.id} style={{ padding: "6px 8px", width: 95 }}>
                      {o.label || o.key} {o.unit ? `[${o.unit}]` : ""}
                    </th>
                  ))}
                  <th style={{ padding: "6px 8px", width: 75 }}>Initials</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.run_id}
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      borderTop: row.hardware_changeover ? "2px solid #0284c7" : undefined,
                      background: row.hardware_changeover ? "#f0f9ff" : undefined,
                      height: 28,
                    }}
                  >
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>
                      {row.run_id}
                      {row.hardware_changeover && (
                        <span
                          title="Hardware changeover / block start"
                          style={{
                            marginLeft: 4,
                            fontSize: 9,
                            padding: "1px 4px",
                            background: "#0284c7",
                            color: "#fff",
                            borderRadius: 3,
                          }}
                        >
                          SETUP
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <code>{row.label || row.candidate_id.slice(0, 10)}</code>
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.replicate}</td>
                    {controlledParams.map((p) => (
                      <td key={p.id} style={{ padding: "6px 8px", fontFamily: "var(--mono)" }}>
                        {row.values?.[p.key] !== undefined ? String(row.values[p.key]) : "—"}
                      </td>
                    ))}
                    {outcomes.map((o) => (
                      <td key={o.id} style={{ padding: "6px 8px", borderRight: "1px solid #e2e8f0" }}>
                        <div style={{ width: "100%", height: 16, borderBottom: "1px dashed #cbd5e1" }} />
                      </td>
                    ))}
                    <td style={{ padding: "6px 8px" }}>
                      <div style={{ width: "100%", height: 16, borderBottom: "1px dashed #cbd5e1" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Quality Assurance & Sign-off Block */}
        <div
          style={{
            borderTop: "2px solid #0f172a",
            paddingTop: 16,
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 20,
            fontSize: 11,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: "#334155", marginBottom: 20 }}>
              {tr("ტესტის შემსრულებელი (Operator):", "Tested By (Operator):")}
            </div>
            <div style={{ borderBottom: "1px solid #94a3b8", height: 16 }} />
            <div style={{ marginTop: 4, color: "#64748b", fontSize: 10 }}>Name & Signature</div>
          </div>

          <div>
            <div style={{ fontWeight: 700, color: "#334155", marginBottom: 20 }}>
              {tr("ხარისხის ინჟინერი (QA Review):", "Reviewed By (QA / Lead):")}
            </div>
            <div style={{ borderBottom: "1px solid #94a3b8", height: 16 }} />
            <div style={{ marginTop: 4, color: "#64748b", fontSize: 10 }}>Name & Signature</div>
          </div>

          <div>
            <div style={{ fontWeight: 700, color: "#334155", marginBottom: 20 }}>
              {tr("თარიღი & დრო (Completion Date):", "Completion Date:")}
            </div>
            <div style={{ borderBottom: "1px solid #94a3b8", height: 16 }} />
            <div style={{ marginTop: 4, color: "#64748b", fontSize: 10 }}>YYYY-MM-DD HH:MM</div>
          </div>
        </div>
      </div>
    </div>
  );
}
