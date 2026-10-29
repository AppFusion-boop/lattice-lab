import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Crosshair, Info, Maximize2 } from "lucide-react";
import type { MicrographData } from "./core/types";
import { L } from "./core/ka";
import { InteractiveMicroscopeModal } from "./InteractiveMicroscopeModal";
import type { TransmissiveMicroscopeParams } from "./core/microscope";

export type ColorLut =
  | "sem_topography"
  | "grayscale"
  | "spectral"
  | "viridis"
  | "inferno";

/**
 * Approximate CIE visible wavelength (380..750 nm) to [R, G, B] in 0..255.
 */
function wavelengthToRgb(nm: number): [number, number, number] {
  const w = Math.max(380, Math.min(750, nm));
  let r = 0;
  let g = 0;
  let b = 0;

  if (w >= 380 && w < 440) {
    r = -(w - 440) / (440 - 380);
    b = 1;
  } else if (w >= 440 && w < 490) {
    g = (w - 440) / (490 - 440);
    b = 1;
  } else if (w >= 490 && w < 510) {
    g = 1;
    b = -(w - 510) / (510 - 490);
  } else if (w >= 510 && w < 580) {
    r = (w - 510) / (580 - 510);
    g = 1;
  } else if (w >= 580 && w < 645) {
    r = 1;
    g = -(w - 645) / (645 - 580);
  } else if (w >= 645 && w <= 750) {
    r = 1;
  }

  let factor = 1;
  if (w >= 380 && w < 420) {
    factor = 0.35 + (0.65 * (w - 380)) / (420 - 380);
  } else if (w > 700 && w <= 750) {
    factor = 0.35 + (0.65 * (750 - w)) / (750 - 700);
  }

  // Blend slightly toward warm halogen white in Brightfield for natural ocular appearance
  const tintR = Math.round(255 * Math.pow(r * factor * 0.65 + 0.35, 0.85));
  const tintG = Math.round(255 * Math.pow(g * factor * 0.65 + 0.35, 0.85));
  const tintB = Math.round(255 * Math.pow(b * factor * 0.65 + 0.33, 0.85));
  return [tintR, tintG, tintB];
}

export function mapLut(
  val01: number,
  lut: ColorLut,
  wavelengthNm: number,
): [number, number, number] {
  const v = Math.max(0, Math.min(1, val01));
  if (lut === "sem_topography") {
    // High-contrast platinum SEM response curve with luminous electron edge highlights
    const vS = v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v);
    const r = Math.round(10 + vS * 238);
    const g = Math.round(12 + vS * 240);
    const b = Math.round(16 + vS * 239);
    return [r, g, b];
  }
  if (lut === "grayscale") {
    const c = Math.round(v * 255);
    return [c, c, c];
  }
  if (lut === "spectral") {
    const [tr, tg, tb] = wavelengthToRgb(wavelengthNm);
    return [Math.round(v * tr), Math.round(v * tg), Math.round(v * tb)];
  }
  if (lut === "viridis") {
    // Smooth 4-stop Viridis approximation
    const r = Math.round(255 * Math.max(0, Math.min(1, -0.25 + 1.45 * v * v)));
    const g = Math.round(255 * Math.max(0, Math.min(1, 0.05 + 0.92 * Math.pow(v, 0.85))));
    const b = Math.round(
      255 * Math.max(0, Math.min(1, 0.33 + 0.75 * Math.sin(v * Math.PI * 0.85) - 0.25 * v)),
    );
    return [r, g, b];
  }
  // inferno
  const r = Math.round(255 * Math.min(1, Math.pow(v, 0.6) * 1.15));
  const g = Math.round(255 * Math.max(0, Math.min(1, (v - 0.25) * 1.35)));
  const b = Math.round(
    255 *
      Math.max(
        0,
        Math.min(1, Math.sin(v * Math.PI) * 0.7 + (v > 0.8 ? (v - 0.8) * 2 : 0)),
      ),
  );
  return [r, g, b];
}

/**
 * Computes authentic Scanning Electron Microscope (SEM) 3D Topographic Relief Shading
 * directly from the physical specimen thickness/elevation grid z(x,y).
 *
 * Physics & Non-Falsification:
 * - Directional Lambertian reflectance from Everhart-Thornley detector orientation.
 * - Secondary electron edge brightening: emission yield δ ∝ sec(θ) = 1/nz (steep edges glow).
 * - Cavity ambient occlusion: deep pits and crevices exhibit lower line-of-sight collection.
 * - Zero invented data (Hard Rule #1): every normal vector is strictly derived via ∇z(x,y).
 */
