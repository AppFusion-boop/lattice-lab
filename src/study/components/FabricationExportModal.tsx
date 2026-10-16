import React, { useState } from "react";
import {
  X,
  Download,
  FileCode,
  Layers,
  Settings,
  CheckCircle2,
  Box,
  Compass,
} from "lucide-react";
import type { Object3D } from "../../core/types";
import { exportSceneToDxf } from "../../core/cad/dxf-export";
import { exportSceneToStl } from "../../core/cad/stl-export";
import { tr } from "../../i18n";

interface FabricationExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  objects: Object3D[];
  studyName?: string;
  candidateLabel?: string;
}

export function FabricationExportModal({
  isOpen,
  onClose,
  objects,
  studyName = "LatticeLab",
  candidateLabel,
}: FabricationExportModalProps) {
  const [format, setFormat] = useState<"dxf" | "stl" | "csv">("stl");
  const [units, setUnits] = useState<"mm" | "cm" | "inch">("mm");
  const [plane, setPlane] = useState<"xz" | "xy" | "yz">("xz");
  const [scale, setScale] = useState<number>(1.0);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleExport = () => {
    const safeStudyName = studyName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const safeCandName = candidateLabel ? `_${candidateLabel.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";

    let content = "";
    let mimeType = "text/plain";
    let filename = "";

    if (format === "dxf") {
      content = exportSceneToDxf(objects, {
        units,
        scale,
        plane,
      });
      mimeType = "application/dxf";
      filename = `${safeStudyName}${safeCandName}_2d_${plane}.dxf`;
    } else if (format === "stl") {
      content = exportSceneToStl(objects, {
        name: `${safeStudyName}${safeCandName}`,
        scale,
        units,
      });
      mimeType = "model/stl";
      filename = `${safeStudyName}${safeCandName}_3d_mesh.stl`;
    } else if (format === "csv") {
      // Coordinate toolpath / component centerlines
      const rows = [
        ["id", "name", "shape", "pos_x", "pos_y", "pos_z", "size_x", "size_y", "size_z", "unit"].join(","),
        ...objects.map((o) =>
          [
            o.id,
            `"${o.name.replace(/"/g, '""')}"`,
            o.shape,
            (o.position.x * scale).toFixed(3),
            (o.position.y * scale).toFixed(3),
            (o.position.z * scale).toFixed(3),
            (o.size.x * scale).toFixed(3),
            (o.size.y * scale).toFixed(3),
            (o.size.z * scale).toFixed(3),
            units,
          ].join(",")
        ),
      ];
      content = rows.join("\r\n");
      mimeType = "text/csv;charset=utf-8;";
      filename = `${safeStudyName}${safeCandName}_coordinates.csv`;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 4000);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          width: "100%",
          maxWidth: 540,
          overflow: "hidden",
          border: "1px solid #e2e8f0",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "#e0f2fe",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#0284c7",
              }}
            >
              <Download size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                {tr("ფიზიკური დამზადების ექსპორტი (CAD / CNC)", "Fabrication CAD Export")}
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                {tr("ექსპორტი CNC ჩარხებისთვის, Wire-EDM-ისა და 3D ბეჭდვისთვის", "Export for CNC milling, Wire-EDM, and 3D printing")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Format Picker */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
              {tr("ფაილის ფორმატი (CAD Format):", "File Format:")}
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <button
                type="button"
                onClick={() => setFormat("stl")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "12px 8px",
                  borderRadius: 8,
                  border: `2px solid ${format === "stl" ? "#0284c7" : "#e2e8f0"}`,
                  background: format === "stl" ? "#f0f9ff" : "#ffffff",
                  cursor: "pointer",
                }}
              >
                <Box size={20} color={format === "stl" ? "#0284c7" : "#64748b"} />
                <span style={{ fontSize: 12, fontWeight: 600, color: format === "stl" ? "#0369a1" : "#334155" }}>
                  STL (3D Mesh)
                </span>
                <span style={{ fontSize: 10, color: "#64748b" }}>3D Print / DMLS</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat("dxf")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "12px 8px",
                  borderRadius: 8,
                  border: `2px solid ${format === "dxf" ? "#0284c7" : "#e2e8f0"}`,
                  background: format === "dxf" ? "#f0f9ff" : "#ffffff",
                  cursor: "pointer",
                }}
              >
                <FileCode size={20} color={format === "dxf" ? "#0284c7" : "#64748b"} />
                <span style={{ fontSize: 12, fontWeight: 600, color: format === "dxf" ? "#0369a1" : "#334155" }}>
                  DXF (AutoCAD R12)
                </span>
                <span style={{ fontSize: 10, color: "#64748b" }}>2D CNC / EDM</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat("csv")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "12px 8px",
                  borderRadius: 8,
                  border: `2px solid ${format === "csv" ? "#0284c7" : "#e2e8f0"}`,
                  background: format === "csv" ? "#f0f9ff" : "#ffffff",
                  cursor: "pointer",
                }}
              >
                <Layers size={20} color={format === "csv" ? "#0284c7" : "#64748b"} />
                <span style={{ fontSize: 12, fontWeight: 600, color: format === "csv" ? "#0369a1" : "#334155" }}>
                  CSV (Toolpaths)
                </span>
                <span style={{ fontSize: 10, color: "#64748b" }}>Coordinates</span>
              </button>
            </div>
          </div>

          {/* Configuration Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                {tr("საზომი ერთეულები (Units):", "Units:")}
              </label>
              <select
                value={units}
                onChange={(e) => setUnits(e.target.value as "mm" | "cm" | "inch")}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  background: "#fff",
                }}
              >
                <option value="mm">{tr("მილიმეტრი (mm)", "Millimeters (mm)")}</option>
                <option value="cm">{tr("სანტიმეტრი (cm)", "Centimeters (cm)")}</option>
                <option value="inch">{tr("დუიმი (inch)", "Inches (inch)")}</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                {tr("მასშტაბი (Scale Multiplier):", "Scale Multiplier:")}
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="100"
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value) || 1.0)}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          {/* DXF-specific cross-section plane */}
          {format === "dxf" && (
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                {tr("კვეთის სიბრტყე (Projection Plane):", "Projection Plane:")}
              </label>
              <select
                value={plane}
                onChange={(e) => setPlane(e.target.value as "xz" | "xy" | "yz")}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  background: "#fff",
                }}
              >
                <option value="xz">{tr("X-Z სიბრტყე (ზედა ხედი / ფილის ზედაპირი)", "X-Z Plane (Top View / Substrate Face)")}</option>
                <option value="xy">{tr("X-Y სიბრტყე (წინა კვეთა / არხების პროფილი)", "X-Y Plane (Front Cross-Section / Fin Profile)")}</option>
                <option value="yz">{tr("Y-Z სიბრტყე (გვერდითი პროფილი)", "Y-Z Plane (Lateral Profile)")}</option>
              </select>
            </div>
          )}

          {/* Component Summary Card */}
          <div
            style={{
              padding: "10px 14px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 12,
              color: "#475569",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              {tr("სულ ექსპორტირებული ობიექტი:", "Total Bodies:")} <strong>{objects.length}</strong>
            </span>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {format === "stl"
                ? `~${objects.length * 12} ${tr("სამკუთხედი (Facets)", "triangular facets")}`
                : `${objects.length * 4} ${tr("კონტურული ხაზი", "contour lines")}`}
            </span>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "14px 20px",
            background: "#f8fafc",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            {downloadSuccess && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#16a34a",
                }}
              >
                <CheckCircle2 size={14} />
                {tr("ფაილი წარმატებით ჩამოიტვირთა!", "CAD file downloaded!")}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 14px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {tr("დახურვა", "Cancel")}
            </button>

            <button
              type="button"
              onClick={handleExport}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: "#0284c7",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Download size={14} />
              <span>{tr("CAD ფაილის ჩამოტვირთვა", "Download CAD File")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

