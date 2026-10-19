import React, { useState, useRef } from "react";
import {
  X,
  Upload,
  Box,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FolderArchive,
  ArrowRight,
  ShieldCheck,
  Layers,
  Database,
  Hash,
} from "lucide-react";
import { apiPost, ApiError } from "../api/client";
import type { Study, StudyPackageInspect } from "../api/types";
import { tr } from "../../i18n";
import "../study.css";

interface StudyImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: (importedStudy: Study) => void;
}

export function StudyImportModal({
  isOpen,
  onClose,
  onImportSuccess,
}: StudyImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<StudyPackageInspect | null>(null);
  const [studyName, setStudyName] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFile = async (selectedFile: File) => {
    if (!selectedFile.name.endsWith(".lat") && !selectedFile.name.endsWith(".zip")) {
      setError(
        tr(
          "გთხოვთ აირჩიოთ ვალიდური .lat ან .zip კვლევის არქივი",
          "Please select a valid .lat or .zip study package",
        ),
      );
      return;
    }

    setFile(selectedFile);
    setError(null);
    setInspecting(true);
    setInspected(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const data = await apiPost<StudyPackageInspect>(
        "/studies/package/inspect",
        formData,
      );
      setInspected(data);
      setStudyName(data.study_name || selectedFile.name.replace(/\.(lat|zip)$/i, ""));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
      setFile(null);
    } finally {
      setInspecting(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (studyName.trim()) {
        formData.append("name", studyName.trim());
      }

      const importedStudy = await apiPost<Study>(
        "/studies/package/import",
        formData,
      );

      if (onImportSuccess) {
        onImportSuccess(importedStudy);
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setInspected(null);
    setError(null);
    setStudyName("");
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ maxWidth: 620 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                display: "inline-flex",
                padding: 6,
                borderRadius: 6,
                background: "#e0f2fe",
                color: "#0369a1",
              }}
            >
              <FolderArchive size={18} />
            </div>
            <div>
              <h3 className="modal-title">
                {tr("კვლევის იმპორტი (.lat)", "Import Study Package (.lat)")}
              </h3>
              <p
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  margin: "2px 0 0 0",
                }}
              >
                {tr(
                  "სრული კვლევის არქივის (3D მოდელები, ფლოუები, DoE, სკრინინგი, ემპირია) აღდგენა",
                  "Restore complete scientific study with all 3D scenes, flows, DoE, screening decisions & evidence",
                )}
              </p>
            </div>
          </div>
          <button
            className="btn-icon"
            onClick={onClose}
            aria-label={tr("დახურვა", "Close")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ gap: 16 }}>
          {error && (
            <div
              style={{
                display: "flex",
                gap: 10,
                padding: "10px 14px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 6,
                color: "#991b1b",
                fontSize: 13,
                alignItems: "center",
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {!file ? (
            /* Dropzone */
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? "#0284c7" : "#cbd5e1"}`,
                borderRadius: 8,
                padding: "36px 20px",
                textAlign: "center",
                background: isDragging ? "#f0f9ff" : "#f8fafc",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".lat,.zip"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFile(e.target.files[0]);
                  }
                }}
              />
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  background: "#e2e8f0",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#475569",
                  marginBottom: 12,
                }}
              >
                <Upload size={22} />
              </div>
              <h4
                style={{
                  margin: "0 0 6px 0",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#1e293b",
                }}
              >
                {tr(
                  "გადმოათრიეთ .lat ფაილი ან დააკლიკეთ ასარჩევად",
                  "Drag & drop a .lat file here, or click to browse",
                )}
              </h4>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                {tr(
                  "მხარდაჭერილია Lattice Lab კვლევის სრული პაკეტები (.lat, .zip)",
                  "Supports standalone Lattice Lab study package bundles (.lat or .zip)",
                )}
              </p>
            </div>
          ) : inspecting ? (
            /* Inspecting progress */
            <div
              style={{
                padding: "40px 20px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
              }}
            >
              <RefreshCw size={24} className="spin" style={{ color: "#0284c7" }} />
              <span style={{ fontSize: 13, color: "#475569", fontWeight: 500 }}>
                {tr(
                  "კვლევის პაკეტის ანალიზი და ვერიფიკაცია...",
                  "Inspecting study package and validating integrity...",
                )}
              </span>
            </div>
          ) : (
            /* Inspected Preview Card */
            inspected && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div
                  style={{
                    padding: "14px 16px",
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <CheckCircle2 size={18} style={{ color: "#16a34a", marginTop: 2 }} />
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "#15803d" }}>
                          {file.name}
                        </span>
                        <span className={`badge badge-${inspected.domain}`}>
                          {inspected.domain}
                        </span>
                      </div>
                      <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#166534" }}>
                        {tr("ვალიდური Lattice Lab პაკეტი", "Valid Lattice Lab package")} ·{" "}
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={handleReset}
                    style={{ padding: "4px 8px", fontSize: 11 }}
                  >
                    {tr("შეცვლა", "Change")}
                  </button>
                </div>

                {/* Name edit */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#334155",
                      marginBottom: 6,
                    }}
                  >
                    {tr("კვლევის სახელი იმპორტის შემდეგ:", "Study Name upon Import:")}
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={studyName}
                    onChange={(e) => setStudyName(e.target.value)}
                    placeholder={tr("კვლევის სახელი", "Study Name")}
                    style={{ width: "100%" }}
                  />
                </div>

                {/* 3D Assets Indicator */}
                {inspected.has_3d_models && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      background: "#f8fafc",
                      border: "1px solid #cbd5e1",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#334155",
                    }}
                  >
                    <Box size={18} style={{ color: "#0284c7", flexShrink: 0 }} />
                    <div>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>
                        {tr(
                          "შეიცავს 3D სიმულაციურ გარემოსა და მოდელებს",
                          "Contains 3D Simulation Environment & Assets",
                        )}
                      </span>
                      <span style={{ color: "#64748b", marginLeft: 6 }}>
                        ({inspected.mesh_files_count}{" "}
                        {tr("3D Mesh გეომეტრია", "3D CAD Mesh files")})
                      </span>
                    </div>
                  </div>
                )}

                {/* Package Metrics Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 5 }}>
                      <Layers size={13} />
                      <span>{tr("პარამეტრები", "Parameters")}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {inspected.parameters_count}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 5 }}>
                      <ShieldCheck size={13} />
                      <span>{tr("შეზღუდვები", "Constraints")}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {inspected.constraints_count}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 5 }}>
                      <Hash size={13} />
                      <span>{tr("DoE კანდიდატები", "DoE Candidates")}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {inspected.candidates_count.toLocaleString()}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 5 }}>
                      <CheckCircle2 size={13} />
                      <span>{tr("გადაწყვეტილებები", "Decisions")}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {inspected.decisions_count.toLocaleString()}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 5 }}>
                      <Database size={13} />
                      <span>{tr("ემპირიული ჩანაწერები", "Evidence Records")}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {inspected.evidence_count}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 5 }}>
                      <Box size={13} />
                      <span>{tr("სტატისტიკური ანალიზები", "Analyses")}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {inspected.analyses_count}
                    </div>
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          <button className="btn-secondary" onClick={onClose} disabled={importing}>
            {tr("გაუქმება", "Cancel")}
          </button>
          <button
            className="btn-primary"
            onClick={handleImport}
            disabled={!inspected || importing}
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {importing ? (
              <RefreshCw size={14} className="spin" />
            ) : (
              <ArrowRight size={14} />
            )}
            <span>
              {importing
                ? tr("მიმდინარეობს იმპორტი...", "Importing study...")
                : tr("კვლევის იმპორტი", "Import Study Now")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