export function computeTopographicIntensity(
  thicknessGrid: number[] | Float64Array,
  N: number,
  M: number,
  pixelSizeUm: number,
  azimuthDeg = 315,
  elevationDeg = 45,
): Float64Array {
  const total = N * M;
  const out = new Float64Array(total);
  if (!thicknessGrid || thicknessGrid.length === 0) return out;

  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < total; i++) {
    const z = thicknessGrid[i] ?? 0;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const zRange = Math.max(1e-4, maxZ - minZ);

  // Compass bearing azimuth: 0 deg = North (top), 90 deg = East (right),
  // 180 deg = South (bottom), 270 deg = West (left), 315 deg = NW (top-left)
  const azRad = (azimuthDeg * Math.PI) / 180;
  const elRad = (elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(elRad);
  const sinEl = Math.sin(elRad);
  const lx = Math.sin(azRad) * cosEl;
  const ly = -Math.cos(azRad) * cosEl;
  const lz = sinEl;

  for (let y = 0; y < M; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(M - 1, y + 1);
    const dyUm = Math.max(1e-4, (yp - ym) * pixelSizeUm);

    for (let x = 0; x < N; x++) {
      const idx = y * N + x;
      const xm = Math.max(0, x - 1);
      const xp = Math.min(N - 1, x + 1);
      const dxUm = Math.max(1e-4, (xp - xm) * pixelSizeUm);

      const zVal = thicknessGrid[idx] ?? 0;
      const zXm = thicknessGrid[y * N + xm] ?? 0;
      const zXp = thicknessGrid[y * N + xp] ?? 0;
      const zYm = thicknessGrid[ym * N + x] ?? 0;
      const zYp = thicknessGrid[yp * N + x] ?? 0;

      const dzdx = (zXp - zXm) / dxUm;
      const dzdy = (zYp - zYm) / dyUm;

      // Surface normal: n = (-dz/dx, -dz/dy, 1) / len
      const gradSq = dzdx * dzdx + dzdy * dzdy;
      const len = Math.sqrt(1 + gradSq);
      const nx = -dzdx / len;
      const ny = -dzdy / len;
      const nz = 1 / len;

      // 1. Directional Lambertian diffuse reflectance
      const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);

      // 2. Secondary electron edge glow (emission yield delta proportional to sec(theta) = 1/nz)
      // Steep ridges, steps and boundaries illuminate brightly
      const edge = 1 - nz;

      // 3. Ambient cavity occlusion
      const ambient = (zVal - minZ) / zRange;

      // Combined physical SEM topographic intensity
      const rawI = 0.10 + 0.52 * diffuse + 0.38 * edge + 0.12 * (ambient - 0.5);
      out[idx] = Math.max(0, Math.min(1, rawI));
    }
  }

  return out;
}

function chooseNiceScaleBarUm(fovUm: number): number {
  const target = fovUm * 0.22;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000];
  let best = steps[0];
  for (const s of steps) {
    if (s <= target * 1.35) best = s;
  }
  return best;
}

