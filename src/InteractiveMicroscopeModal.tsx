import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Move,
  Ruler,
  Crosshair,
  Camera,
  Sun,
  Maximize2,
  Sliders,
  Compass,
  Layers,
  Info,
  Check,
} from "lucide-react";
import type { MicrographData } from "./core/types";
import {
  simulateTransmissiveMicroscope,
  type TransmissiveMicroscopeParams,
} from "./core/microscope";
import {
  computeTopographicIntensity,
  mapLut,
  type ColorLut,
} from "./MicroscopeView";
import { tr } from "./i18n";

export interface InteractiveMicroscopeModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: MicrographData;
  initialParams?: Partial<TransmissiveMicroscopeParams>;
}

type InteractiveTool = "pan" | "caliper" | "probe";

function chooseNiceScaleBarUm(fovUm: number): number {
  const target = fovUm * 0.22;
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000];
  let best = steps[0];
  for (const s of steps) {
    if (s <= target * 1.35) best = s;
  }
  return best;
}

export function InteractiveMicroscopeModal({
  isOpen,
  onClose,
  data,
  initialParams,
}: InteractiveMicroscopeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Optical and Specimen Parameters
  const [params, setParams] = useState<TransmissiveMicroscopeParams>(() => ({
    sourceMode: data.sourceMode,
    gridN: data.width,
    magnification: data.magnification,
    numericalAperture: data.numericalAperture,
    wavelengthNm: data.wavelengthNm,
    focusOffsetUm: data.focusOffsetUm,
    immersionIndex: data.immersionIndex,
    illuminationMode: data.illuminationMode,
    exposure: 1.0,
    matrixThicknessUm:
      data.thicknessGridUm.length > 0
        ? Math.max(10, Math.max(...data.thicknessGridUm.slice(0, 100)) * 2)
        : 25.0,
    matrixAttenInvUm: 0.002,
    featureAttenInvUm: 0.08,
    matrixRefractiveIndex: 1.333,
    featureRefractiveIndex: 1.45,
    featureDiameterUm: 15.0,
    featureVolumeFractionPct: data.stats.featureAreaFractionPct || 20.0,
    chromophoreConcMolM3: 45.0,
    molarAbsorptivityM2Mol: 0.25,
    reticleFrequencyLpMm: 50,
    seed: data.seed || 42,
    ...initialParams,
  }));

  // Visualization View Mode and Palettes
  const [viewMode, setViewMode] = useState<"sem_topography" | "optical_transmission">(
    "sem_topography",
  );
  const [lut, setLut] = useState<ColorLut>("sem_topography");
  const [azimuthDeg, setAzimuthDeg] = useState<number>(315);
  const [elevationDeg, setElevationDeg] = useState<number>(45);

  // Interactive Tools & Stage Pan/Zoom
  const [activeTool, setActiveTool] = useState<InteractiveTool>("pan");
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  // Inspection Crosshair & Caliper
  const [selectedRow, setSelectedRow] = useState<number>(() => Math.floor(data.height / 2));
  const [profileMode, setProfileMode] = useState<"elevation" | "transmittance">("elevation");
  const [hoverInfo, setHoverInfo] = useState<{
    xUm: number;
    yUm: number;
    zUm: number;
    slopeDeg: number;
    tPct: number;
    od: number;
  } | null>(null);

  // Caliper Points in Specimen Space (µm)
  const [caliperStart, setCaliperStart] = useState<{ xUm: number; yUm: number; zUm: number } | null>(
    null,
  );
  const [caliperEnd, setCaliperEnd] = useState<{ xUm: number; yUm: number; zUm: number } | null>(
    null,
  );
  const [isMeasuring, setIsMeasuring] = useState<boolean>(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Re-run physical optics simulation on parameter change (deterministic, <2ms)
  const activeMicrograph = useMemo(() => {
    try {
      const res = simulateTransmissiveMicroscope(params);
      return res.micrograph;
    } catch {
      return data;
    }
  }, [params, data]);

  // 3D SEM Topographic Relief Shading
  const topoGrid = useMemo(() => {
    return computeTopographicIntensity(
      activeMicrograph.thicknessGridUm,
      activeMicrograph.width,
      activeMicrograph.height,
      activeMicrograph.pixelSizeUm,
      azimuthDeg,
      elevationDeg,
    );
  }, [
    activeMicrograph.thicknessGridUm,
    activeMicrograph.width,
    activeMicrograph.height,
    activeMicrograph.pixelSizeUm,
    azimuthDeg,
    elevationDeg,
  ]);

  const displaySize = 560;
  const N = activeMicrograph.width;
  const M = activeMicrograph.height;

  // Viewport visible sub-rectangle in offscreen grid units
  const sW = N / zoom;
  const sH = M / zoom;
  const sX = Math.max(0, Math.min(N - sW, N * (0.5 + pan.x) - sW / 2));
  const sY = Math.max(0, Math.min(M - sH, M * (0.5 + pan.y) - sH / 2));

  // Current visible FOV in µm and dynamic scale bar
  const visibleFovUm = (sW / N) * activeMicrograph.fovUm;
  const dynamicScaleBarUm = useMemo(() => chooseNiceScaleBarUm(visibleFovUm), [visibleFovUm]);

  // Render main viewport canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 1. Offscreen render of the full physical grid
    const offscreen = document.createElement("canvas");
    offscreen.width = N;
    offscreen.height = M;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    const activeGrid = viewMode === "sem_topography" ? topoGrid : activeMicrograph.intensityGrid;
    const imgData = offCtx.createImageData(N, M);
    for (let i = 0; i < N * M; i++) {
      const [r, g, b] = mapLut(activeGrid[i] ?? 0, lut, activeMicrograph.wavelengthNm);
      const p = i * 4;
      imgData.data[p] = r;
      imgData.data[p + 1] = g;
      imgData.data[p + 2] = b;
      imgData.data[p + 3] = 255;
    }
    offCtx.putImageData(imgData, 0, 0);

    // 2. Clear & Draw zoomed/panned view on display canvas
    ctx.clearRect(0, 0, displaySize, displaySize);
    ctx.imageSmoothingEnabled = zoom > 4 ? false : true;
    ctx.drawImage(offscreen, sX, sY, sW, sH, 0, 0, displaySize, displaySize);

    // 3. Draw Selected Horizontal Scanline if within visible window
    const scanlineYNorm = (selectedRow + 0.5) / M;
    const scanlineYWin = (scanlineYNorm * M - sY) / sH;
    if (scanlineYWin >= 0 && scanlineYWin <= 1) {
      const scanYPx = scanlineYWin * displaySize;
      ctx.save();
      ctx.strokeStyle = "rgba(52, 211, 153, 0.75)";
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, scanYPx);
      ctx.lineTo(displaySize, scanYPx);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Draw Caliper Measurement Line & Ticks
    if (caliperStart) {
      const toCanvas = (ptUm: { xUm: number; yUm: number }) => {
        const gridX = ptUm.xUm / activeMicrograph.pixelSizeUm;
        const gridY = ptUm.yUm / activeMicrograph.pixelSizeUm;
        const cx = ((gridX - sX) / sW) * displaySize;
        const cy = ((gridY - sY) / sH) * displaySize;
        return { cx, cy };
      };

      const p1 = toCanvas(caliperStart);
      const p2 = caliperEnd ? toCanvas(caliperEnd) : p1;

      ctx.save();
      // Glowing line
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2.0;
      ctx.shadowColor = "rgba(56, 189, 248, 0.6)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(p1.cx, p1.cy);
      ctx.lineTo(p2.cx, p2.cy);
      ctx.stroke();

      // End Ticks & Circles
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p1.cx, p1.cy, 4, 0, Math.PI * 2);
      ctx.arc(p2.cx, p2.cy, 4, 0, Math.PI * 2);
      ctx.fill();

      // Measurement tag
      if (caliperEnd) {
        const dX = caliperEnd.xUm - caliperStart.xUm;
        const dY = caliperEnd.yUm - caliperStart.yUm;
        const distUm = Math.sqrt(dX * dX + dY * dY);
        const midX = (p1.cx + p2.cx) / 2;
        const midY = (p1.cy + p2.cy) / 2 - 12;

        const tagText = `ΔL = ${distUm.toFixed(2)} µm`;
        ctx.font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
        const tagW = ctx.measureText(tagText).width;

        ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
        ctx.fillRect(midX - tagW / 2 - 6, midY - 14, tagW + 12, 18);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1;
        ctx.strokeRect(midX - tagW / 2 - 6, midY - 14, tagW + 12, 18);

        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "center";
        ctx.fillText(tagText, midX, midY);
      }
      ctx.restore();
    }

    // 5. Dynamic Calibrated Physical Scale Bar (rescales with zoom level)
    const barPx = (dynamicScaleBarUm / visibleFovUm) * displaySize;
    const pad = 14;
    const x1 = displaySize - pad - barPx;
    const x2 = displaySize - pad;
    const yBar = displaySize - pad;

    ctx.save();
    ctx.fillStyle = "rgba(9, 13, 22, 0.85)";
    ctx.fillRect(x1 - 8, yBar - 22, barPx + 16, 28);
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, yBar);
    ctx.lineTo(x2, yBar);
    ctx.stroke();

    ctx.fillStyle = "#f8fafc";
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${dynamicScaleBarUm} µm`, (x1 + x2) / 2, yBar - 7);
    ctx.restore();

    // 6. Stage Minimap / FOV Radar (Overview in corner)
    const mmSize = 72;
    const mmX = pad;
    const mmY = displaySize - pad - mmSize;

    ctx.save();
    ctx.fillStyle = "rgba(9, 14, 23, 0.9)";
    ctx.fillRect(mmX, mmY, mmSize, mmSize);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    // Miniature specimen
    ctx.drawImage(offscreen, mmX, mmY, mmSize, mmSize);

    // Viewport locator box
    const boxX = mmX + (sX / N) * mmSize;
    const boxY = mmY + (sY / M) * mmSize;
    const boxW = Math.max(4, (sW / N) * mmSize);
    const boxH = Math.max(4, (sH / M) * mmSize);

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.restore();
  }, [
    activeMicrograph,
    topoGrid,
    viewMode,
    lut,
    zoom,
    pan,
    sX,
    sY,
    sW,
    sH,
    dynamicScaleBarUm,
    visibleFovUm,
    selectedRow,
    caliperStart,
    caliperEnd,
    displaySize,
    N,
    M,
  ]);

  // Convert canvas pixel (clientX, clientY) to specimen space (x_um, y_um)
  const getSpecimenCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;

    const gridX = Math.max(0, Math.min(N - 1, sX + relX * sW));
    const gridY = Math.max(0, Math.min(M - 1, sY + relY * sH));

    const xUm = gridX * activeMicrograph.pixelSizeUm;
    const yUm = gridY * activeMicrograph.pixelSizeUm;

    const px = Math.floor(gridX);
    const py = Math.floor(gridY);
    const idx = py * N + px;

    const zUm = activeMicrograph.thicknessGridUm[idx] ?? 0;
    const tPct = (activeMicrograph.transmittanceGrid[idx] ?? 0) * 100;
    const od = activeMicrograph.opticalDensityGrid[idx] ?? 0;

    // Local physical slope calculation
    const xm = Math.max(0, px - 1);
    const xp = Math.min(N - 1, px + 1);
    const ym = Math.max(0, py - 1);
    const yp = Math.min(M - 1, py + 1);
    const dxUm = Math.max(1e-4, (xp - xm) * activeMicrograph.pixelSizeUm);
    const dyUm = Math.max(1e-4, (yp - ym) * activeMicrograph.pixelSizeUm);
    const dzdx =
      ((activeMicrograph.thicknessGridUm[py * N + xp] ?? 0) -
        (activeMicrograph.thicknessGridUm[py * N + xm] ?? 0)) /
      dxUm;
    const dzdy =
      ((activeMicrograph.thicknessGridUm[yp * N + px] ?? 0) -
        (activeMicrograph.thicknessGridUm[ym * N + px] ?? 0)) /
      dyUm;
    const slopeDeg = (Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180) / Math.PI;

    return { gridX, gridY, px, py, xUm, yUm, zUm, slopeDeg, tPct, od };
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getSpecimenCoords(e);
    if (activeTool === "pan") {
      setIsPanning(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    } else if (activeTool === "caliper") {
      if (!isMeasuring) {
        setCaliperStart({ xUm: coords.xUm, yUm: coords.yUm, zUm: coords.zUm });
        setCaliperEnd(null);
        setIsMeasuring(true);
      } else {
        setCaliperEnd({ xUm: coords.xUm, yUm: coords.yUm, zUm: coords.zUm });
        setIsMeasuring(false);
      }
    } else {
      // Probe / scanline select
      setSelectedRow(coords.py);
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getSpecimenCoords(e);
    setHoverInfo({
      xUm: coords.xUm,
      yUm: coords.yUm,
      zUm: coords.zUm,
      slopeDeg: coords.slopeDeg,
      tPct: coords.tPct,
      od: coords.od,
    });

    if (isPanning && dragStart) {
      const dx = (e.clientX - dragStart.x) / (displaySize * zoom);
      const dy = (e.clientY - dragStart.y) / (displaySize * zoom);
      setPan((prev) => ({
        x: Math.max(-0.5, Math.min(0.5, prev.x - dx)),
        y: Math.max(-0.5, Math.min(0.5, prev.y - dy)),
      }));
      setDragStart({ x: e.clientX, y: e.clientY });
    } else if (activeTool === "caliper" && isMeasuring) {
      setCaliperEnd({ xUm: coords.xUm, yUm: coords.yUm, zUm: coords.zUm });
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    setDragStart(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prev) => Math.max(1.0, Math.min(12.0, Number((prev * factor).toFixed(2)))));
  };

  // Reset Stage & Pan/Zoom
  const handleResetStage = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    setCaliperStart(null);
    setCaliperEnd(null);
    setIsMeasuring(false);
  };

  // Export Snapshot PNG with calibrated acquisition metadata
  const handleExportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `micrograph-ocular-${params.magnification}x-${viewMode}-${Date.now()}.png`;
    a.click();
  };

  // Objectives Switcher
  const handleObjectiveSelect = (mag: number, na: number, immersion = 1.0) => {
    setParams((prev) => ({
      ...prev,
      magnification: mag,
      numericalAperture: na,
      immersionIndex: immersion,
    }));
  };

  // Selected row cross-section profile data
  const rowProfileT = useMemo(() => {
    const arr: number[] = [];
    const offset = selectedRow * N;
    for (let x = 0; x < N; x++) {
      arr.push((activeMicrograph.transmittanceGrid[offset + x] ?? 0) * 100);
    }
    return arr;
  }, [activeMicrograph, selectedRow, N]);

  const rowProfileZ = useMemo(() => {
    const arr: number[] = [];
    const offset = selectedRow * N;
    for (let x = 0; x < N; x++) {
      arr.push(activeMicrograph.thicknessGridUm[offset + x] ?? 0);
    }
    return arr;
  }, [activeMicrograph, selectedRow, N]);

  const zStatsRow = useMemo(() => {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const z of rowProfileZ) {
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (maxZ - minZ < 0.05) maxZ = minZ + 0.5;
    return { minZ, maxZ };
  }, [rowProfileZ]);

  const isDefocused =
    Math.abs(params.focusOffsetUm) > activeMicrograph.stats.depthOfFieldUm * 0.5;

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(3, 7, 18, 0.88)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: "16px 20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#090e17",
          color: "#f8fafc",
          borderRadius: 12,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.75)",
          width: "100%",
          maxWidth: 1080,
          maxHeight: "94vh",
          display: "flex",
          flexDirection: "column",
          border: "1px solid #1e293b",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            background: "#0d1524",
            borderBottom: "1px solid #1e293b",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(16, 185, 129, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(16, 185, 129, 0.35)",
              }}
            >
              <Maximize2 size={16} color="#10b981" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>
                {tr("ინტერაქტიული მიკროსკოპის ოკულარი", "Interactive Microscope Workstation")}
              </h3>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                {data.provenanceLabel} · {params.magnification}× Objective · {activeMicrograph.numericalAperture.toFixed(2)} NA
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 4,
                background: isDefocused ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
                color: isDefocused ? "#fbbf24" : "#34d399",
                border: `1px solid ${isDefocused ? "rgba(245, 158, 11, 0.35)" : "rgba(16, 185, 129, 0.35)"}`,
                fontFamily: "monospace",
              }}
            >
              {isDefocused
                ? `Δz = ${params.focusOffsetUm >= 0 ? "+" : ""}${params.focusOffsetUm.toFixed(1)} µm (Defocused)`
                : `Δz = 0.0 µm (In Focus · DOF ±${(activeMicrograph.stats.depthOfFieldUm * 0.5).toFixed(2)} µm)`}
            </span>

            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Close (Esc)"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Main Body (2 Columns: Viewport + Controls) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 380px",
            gap: 16,
            padding: 16,
            overflowY: "auto",
            flex: 1,
          }}
        >
          {/* Left Column: Interactive Stage Viewport */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Viewport Toolbar */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                background: "#0c1322",
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #1e293b",
              }}
            >
              {/* Mode Toggle */}
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("sem_topography");
                    setLut("sem_topography");
                    setProfileMode("elevation");
                  }}
                  style={{
                    fontSize: 11,
                    fontWeight: 650,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: "1px solid",
                    cursor: "pointer",
                    background: viewMode === "sem_topography" ? "#047857" : "#1e293b",
                    color: viewMode === "sem_topography" ? "#ffffff" : "#94a3b8",
                    borderColor: viewMode === "sem_topography" ? "#10b981" : "#334155",
                  }}
                >
                  ⛰️ SEM 3D Topography
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("optical_transmission");
                    setLut("spectral");
                    setProfileMode("transmittance");
                  }}
                  style={{
                    fontSize: 11,
                    fontWeight: 650,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: "1px solid",
                    cursor: "pointer",
                    background: viewMode === "optical_transmission" ? "#047857" : "#1e293b",
                    color: viewMode === "optical_transmission" ? "#ffffff" : "#94a3b8",
                    borderColor: viewMode === "optical_transmission" ? "#10b981" : "#334155",
                  }}
                >
                  🔬 Optical Transmission
                </button>
              </div>

              {/* Tool Selection */}
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setActiveTool("pan")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: "1px solid",
                    cursor: "pointer",
                    background: activeTool === "pan" ? "#1e293b" : "transparent",
                    color: activeTool === "pan" ? "#38bdf8" : "#94a3b8",
                    borderColor: activeTool === "pan" ? "#38bdf8" : "#334155",
                  }}
                  title="Drag stage to pan view"
                >
                  <Move size={12} />
                  <span>Pan</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool("caliper");
                    setCaliperStart(null);
                    setCaliperEnd(null);
                    setIsMeasuring(false);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: "1px solid",
                    cursor: "pointer",
                    background: activeTool === "caliper" ? "#1e293b" : "transparent",
                    color: activeTool === "caliper" ? "#38bdf8" : "#94a3b8",
                    borderColor: activeTool === "caliper" ? "#38bdf8" : "#334155",
                  }}
                  title="Click two points on specimen to measure physical distance"
                >
                  <Ruler size={12} />
                  <span>Caliper</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool("probe")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: "1px solid",
                    cursor: "pointer",
                    background: activeTool === "probe" ? "#1e293b" : "transparent",
                    color: activeTool === "probe" ? "#38bdf8" : "#94a3b8",
                    borderColor: activeTool === "probe" ? "#38bdf8" : "#334155",
                  }}
                  title="Inspect point densitometer & select scanline"
                >
                  <Crosshair size={12} />
                  <span>Probe</span>
                </button>
              </div>

              {/* Zoom Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(1.0, Number((z / 1.25).toFixed(2))))}
                  style={{
                    padding: "4px 7px",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    color: "#f8fafc",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                  title="Zoom Out"
                >
                  <ZoomOut size={12} />
                </button>
                <span style={{ fontSize: 11, fontFamily: "monospace", minWidth: 38, textAlign: "center" }}>
                  {zoom.toFixed(1)}×
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(12.0, Number((z * 1.25).toFixed(2))))}
                  style={{
                    padding: "4px 7px",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    color: "#f8fafc",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                  title="Zoom In"
                >
                  <ZoomIn size={12} />
                </button>
                <button
                  type="button"
                  onClick={handleResetStage}
                  style={{
                    padding: "4px 7px",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    color: "#94a3b8",
                    borderRadius: 4,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    fontSize: 10,
                  }}
                  title="Reset Stage (1× zoom & center)"
                >
                  <RotateCcw size={11} />
                  <span>Reset</span>
                </button>
              </div>

              {/* Capture Button */}
              <button
                type="button"
                onClick={handleExportPng}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  padding: "4px 8px",
                  background: "#047857",
                  border: "1px solid #10b981",
                  color: "#ffffff",
                  borderRadius: 5,
                  cursor: "pointer",
                }}
                title="Download high-resolution micrograph snapshot"
              >
                <Camera size={12} />
                <span>Capture</span>
              </button>
            </div>

            {/* Viewport Canvas Wrap */}
            <div
              style={{
                position: "relative",
                width: displaySize,
                height: displaySize,
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid #1e293b",
                background: "#040711",
                cursor:
                  activeTool === "pan"
                    ? isPanning
                      ? "grabbing"
                      : "grab"
                    : activeTool === "caliper"
                      ? "crosshair"
                      : "crosshair",
                boxShadow: "inset 0 0 40px rgba(0, 0, 0, 0.7)",
                margin: "0 auto",
              }}
            >
              <canvas
                ref={canvasRef}
                width={displaySize}
                height={displaySize}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onWheel={handleWheel}
                style={{ display: "block" }}
              />

              {/* Top-Right HUD Badge */}
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  background: "rgba(9, 14, 23, 0.85)",
                  border: "1px solid #1e293b",
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 10,
                  color: "#94a3b8",
                  fontFamily: "monospace",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>FOV: {visibleFovUm.toFixed(1)} × {visibleFovUm.toFixed(1)} µm</span>
                <span>·</span>
                <span style={{ color: "#34d399" }}>{(params.magnification * zoom).toFixed(0)}× Total Mag</span>
              </div>
            </div>

            {/* Horizontal Line Cross-Section Profile */}
            <div
              style={{
                background: "#0c1322",
                border: "1px solid #1e293b",
                borderRadius: 8,
                padding: "8px 12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: "#cbd5e1" }}>
                  {profileMode === "elevation"
                    ? `Surface Elevation z(x) Profile at y = ${((selectedRow + 0.5) * activeMicrograph.pixelSizeUm).toFixed(1)} µm`
                    : `Transmittance Profile T(x) at y = ${((selectedRow + 0.5) * activeMicrograph.pixelSizeUm).toFixed(1)} µm`}
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => setProfileMode("elevation")}
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: "1px solid",
                      cursor: "pointer",
                      background: profileMode === "elevation" ? "#047857" : "#1e293b",
                      color: profileMode === "elevation" ? "#ffffff" : "#94a3b8",
                      borderColor: profileMode === "elevation" ? "#10b981" : "#334155",
                    }}
                  >
                    ⛰️ z(x) µm
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfileMode("transmittance")}
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: "1px solid",
                      cursor: "pointer",
                      background: profileMode === "transmittance" ? "#047857" : "#1e293b",
                      color: profileMode === "transmittance" ? "#ffffff" : "#94a3b8",
                      borderColor: profileMode === "transmittance" ? "#10b981" : "#334155",
                    }}
                  >
                    🔬 T(x) %
                  </button>
                </div>
              </div>

              {profileMode === "elevation" ? (
                <svg
                  viewBox="0 0 530 68"
                  style={{ width: "100%", height: 68, display: "block" }}
                >
                  <line x1="38" y1="8" x2="520" y2="8" stroke="#1e293b" strokeDasharray="2 2" />
                  <line x1="38" y1="34" x2="520" y2="34" stroke="#1e293b" strokeDasharray="2 2" />
                  <line x1="38" y1="60" x2="520" y2="60" stroke="#1e293b" />
                  <text x="2" y="11" fill="#64748b" fontSize="8.5">
                    {zStatsRow.maxZ.toFixed(2)}µm
                  </text>
                  <text x="2" y="37" fill="#64748b" fontSize="8.5">
                    {((zStatsRow.maxZ + zStatsRow.minZ) / 2).toFixed(2)}µm
                  </text>
                  <text x="2" y="63" fill="#64748b" fontSize="8.5">
                    {zStatsRow.minZ.toFixed(2)}µm
                  </text>
                  <polyline
                    fill="none"
                    stroke="#34d399"
                    strokeWidth="1.75"
                    points={rowProfileZ
                      .map((zVal, i) => {
                        const px = 38 + (i / Math.max(1, rowProfileZ.length - 1)) * 482;
                        const py =
                          60 -
                          ((zVal - zStatsRow.minZ) / (zStatsRow.maxZ - zStatsRow.minZ)) * 52;
                        return `${px.toFixed(1)},${py.toFixed(1)}`;
                      })
                      .join(" ")}
                  />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 530 68"
                  style={{ width: "100%", height: 68, display: "block" }}
                >
                  <line x1="28" y1="8" x2="520" y2="8" stroke="#1e293b" strokeDasharray="2 2" />
                  <line x1="28" y1="34" x2="520" y2="34" stroke="#1e293b" strokeDasharray="2 2" />
                  <line x1="28" y1="60" x2="520" y2="60" stroke="#1e293b" />
                  <text x="4" y="11" fill="#64748b" fontSize="9">100%</text>
                  <text x="8" y="37" fill="#64748b" fontSize="9">50%</text>
                  <text x="12" y="63" fill="#64748b" fontSize="9">0%</text>
                  <polyline
                    fill="none"
                    stroke="#2dd4bf"
                    strokeWidth="1.5"
                    points={rowProfileT
                      .map((tPct, i) => {
                        const px = 28 + (i / Math.max(1, rowProfileT.length - 1)) * 492;
                        const py = 60 - (Math.max(0, Math.min(100, tPct)) / 100) * 52;
                        return `${px.toFixed(1)},${py.toFixed(1)}`;
                      })
                      .join(" ")}
                  />
                </svg>
              )}
            </div>
          </div>

          {/* Right Column: Physical Microscope Control Panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Objective Turret */}
            <div
              style={{
                background: "#0c1322",
                border: "1px solid #1e293b",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Compass size={14} color="#10b981" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc" }}>
                  {tr("ობიექტივის რევოლვერი (Objective Turret)", "Objective Revolver")}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
                {[
                  { mag: 10, na: 0.25, label: "10×", sub: "0.25 NA" },
                  { mag: 20, na: 0.4, label: "20×", sub: "0.40 NA" },
                  { mag: 40, na: 0.65, label: "40×", sub: "0.65 NA" },
                  { mag: 60, na: 0.85, label: "60×", sub: "0.85 NA" },
                  { mag: 100, na: 1.25, label: "100×", sub: "Oil 1.25", oil: 1.518 },
                ].map((obj) => {
                  const active = params.magnification === obj.mag;
                  return (
                    <button
                      key={obj.mag}
                      type="button"
                      onClick={() => handleObjectiveSelect(obj.mag, obj.na, obj.oil ?? 1.0)}
                      style={{
                        padding: "6px 2px",
                        textAlign: "center",
                        borderRadius: 6,
                        border: "1px solid",
                        cursor: "pointer",
                        background: active ? "#047857" : "#172033",
                        color: active ? "#ffffff" : "#94a3b8",
                        borderColor: active ? "#10b981" : "#334155",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{obj.label}</div>
                      <div style={{ fontSize: 8.5, color: active ? "#d1fae5" : "#64748b" }}>
                        {obj.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "#94a3b8" }}>
                <span>Abbe Limit: {activeMicrograph.stats.abbeResolutionUm.toFixed(3)} µm</span>
                <span>FOV: {activeMicrograph.fovUm.toFixed(0)} µm</span>
              </div>
            </div>

            {/* Focus Control (Fine & Coarse Z-Stage) */}
            <div
              style={{
                background: "#0c1322",
                border: "1px solid #1e293b",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc" }}>
                  {tr("ფოკუსირების მექანიზმი (Z-Stage Focus)", "Z-Stage Focus Adjustment")}
                </span>
                <button
                  type="button"
                  onClick={() => setParams((p) => ({ ...p, focusOffsetUm: 0.0 }))}
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    color: "#34d399",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                  title="Snap directly to in-focus focal plane"
                >
                  Focus Zero
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 10, color: "#64748b" }}>-10µm</span>
                <input
                  type="range"
                  min="-10.0"
                  max="10.0"
                  step="0.1"
                  value={params.focusOffsetUm}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, focusOffsetUm: Number(e.target.value) }))
                  }
                  style={{ flex: 1, accentColor: "#10b981" }}
                />
                <span style={{ fontSize: 10, color: "#64748b" }}>+10µm</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10 }}>
                <span style={{ fontFamily: "monospace", color: isDefocused ? "#fbbf24" : "#34d399" }}>
                  Δz = {params.focusOffsetUm >= 0 ? "+" : ""}
                  {params.focusOffsetUm.toFixed(1)} µm
                </span>
                <span style={{ color: "#94a3b8" }}>
                  Berek DOF: ±{(activeMicrograph.stats.depthOfFieldUm * 0.5).toFixed(2)} µm
                </span>
              </div>
            </div>

            {/* Illumination & Condenser Mode */}
            <div
              style={{
                background: "#0c1322",
                border: "1px solid #1e293b",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc", marginBottom: 8 }}>
                {tr("განათება და კონდენსორი (Illumination Mode)", "Illumination & Contrast Mode")}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginBottom: 8 }}>
                {[
                  { mode: "Brightfield", label: "Brightfield" },
                  { mode: "Darkfield", label: "Darkfield" },
                  { mode: "Phase contrast", label: "Phase Contrast" },
                  { mode: "Optical density", label: "Optical Density" },
                ].map((m) => (
                  <button
                    key={m.mode}
                    type="button"
                    onClick={() =>
                      setParams((p) => ({
                        ...p,
                        illuminationMode: m.mode as TransmissiveMicroscopeParams["illuminationMode"],
                      }))
                    }
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      padding: "5px 8px",
                      borderRadius: 5,
                      border: "1px solid",
                      cursor: "pointer",
                      background: params.illuminationMode === m.mode ? "#047857" : "#172033",
                      color: params.illuminationMode === m.mode ? "#ffffff" : "#94a3b8",
                      borderColor: params.illuminationMode === m.mode ? "#10b981" : "#334155",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
                  <span>Wavelength λ</span>
                  <span style={{ fontFamily: "monospace", color: "#38bdf8" }}>{params.wavelengthNm} nm</span>
                </div>
                <input
                  type="range"
                  min="400"
                  max="700"
                  step="5"
                  value={params.wavelengthNm}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, wavelengthNm: Number(e.target.value) }))
                  }
                  style={{ width: "100%", accentColor: "#38bdf8" }}
                />

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
                  <span>Lamp Exposure</span>
                  <span style={{ fontFamily: "monospace", color: "#f8fafc" }}>{params.exposure.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="3.0"
                  step="0.1"
                  value={params.exposure}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, exposure: Number(e.target.value) }))
                  }
                  style={{ width: "100%", accentColor: "#f8fafc" }}
                />
              </div>
            </div>

            {/* SEM Topography Lighting Angles & Palette */}
            {viewMode === "sem_topography" && (
              <div
                style={{
                  background: "#0c1322",
                  border: "1px solid #1e293b",
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Sun size={14} color="#f59e0b" />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc" }}>
                    {tr("SEM დეტექტორის კუთხეები (Detector Lighting)", "SEM Virtual Illumination")}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
                    <span>Azimuth Light Angle</span>
                    <span style={{ fontFamily: "monospace", color: "#f59e0b" }}>{azimuthDeg}° (NW)</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="5"
                    value={azimuthDeg}
                    onChange={(e) => setAzimuthDeg(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#f59e0b" }}
                    title="Rotate illumination around the surface features"
                  />

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
                    <span>Elevation Angle</span>
                    <span style={{ fontFamily: "monospace", color: "#f59e0b" }}>{elevationDeg}°</span>
                  </div>
                  <input
                    type="range"
                    min="15"
                    max="75"
                    step="2"
                    value={elevationDeg}
                    onChange={(e) => setElevationDeg(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#f59e0b" }}
                  />

                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                    <span>Palette LUT:</span>
                    <select
                      value={lut}
                      onChange={(e) => setLut(e.target.value as ColorLut)}
                      style={{
                        background: "#1e293b",
                        color: "#f8fafc",
                        border: "1px solid #334155",
                        borderRadius: 4,
                        fontSize: 10,
                        padding: "2px 6px",
                      }}
                    >
                      <option value="sem_topography">SEM Platinum Monochrome</option>
                      <option value="grayscale">Monochrome Grayscale</option>
                      <option value="viridis">Viridis False-Color Elevation</option>
                      <option value="inferno">Inferno Thermal Emission</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {/* Live Point Densitometer & Caliper Readouts */}
            <div
              style={{
                background: "#0c1322",
                border: "1px solid #1e293b",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Crosshair size={14} color="#38bdf8" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc" }}>
                  {tr("წერტილოვანი ზონდი (Live Optical Probe)", "Live Point Probe & Caliper")}
                </span>
              </div>

              {hoverInfo ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", fontSize: 10 }}>
                  <div>
                    <span style={{ color: "#64748b", display: "block" }}>Elevation z(x,y)</span>
                    <strong style={{ color: "#34d399", fontSize: 12 }}>{hoverInfo.zUm.toFixed(2)} µm</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", display: "block" }}>Slope Angle θ</span>
                    <strong style={{ color: "#f8fafc", fontSize: 12 }}>{hoverInfo.slopeDeg.toFixed(1)}°</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", display: "block" }}>Transmittance T</span>
                    <strong style={{ color: "#38bdf8" }}>{hoverInfo.tPct.toFixed(1)}%</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", display: "block" }}>Optical Density</span>
                    <strong style={{ color: "#f8fafc" }}>{hoverInfo.od.toFixed(3)} OD</strong>
                  </div>
                  <div style={{ gridColumn: "span 2", color: "#94a3b8", fontFamily: "monospace", fontSize: 9.5 }}>
                    Position: ({hoverInfo.xUm.toFixed(1)} µm, {hoverInfo.yUm.toFixed(1)} µm)
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: 10, color: "#64748b" }}>
                  Move cursor over specimen to probe local height, slope, and optical density.
                </span>
              )}

              {caliperStart && caliperEnd && (
                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: "1px solid #1e293b",
                    fontSize: 10.5,
                    display: "flex",
                    justifyContent: "space-between",
                    color: "#38bdf8",
                  }}
                >
                  <span>Measured Distance:</span>
                  <strong style={{ fontFamily: "monospace", fontSize: 12 }}>
                    {Math.sqrt(
                      Math.pow(caliperEnd.xUm - caliperStart.xUm, 2) +
                        Math.pow(caliperEnd.yUm - caliperStart.yUm, 2),
                    ).toFixed(2)}{" "}
                    µm
                  </strong>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

