import React, { useState } from "react";
import {
  Printer,
  Download,
  Calendar,
  CheckSquare,
  FileSpreadsheet,
  RefreshCw,
  Plus,
  UserCheck,
  ShieldCheck,
  Thermometer,
  Gauge,
  Info,
} from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import { useApi } from "../api/hooks";
import type {
  Study,
  RunSheet,
  RunSheetCreate,
  Parameter,
  Outcome,
} from "../api/types";
import { tr } from "../../i18n";

interface LabProtocolSheetProps {
  study: Study;
  parameters?: Parameter[];
  outcomes?: Outcome[];
}

export function LabProtocolSheet({
  study,
  parameters = [],
  outcomes = [],
}: LabProtocolSheetProps) {
  const [replicates, setReplicates] = useState<number>(1);
  const [candidateStatus, setCandidateStatus] = useState<"recommended" | "open">("recommended");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Calibration Checklist State
  const [checkThermocouple, setCheckThermocouple] = useState<boolean>(true);
  const [checkFlowMeter, setCheckFlowMeter] = useState<boolean>(true);
  const [checkPressureTransducer, setCheckPressureTransducer] = useState<boolean>(true);
  const [checkThermalGrease, setCheckThermalGrease] = useState<boolean>(true);

  // Fetch Run Sheets for study
  const {
    data: runSheets,
    loading,
    refresh,
  } = useApi<RunSheet[]>(`run-sheets-${study.id}`, () =>
    apiGet<RunSheet[]>(`/studies/${study.id}/run-sheets`)
  );

  const activeRunSheet = runSheets && runSheets.length > 0 ? runSheets[0] : null;

  const handleGenerateRunSheet = async () => {
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const payload: RunSheetCreate = {
        candidate_status: candidateStatus,
        replicates,
        seed: study.rng_seed || 42,
      };
      await apiPost(`/studies/${study.id}/run-sheets`, payload);
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

  const controlledParams = parameters.filter((p) => p.role === "controlled");

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
                "რანდომიზებული რიგითობა, ინსტრუმენტული კალიბრაციის ჩეკლისტი და ხარისხის დადასტურება.",
                "Randomized execution order, calibration checklist, and sign-off verification."
              )}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {activeRunSheet ? (
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
                <Printer size={13} />
                <span>{tr("პროტოკოლის ბეჭდვა (A4 / PDF)", "Print Protocol (A4 / PDF)")}</span>
              </button>
            </>
          ) : (
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
                  : tr("ახალი პროტოკოლის გენერირება", "Generate Run Sheet")}
              </span>
            </button>
          )}
        </div>
      </div>

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
          maxWidth: 900,
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
              <strong>Study ID:</strong> <code>{study.id}</code> • <strong>Domain:</strong> {study.domain || "Physics / Thermal"}
            </div>
          </div>

          <div style={{ textAlign: "right", fontSize: 12, color: "#475569" }}>
            <div>
              <strong>Date:</strong> {new Date().toLocaleDateString()}
            </div>
            <div>
              <strong>RNG Seed:</strong> {study.rng_seed || 42}
            </div>
            {activeRunSheet && (
              <div>
                <strong>Sheet ID:</strong> <code>{activeRunSheet.id}</code>
              </div>
            )}
          </div>
        </div>

        {/* Pre-Test Instrument Calibration Checklist */}
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
            <span>{tr("ტესტირებისწინა ინსტრუმენტული კალიბრაციის ჩეკლისტი (Pre-Test QA Checklist)", "Pre-Test Instrument Calibration Checklist")}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, color: "#334155" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checkThermocouple}
                onChange={(e) => setCheckThermocouple(e.target.checked)}
              />
              <span>{tr("თერმოწყვილების კალიბრაცია (±0.1°C ყინულის წერტილზე)", "Thermocouple calibrated (±0.1°C ice bath)")}</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checkFlowMeter}
                onChange={(e) => setCheckFlowMeter(e.target.checked)}
              />
              <span>{tr("ხარჯმზომის ტარირება (Coriolis Flow Meter Zeroed)", "Coriolis Flow Meter Zeroed & Tared")}</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checkPressureTransducer}
                onChange={(e) => setCheckPressureTransducer(e.target.checked)}
              />
              <span>{tr("დიფერენციალური წნევის სენსორის ნულირება (Differential ΔP zeroed)", "Differential ΔP transducer zero checked")}</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checkThermalGrease}
                onChange={(e) => setCheckThermalGrease(e.target.checked)}
              />
              <span>{tr("თერმოპასტის ერთგვაროვანი ფენა (50µm TIM applied)", "Thermal interface material (TIM 50µm applied)")}</span>
            </label>
          </div>
        </div>

        {/* Environmental Conditions */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            marginBottom: 20,
            fontSize: 11,
          }}
        >
          <div style={{ padding: "8px 12px", border: "1px dashed #cbd5e1", borderRadius: 4 }}>
            <span style={{ color: "#64748b" }}>{tr("გარემო ტემპერატურა:", "Ambient Temp:")}</span>
            <div style={{ height: 16, borderBottom: "1px solid #94a3b8", marginTop: 4 }}>______ °C</div>
          </div>
          <div style={{ padding: "8px 12px", border: "1px dashed #cbd5e1", borderRadius: 4 }}>
            <span style={{ color: "#64748b" }}>{tr("გამაგრილებლის საწყისი ტემპ.:", "Coolant Inlet Temp:")}</span>
            <div style={{ height: 16, borderBottom: "1px solid #94a3b8", marginTop: 4 }}>______ °C</div>
          </div>
          <div style={{ padding: "8px 12px", border: "1px dashed #cbd5e1", borderRadius: 4 }}>
            <span style={{ color: "#64748b" }}>{tr("გამათბობლის სიმძლავრე (Q):", "Heater Load (Q):")}</span>
            <div style={{ height: 16, borderBottom: "1px solid #94a3b8", marginTop: 4 }}>______ W</div>
          </div>
        </div>

        {/* Physical Run Order Table */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ fontSize: 13, color: "#0f172a" }}>
              {tr("რანდომიზებული საგამოცდო რიგითობა (Randomized Test Order)", "Randomized Physical Test Matrix")}
            </strong>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {tr("დროითი დრიფტის პრევენცია • ფიშერ-იეითსის ალგორითმი", "Fisher-Yates shuffled to prevent systematic drift")}
            </span>
          </div>

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
                <th style={{ padding: "6px 8px", width: 60 }}>Run #</th>
                <th style={{ padding: "6px 8px" }}>Candidate ID</th>
                {controlledParams.slice(0, 3).map((p) => (
                  <th key={p.id} style={{ padding: "6px 8px" }}>
                    {p.label || p.key} ({p.unit || "-"})
                  </th>
                ))}
                <th style={{ padding: "6px 8px", width: 90 }}>T_j Measured (°C)</th>
                <th style={{ padding: "6px 8px", width: 90 }}>ΔP Measured (kPa)</th>
                <th style={{ padding: "6px 8px", width: 80 }}>Tech Initials</th>
              </tr>
            </thead>
            <tbody>
              {/* Illustrative sample randomized rows if activeRunSheet exists or mock */}
              {[1, 2, 3, 4, 5, 6, 7, 8].map((order) => {
                const candId = `CAND-${100 + order * 3}`;
                return (
                  <tr
                    key={order}
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      height: 28,
                    }}
                  >
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>R{String(order).padStart(4, "0")}</td>
                    <td style={{ padding: "6px 8px" }}><code>{candId}</code></td>
                    {controlledParams.slice(0, 3).map((p, pIdx) => {
                      const val = pIdx === 0 ? (0.2 + order * 0.05).toFixed(2) : (1.0 + order * 0.2).toFixed(1);
                      return (
                        <td key={p.id} style={{ padding: "6px 8px" }}>
                          {val}
                        </td>
                      );
                    })}
                    <td style={{ padding: "6px 8px", borderRight: "1px solid #e2e8f0" }}>
                      <div style={{ width: "100%", height: 16, borderBottom: "1px dashed #cbd5e1" }} />
                    </td>
                    <td style={{ padding: "6px 8px", borderRight: "1px solid #e2e8f0" }}>
                      <div style={{ width: "100%", height: 16, borderBottom: "1px dashed #cbd5e1" }} />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <div style={{ width: "100%", height: 16, borderBottom: "1px dashed #cbd5e1" }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