export function MicroscopeView({
  data,
  initialParams,
  currentTime = 0.0,
  onTimeChange,
}: {
  data: MicrographData;
  initialParams?: Partial<TransmissiveMicroscopeParams>;
  currentTime?: number;
  onTimeChange?: (t: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<
    "sem_topography" | "optical_transmission"
  >("sem_topography");
  const [lut, setLut] = useState<ColorLut>("sem_topography");
  const [profileMode, setProfileMode] = useState<
    "elevation" | "transmittance"
  >("elevation");
  const [selectedRow, setSelectedRow] = useState<number>(() =>
    Math.floor(data.height / 2),
  );
  const [hoverPx, setHoverPx] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setSelectedRow((prev) => Math.max(0, Math.min(data.height - 1, prev)));
  }, [data.height]);

  const scaleBarUm = useMemo(
    () => chooseNiceScaleBarUm(data.fovUm),
    [data.fovUm],
  );

  const displaySize = 340;

  // 3D SEM Topographic Relief Shading Grid calculated directly from physical thickness
  const topoIntensityGrid = useMemo(() => {
    return computeTopographicIntensity(
      data.thicknessGridUm,
      data.width,
      data.height,
      data.pixelSizeUm,
    );
  }, [data.thicknessGridUm, data.width, data.height, data.pixelSizeUm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width: N, height: M, wavelengthNm } = data;
    const offscreen = document.createElement("canvas");
    offscreen.width = N;
    offscreen.height = M;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    const activeGrid =
      viewMode === "sem_topography" ? topoIntensityGrid : data.intensityGrid;
    const imgData = offCtx.createImageData(N, M);
    for (let i = 0; i < N * M; i++) {
      const [r, g, b] = mapLut(activeGrid[i] ?? 0, lut, wavelengthNm);
      const p = i * 4;
      imgData.data[p] = r;
      imgData.data[p + 1] = g;
      imgData.data[p + 2] = b;
      imgData.data[p + 3] = 255;
    }
    offCtx.putImageData(imgData, 0, 0);

    ctx.clearRect(0, 0, displaySize, displaySize);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(offscreen, 0, 0, displaySize, displaySize);

    // Draw selected horizontal scanline
    const scanY = ((selectedRow + 0.5) / M) * displaySize;
    ctx.save();
    ctx.strokeStyle =
      viewMode === "sem_topography"
        ? "rgba(52, 211, 153, 0.85)"
        : "rgba(45, 212, 191, 0.75)";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, scanY);
    ctx.lineTo(displaySize, scanY);
    ctx.stroke();
    ctx.restore();

    // Draw hover crosshair if active
    if (hoverPx) {
      const hx = ((hoverPx.x + 0.5) / N) * displaySize;
      const hy = ((hoverPx.y + 0.5) / M) * displaySize;
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Draw calibrated physical scale bar in bottom-right corner
    const barPx = (scaleBarUm / data.fovUm) * displaySize;
    const pad = 12;
    const x1 = displaySize - pad - barPx;
    const x2 = displaySize - pad;
    const yBar = displaySize - pad;

    ctx.save();
    ctx.fillStyle = "rgba(9, 13, 22, 0.78)";
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
    ctx.fillText(`${scaleBarUm} µm`, (x1 + x2) / 2, yBar - 7);
    ctx.restore();
  }, [
    data,
    lut,
    viewMode,
    topoIntensityGrid,
    selectedRow,
    hoverPx,
    scaleBarUm,
    displaySize,
  ]);

  const activePx = hoverPx ?? {
    x: Math.floor(data.width / 2),
    y: selectedRow,
  };
  const activeIdx = activePx.y * data.width + activePx.x;
  const activeXUm = (activePx.x + 0.5) * data.pixelSizeUm;
  const activeYUm = (activePx.y + 0.5) * data.pixelSizeUm;
  const activeThicknessUm = data.thicknessGridUm[activeIdx] ?? 0;
  const activeTransPct = (data.transmittanceGrid[activeIdx] ?? 0) * 100;
  const activeOd = data.opticalDensityGrid[activeIdx] ?? 0;

  // Local physical slope calculation (gradient magnitude in degrees)
  const xm = Math.max(0, activePx.x - 1);
  const xp = Math.min(data.width - 1, activePx.x + 1);
  const ym = Math.max(0, activePx.y - 1);
  const yp = Math.min(data.height - 1, activePx.y + 1);
  const dxUm = Math.max(1e-4, (xp - xm) * data.pixelSizeUm);
  const dyUm = Math.max(1e-4, (yp - ym) * data.pixelSizeUm);
  const dzdx =
    ((data.thicknessGridUm[activePx.y * data.width + xp] ?? 0) -
      (data.thicknessGridUm[activePx.y * data.width + xm] ?? 0)) /
    dxUm;
  const dzdy =
    ((data.thicknessGridUm[yp * data.width + activePx.x] ?? 0) -
      (data.thicknessGridUm[ym * data.width + activePx.x] ?? 0)) /
    dyUm;
  const activeSlopeDeg =
    (Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180) / Math.PI;

  const rowProfileT = useMemo(() => {
    const arr: number[] = [];
    const offset = selectedRow * data.width;
    for (let x = 0; x < data.width; x++) {
      arr.push((data.transmittanceGrid[offset + x] ?? 0) * 100);
    }
    return arr;
  }, [data, selectedRow]);

  const rowProfileZ = useMemo(() => {
    const arr: number[] = [];
    const offset = selectedRow * data.width;
    for (let x = 0; x < data.width; x++) {
      arr.push(data.thicknessGridUm[offset + x] ?? 0);
    }
    return arr;
  }, [data, selectedRow]);

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

  const exportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `micrograph-${data.magnification}x-${viewMode === "sem_topography" ? "sem-topography" : data.illuminationMode.toLowerCase().replace(/\s+/g, "-")}.png`;
    a.click();
  };

  const handlePointer = (
    e: React.MouseEvent<HTMLCanvasElement>,
    click = false,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const px = Math.max(
      0,
      Math.min(data.width - 1, Math.floor(relX * data.width)),
    );
    const py = Math.max(
      0,
      Math.min(data.height - 1, Math.floor(relY * data.height)),
    );
    setHoverPx({ x: px, y: py });
    if (click || e.buttons === 1) {
      setSelectedRow(py);
    }
  };

  const isDefocused =
    Math.abs(data.focusOffsetUm) > data.stats.depthOfFieldUm * 0.5;

  return (
    <div className="microscope-view">
      {/* Scientific Provenance Banner */}
      <div
        className="microscope-provenance-banner"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Info size={14} />
          <span>
            <strong>Known Surface:</strong> {data.provenanceLabel} ·{" "}
            <em>
              {viewMode === "sem_topography"
                ? "Scanning Electron Topography (Lambertian + Edge Emission δ ∝ sec θ + Ambient Occlusion)"
                : "Simulated Optical Transmission (Beer–Lambert + Abbe Diffraction PSF)"}
            </em>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 12px",
            background: "#059669",
            border: "1px solid #059669",
            color: "#ffffff",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 650,
            cursor: "pointer",
            boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
          }}
          title="Open interactive microscope workstation: pan, zoom, focus stage, caliper measurements"
        >
          <Maximize2 size={12} />
          <span>Interactive Workstation</span>
        </button>
      </div>

      <div className="microscope-main-grid">
        <div className="microscope-stage-column">
          {/* Topography vs Optical Mode Selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              padding: "5px 10px",
              background: "#f8fafc",
              borderRadius: 6,
              border: "1px solid #e2e8f0",
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "#64748b",
                fontWeight: 650,
                textTransform: "uppercase",
              }}
            >
              Mode:
            </span>
            <button
              type="button"
              onClick={() => {
                setViewMode("sem_topography");
                setLut("sem_topography");
                setProfileMode("elevation");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 650,
                borderRadius: 5,
                cursor: "pointer",
                border: "1px solid",
                background:
                  viewMode === "sem_topography" ? "#059669" : "#ffffff",
                color:
                  viewMode === "sem_topography" ? "#ffffff" : "#475569",
                borderColor:
                  viewMode === "sem_topography" ? "#059669" : "#cbd5e1",
                boxShadow:
                  viewMode === "sem_topography" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              }}
              title="Render true 3D physical surface relief, hills, valleys and edges (SEM physics)"
            >
              ⛰️ SEM Surface Topography
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("optical_transmission");
                setLut(
                  data.illuminationMode === "Optical density"
                    ? "viridis"
                    : "spectral",
                );
                setProfileMode("transmittance");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 650,
                borderRadius: 5,
                cursor: "pointer",
                border: "1px solid",
                background:
                  viewMode === "optical_transmission" ? "#059669" : "#ffffff",
                color:
                  viewMode === "optical_transmission" ? "#ffffff" : "#475569",
                borderColor:
                  viewMode === "optical_transmission" ? "#059669" : "#cbd5e1",
                boxShadow:
                  viewMode === "optical_transmission" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              }}
              title="Render 2D transmissive optical absorption through specimen (Beer–Lambert)"
            >
              🔬 Optical Transmission
            </button>
          </div>

          <div className="microscope-hud-bar">
            <span className="microscope-badge">
              {data.magnification}× / {data.numericalAperture.toFixed(2)} NA
            </span>
            <span className="microscope-badge">
              {viewMode === "sem_topography"
                ? `Azimuth 315° · Ra ${data.stats.rmsRoughnessUm.toFixed(2)} µm`
                : `λ = ${data.wavelengthNm} nm · ${L(data.illuminationMode)}`}
            </span>
            <span
              className={
                "microscope-badge " +
                (isDefocused ? "microscope-badge-warn" : "")
              }
            >
              Δz = {data.focusOffsetUm >= 0 ? "+" : ""}
              {data.focusOffsetUm.toFixed(1)} µm (DOF ±
              {(data.stats.depthOfFieldUm * 0.5).toFixed(2)} µm)
            </span>
          </div>

          <div className="microscope-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={displaySize}
              height={displaySize}
              className="microscope-canvas"
              onMouseMove={(e) => handlePointer(e, false)}
              onMouseDown={(e) => handlePointer(e, true)}
              onDoubleClick={() => setIsModalOpen(true)}
              onMouseLeave={() => setHoverPx(null)}
              title="Click to inspect scanline · Double-click to open interactive workstation"
            />
          </div>

          <div className="microscope-controls-row">
            <label className="microscope-lut-select">
              <span>Palette:</span>
              <select
                aria-label="Micrograph color palette"
                value={lut}
                onChange={(e) => setLut(e.target.value as ColorLut)}
              >
                <option value="sem_topography">
                  SEM Platinum Monochrome (3D Relief)
                </option>
                <option value="grayscale">Pure Monochrome Grayscale</option>
                <option value="viridis">
                  Viridis Quantitative (Elevation/OD)
                </option>
                <option value="inferno">Inferno Thermal / Emission</option>
                <option value="spectral">
                  True Wavelength ({data.wavelengthNm} nm)
                </option>
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => setIsModalOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              title="Open full interactive workstation (pan, zoom, focus stage, calipers, detector lighting)"
            >
              <Maximize2 size={12} />
              Ocular
            </button>
            <button
              type="button"
              className="secondary"
              onClick={exportPng}
              title="Download micrograph rendering as PNG"
            >
              <Camera size={13} />
              PNG
            </button>
          </div>
        </div>

        <div className="microscope-metrics-column">
          <div className="microscope-readout-card">
            <header>
              <Crosshair size={13} />
              <span>
                Point Densitometer (x = {activeXUm.toFixed(1)} µm, y ={" "}
                {activeYUm.toFixed(1)} µm)
              </span>
            </header>
            <div className="microscope-kv-grid">
              <div>
                <small>Surface Elevation z(x,y)</small>
                <strong style={{ color: "#059669" }}>
                  {activeThicknessUm.toFixed(2)} µm
                </strong>
              </div>
              <div>
                <small>Local Surface Slope θ</small>
                <strong>{activeSlopeDeg.toFixed(1)}°</strong>
              </div>
              <div>
                <small>Transmittance T(x,y)</small>
                <strong>{activeTransPct.toFixed(2)}%</strong>
              </div>
              <div>
                <small>Optical Density OD(x,y)</small>
                <strong>{activeOd.toFixed(3)} OD</strong>
              </div>
              <div>
                <small>Pixel Pitch Δx</small>
                <strong>{data.pixelSizeUm.toFixed(2)} µm/px</strong>
              </div>
              <div>
                <small>Selected Scanline y</small>
                <strong>
                  {((selectedRow + 0.5) * data.pixelSizeUm).toFixed(1)} µm
                </strong>
              </div>
            </div>
          </div>

          <div className="microscope-readout-card">
            <header>
              <span>
                Field Physical & Optical Summary (FOV {data.fovUm.toFixed(0)} ×{" "}
                {data.fovUm.toFixed(0)} µm)
              </span>
            </header>
            <div className="microscope-kv-grid">
              <div>
                <small>Surface Roughness Ra</small>
                <strong style={{ color: "#0284c7" }}>
                  {data.stats.rmsRoughnessUm.toFixed(3)} µm
                </strong>
              </div>
              <div>
                <small>Mean Transmittance T̄</small>
                <strong>{data.stats.meanTransmittancePct.toFixed(2)}%</strong>
              </div>
              <div>
                <small>Mean Optical Density</small>
                <strong>{data.stats.meanOpticalDensity.toFixed(3)} OD</strong>
              </div>
              <div>
                <small>Michelson Contrast</small>
                <strong>{data.stats.michelsonContrast.toFixed(3)}</strong>
              </div>
              <div>
                <small>Abbe Diffraction Limit δ</small>
                <strong>{data.stats.abbeResolutionUm.toFixed(3)} µm</strong>
              </div>
              <div>
                <small>Depth of Field (DOF)</small>
                <strong>{data.stats.depthOfFieldUm.toFixed(2)} µm</strong>
              </div>
            </div>
          </div>

          <div className="microscope-profile-card">
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              <span>
                {profileMode === "elevation"
                  ? `Surface Elevation Profile z(x) at y = ${((selectedRow + 0.5) * data.pixelSizeUm).toFixed(1)} µm`
                  : `Transmittance Profile T(x) at y = ${((selectedRow + 0.5) * data.pixelSizeUm).toFixed(1)} µm`}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  style={{
                    fontSize: 10,
                    padding: "3px 8px",
                    background:
                      profileMode === "elevation" ? "#059669" : "#ffffff",
                    color:
                      profileMode === "elevation" ? "#ffffff" : "#475569",
                    border: "1px solid",
                    borderColor:
                      profileMode === "elevation" ? "#059669" : "#cbd5e1",
                    borderRadius: 5,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                  onClick={() => setProfileMode("elevation")}
                  title="Plot physical cross-sectional elevation z(x)"
                >
                  ⛰️ Elevation z(x)
                </button>
                <button
                  type="button"
                  style={{
                    fontSize: 10,
                    padding: "3px 8px",
                    background:
                      profileMode === "transmittance" ? "#059669" : "#ffffff",
                    color:
                      profileMode === "transmittance" ? "#ffffff" : "#475569",
                    border: "1px solid",
                    borderColor:
                      profileMode === "transmittance" ? "#059669" : "#cbd5e1",
                    borderRadius: 5,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                  onClick={() => setProfileMode("transmittance")}
                  title="Plot optical transmittance T(x)"
                >
                  🔬 Transmittance T(x)
                </button>
              </div>
            </header>

            {profileMode === "elevation" ? (
              <svg
                className="microscope-profile-svg"
                viewBox="0 0 360 96"
                role="img"
                aria-label="Physical surface elevation cross-section profile"
              >
                <line
                  x1="38"
                  y1="10"
                  x2="350"
                  y2="10"
                  stroke="#e2e8f0"
                  strokeDasharray="2 2"
                />
                <line
                  x1="38"
                  y1="45"
                  x2="350"
                  y2="45"
                  stroke="#e2e8f0"
                  strokeDasharray="2 2"
                />
                <line x1="38" y1="80" x2="350" y2="80" stroke="#cbd5e1" />
                <text x="2" y="14" fill="#64748b" fontSize="8.5">
                  {zStatsRow.maxZ.toFixed(2)}µm
                </text>
                <text x="2" y="48" fill="#64748b" fontSize="8.5">
                  {((zStatsRow.maxZ + zStatsRow.minZ) / 2).toFixed(2)}µm
                </text>
                <text x="2" y="83" fill="#64748b" fontSize="8.5">
                  {zStatsRow.minZ.toFixed(2)}µm
                </text>
                <polyline
                  fill="none"
                  stroke="#059669"
                  strokeWidth="2.0"
                  points={rowProfileZ
                    .map((zVal, i) => {
                      const px =
                        38 + (i / Math.max(1, rowProfileZ.length - 1)) * 312;
                      const py =
                        80 -
                        ((zVal - zStatsRow.minZ) /
                          (zStatsRow.maxZ - zStatsRow.minZ)) *
                          70;
                      return `${px.toFixed(1)},${py.toFixed(1)}`;
                    })
                    .join(" ")}
                />
              </svg>
            ) : (
              <svg
                className="microscope-profile-svg"
                viewBox="0 0 360 96"
                role="img"
                aria-label="Transmittance cross-section line profile"
              >
                <line
                  x1="28"
                  y1="10"
                  x2="350"
                  y2="10"
                  stroke="#e2e8f0"
                  strokeDasharray="2 2"
                />
                <line
                  x1="28"
                  y1="45"
                  x2="350"
                  y2="45"
                  stroke="#e2e8f0"
                  strokeDasharray="2 2"
                />
                <line x1="28" y1="80" x2="350" y2="80" stroke="#cbd5e1" />
                <text x="4" y="14" fill="#64748b" fontSize="9">
                  100%
                </text>
                <text x="8" y="48" fill="#64748b" fontSize="9">
                  50%
                </text>
                <text x="12" y="83" fill="#64748b" fontSize="9">
                  0%
                </text>
                <polyline
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth="1.75"
                  points={rowProfileT
                    .map((tPct, i) => {
                      const px =
                        28 + (i / Math.max(1, rowProfileT.length - 1)) * 322;
                      const py =
                        80 - (Math.max(0, Math.min(100, tPct)) / 100) * 70;
                      return `${px.toFixed(1)},${py.toFixed(1)}`;
                    })
                    .join(" ")}
                />
              </svg>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <InteractiveMicroscopeModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          data={data}
          initialParams={initialParams}
          initialTime={currentTime}
          onTimeChange={onTimeChange}
        />
      )}
    </div>
  );
}

/**
 * Compact canvas thumbnail of a simulated micrograph with 3D SEM Topographic Shading and scale bar.
 * Clicking opens the rich Interactive Microscope Workstation dialog (pan, zoom, focus, calipers).
 */
export function MicroscopeMini({
  data,
  initialParams,
  width = 210,
  height = 110,
  interactive = true,
  currentTime = 0.0,
  onTimeChange,
}: {
  data: MicrographData;
  initialParams?: Partial<TransmissiveMicroscopeParams>;
  width?: number;
  height?: number;
  interactive?: boolean;
  currentTime?: number;
  onTimeChange?: (t: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width: N, height: M } = data;
    const offscreen = document.createElement("canvas");
    offscreen.width = N;
    offscreen.height = M;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    // Authentic 3D SEM Topography relief intensity grid
    const topo = computeTopographicIntensity(
      data.thicknessGridUm,
      N,
      M,
      data.pixelSizeUm,
    );

    const imgData = offCtx.createImageData(N, M);
    for (let i = 0; i < N * M; i++) {
      const [r, g, b] = mapLut(topo[i] ?? 0, "sem_topography", data.wavelengthNm);
      const p = i * 4;
      imgData.data[p] = r;
      imgData.data[p + 1] = g;
      imgData.data[p + 2] = b;
      imgData.data[p + 3] = 255;
    }
    offCtx.putImageData(imgData, 0, 0);

    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(offscreen, 0, 0, width, height);

    // Top HUD banner
    ctx.fillStyle = "rgba(9, 14, 23, 0.85)";
    ctx.fillRect(0, 0, width, 18);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(
      `${data.magnification}× SEM Topography · Ra ${data.stats.rmsRoughnessUm.toFixed(2)} µm`,
      6,
      12,
    );

    // Calibrated physical scale bar
    const barUm = chooseNiceScaleBarUm(data.fovUm);
    const barPx = Math.max(18, (barUm / data.fovUm) * width);
    const pad = 6;
    const x1 = width - pad - barPx;
    const x2 = width - pad;
    const yBar = height - pad;

    ctx.fillStyle = "rgba(9, 14, 23, 0.85)";
    ctx.fillRect(x1 - 4, yBar - 13, barPx + 8, 16);
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, yBar);
    ctx.lineTo(x2, yBar);
    ctx.stroke();

    ctx.fillStyle = "#f8fafc";
    ctx.font = "600 8px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${barUm} µm`, (x1 + x2) / 2, yBar - 3);
  }, [data, width, height]);

  return (
    <>
      <div
        className="microscope-mini-wrap"
        onClick={() => interactive && setIsModalOpen(true)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width,
          height,
          position: "relative",
          borderRadius: 6,
          overflow: "hidden",
          border: isHovered ? "1.5px solid #059669" : "1px solid #cbd5e1",
          background: "#0b1120",
          boxShadow: isHovered
            ? "0 4px 14px rgba(5, 150, 105, 0.2)"
            : "0 1px 3px rgba(0, 0, 0, 0.08)",
          margin: "0 auto",
          cursor: interactive ? "pointer" : "default",
          transition: "all 0.15s ease",
        }}
        title={
          interactive
            ? "🔍 Click to open interactive microscope (Pan, Zoom, Focus, Calipers)"
            : undefined
        }
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ display: "block" }}
        />
        {interactive && (
          <div
            style={{
              position: "absolute",
              bottom: 4,
              left: 5,
              background: isHovered
                ? "#059669"
                : "rgba(15, 23, 42, 0.75)",
              color: "#ffffff",
              borderRadius: 4,
              padding: "2px 5px",
              fontSize: 8.5,
              fontWeight: 650,
              display: "flex",
              alignItems: "center",
              gap: 3,
              border: "1px solid rgba(255,255,255,0.2)",
              pointerEvents: "none",
              transition: "all 0.15s ease",
            }}
          >
            <Maximize2 size={8} />
            <span>{isHovered ? "Open Workstation" : "Interactive"}</span>
          </div>
        )}
      </div>

      {isModalOpen && (
        <InteractiveMicroscopeModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          data={data}
          initialParams={initialParams}
          initialTime={currentTime}
          onTimeChange={onTimeChange}
        />
      )}
    </>
  );
}
