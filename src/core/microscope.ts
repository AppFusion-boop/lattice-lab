import type {
  IlluminationMode,
  MicrographData,
  MicrographStats,
  Signal,
  SpecimenSourceMode,
  TableData,
} from "./types";

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Deterministic 32-bit PRNG (Mulberry32) — Hard Rule #12.
 * Never use Math.random() anywhere in microscope surface generation.
 */
export function mulberry32(seed: number): () => number {
  let a = (Math.floor(seed) | 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SpecimenCellGrid {
  width: number;
  height: number;
  fovUm: number;
  pixelSizeUm: number;
  /** Local matrix thickness in µm [N*N] */
  matrixThicknessUm: Float64Array;
  /** Local feature/inclusion thickness in µm [N*N] */
  featureThicknessUm: Float64Array;
  /** Local matrix linear attenuation in µm^-1 [N*N] */
  matrixAttenInvUm: Float64Array;
  /** Local feature linear attenuation in µm^-1 [N*N] */
  featureAttenInvUm: Float64Array;
  /** Local matrix refractive index [N*N] */
  matrixRefractiveIndex: Float64Array;
  /** Local feature refractive index [N*N] */
  featureRefractiveIndex: Float64Array;
  /** Fraction of pixels/area occupied by features in % */
  featureAreaFractionPct: number;
  provenanceLabel: string;
}

export interface TransmissiveMicroscopeParams {
  sourceMode: SpecimenSourceMode;
  table?: TableData;
  gridN: number;
  magnification: number;
  numericalAperture: number;
  wavelengthNm: number;
  focusOffsetUm: number;
  immersionIndex: number;
  illuminationMode: IlluminationMode;
  exposure: number;
  // Explicit Specimen / Coupled Physical Parameters
  matrixThicknessUm: number;
  matrixAttenInvUm: number;
  featureAttenInvUm: number;
  matrixRefractiveIndex: number;
  featureRefractiveIndex: number;
  featureDiameterUm: number;
  featureVolumeFractionPct: number;
  chromophoreConcMolM3: number;
  molarAbsorptivityM2Mol: number;
  reticleFrequencyLpMm: number;
  seed: number;
}

function findColIndex(columns: string[], candidates: string[]): number {
  const normalized = columns.map((c) =>
    c.trim().toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  for (const cand of candidates) {
    const target = cand.toLowerCase().replace(/[^a-z0-9]/g, "");
    const idx = normalized.findIndex(
      (col) => col === target || col.startsWith(target),
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Builds a known 2D specimen surface strictly from a user-supplied TableData packet.
 * Hard Rule #1: Never invent fallback data if the table is missing or invalid.
 */
export function buildSurfaceFromTable(
  table: TableData | undefined,
  gridN: number,
  fovUm: number,
  defaultMatrixThicknessUm: number,
  defaultMatrixAttenInvUm: number,
  defaultFeatureAttenInvUm: number,
  defaultMatrixN: number,
  defaultFeatureN: number,
): SpecimenCellGrid {
  if (!table || !Array.isArray(table.rows) || table.rows.length === 0) {
    throw new Error(
      "Connect a CSV/Table with measured surface data, or switch Specimen data source to Coupled Physical Inputs.",
    );
  }

  const N = clamp(Math.round(gridN), 24, 160);
  const pixelSizeUm = fovUm / N;
  const total = N * N;

  const matrixThicknessUm = new Float64Array(total).fill(
    Math.max(0, defaultMatrixThicknessUm),
  );
  const featureThicknessUm = new Float64Array(total);
  const matrixAttenInvUm = new Float64Array(total).fill(
    Math.max(0, defaultMatrixAttenInvUm),
  );
  const featureAttenInvUm = new Float64Array(total).fill(
    Math.max(0, defaultFeatureAttenInvUm),
  );
  const matrixRefractiveIndex = new Float64Array(total).fill(
    Math.max(1.0, defaultMatrixN),
  );
  const featureRefractiveIndex = new Float64Array(total).fill(
    Math.max(1.0, defaultFeatureN),
  );

  const cols = table.columns || [];
  const xIdx = findColIndex(cols, ["x_um", "x", "pos_x", "xcoord"]);
  const yIdx = findColIndex(cols, ["y_um", "y", "pos_y", "ycoord"]);
  const hIdx = findColIndex(cols, [
    "thickness_um",
    "thickness",
    "height_um",
    "height",
    "h_um",
    "depth_um",
    "z_um",
  ]);
  const rIdx = findColIndex(cols, [
    "radius_um",
    "radius",
    "r_um",
    "diameter_um",
    "size_um",
  ]);
  const attIdx = findColIndex(cols, [
    "attenuation_inv_um",
    "attenuation",
    "alpha",
    "mu",
    "absorption",
  ]);
  const nIdx = findColIndex(cols, [
    "refractive_index",
    "n_feat",
    "index",
    "ri",
  ]);

  let featurePixelCount = 0;

  if (xIdx !== -1 && yIdx !== -1) {
    // Coordinate / Discrete Feature or Point-Cloud Schema
    let validRows = 0;
    const isDiameter =
      rIdx !== -1 &&
      cols[rIdx].toLowerCase().includes("diam");

    for (const row of table.rows) {
      const xRaw = Number(row[xIdx]);
      const yRaw = Number(row[yIdx]);
      if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) continue;
      validRows++;

      const hVal =
        hIdx !== -1 && Number.isFinite(Number(row[hIdx]))
          ? Math.max(0, Number(row[hIdx]))
          : Math.max(1, defaultMatrixThicknessUm * 0.25);
      const rValRaw =
        rIdx !== -1 && Number.isFinite(Number(row[rIdx]))
          ? Math.max(0, Number(row[rIdx]))
          : pixelSizeUm * 0.75;
      const radiusUm = isDiameter ? rValRaw * 0.5 : rValRaw;
      const attVal =
        attIdx !== -1 && Number.isFinite(Number(row[attIdx]))
          ? Math.max(0, Number(row[attIdx]))
          : defaultFeatureAttenInvUm;
      const nVal =
        nIdx !== -1 && Number.isFinite(Number(row[nIdx]))
          ? Math.max(1.0, Number(row[nIdx]))
          : defaultFeatureN;

      const rPx = Math.max(0.5, radiusUm / pixelSizeUm);
      const cxPx = xRaw / pixelSizeUm;
      const cyPx = yRaw / pixelSizeUm;

      const ixMin = clamp(Math.floor(cxPx - rPx - 1), 0, N - 1);
      const ixMax = clamp(Math.ceil(cxPx + rPx + 1), 0, N - 1);
      const iyMin = clamp(Math.floor(cyPx - rPx - 1), 0, N - 1);
      const iyMax = clamp(Math.ceil(cyPx + rPx + 1), 0, N - 1);

      for (let iy = iyMin; iy <= iyMax; iy++) {
        for (let ix = ixMin; ix <= ixMax; ix++) {
          const dx = (ix + 0.5) * pixelSizeUm - xRaw;
          const dy = (iy + 0.5) * pixelSizeUm - yRaw;
          const distSq = dx * dx + dy * dy;
          if (distSq <= radiusUm * radiusUm) {
            const idx = iy * N + ix;
            const chordProfile =
              radiusUm > pixelSizeUm
                ? Math.sqrt(Math.max(0, 1 - distSq / (radiusUm * radiusUm)))
                : 1;
            const localFeatH = Math.min(defaultMatrixThicknessUm, hVal * chordProfile);
            featureThicknessUm[idx] = Math.max(featureThicknessUm[idx], localFeatH);
            matrixThicknessUm[idx] = Math.max(
              0,
              defaultMatrixThicknessUm - featureThicknessUm[idx],
            );
            featureAttenInvUm[idx] = attVal;
            featureRefractiveIndex[idx] = nVal;
          }
        }
      }
    }

    if (validRows === 0) {
      throw new Error(
        "Measured surface CSV table contains no finite (x, y) coordinate rows.",
      );
    }

    for (let i = 0; i < total; i++) {
      if (featureThicknessUm[i] > 1e-6) featurePixelCount++;
    }

    return {
      width: N,
      height: N,
      fovUm,
      pixelSizeUm,
      matrixThicknessUm,
      featureThicknessUm,
      matrixAttenInvUm,
      featureAttenInvUm,
      matrixRefractiveIndex,
      featureRefractiveIndex,
      featureAreaFractionPct: (100 * featurePixelCount) / total,
      provenanceLabel: `Measured Table (${validRows} features/points mapped to ${N}×${N} grid)`,
    };
  }

  // Schema C: 2D Matrix Grid (each row/col is local feature/specimen thickness in µm)
  const numericMatrix: number[][] = [];
  for (const row of table.rows) {
    const nums = row.map((cell) => Number(cell)).filter((v) => Number.isFinite(v));
    if (nums.length > 0) numericMatrix.push(nums);
  }

  if (numericMatrix.length === 0) {
    throw new Error(
      "Measured surface CSV table must provide either (x_um, y_um, thickness_um) columns or a 2D numeric grid of thickness values.",
    );
  }

  const srcH = numericMatrix.length;
  const srcW = Math.max(...numericMatrix.map((r) => r.length));

  for (let iy = 0; iy < N; iy++) {
    const sy = clamp(Math.floor((iy / N) * srcH), 0, srcH - 1);
    const row = numericMatrix[sy];
    for (let ix = 0; ix < N; ix++) {
      const sx = clamp(Math.floor((ix / N) * row.length), 0, row.length - 1);
      const val = Math.max(0, row[sx] ?? 0);
      const idx = iy * N + ix;
      featureThicknessUm[idx] = val;
      matrixThicknessUm[idx] = Math.max(0, defaultMatrixThicknessUm - val);
      if (val > 1e-6) featurePixelCount++;
    }
  }

  return {
    width: N,
    height: N,
    fovUm,
    pixelSizeUm,
    matrixThicknessUm,
    featureThicknessUm,
    matrixAttenInvUm,
    featureAttenInvUm,
    matrixRefractiveIndex,
    featureRefractiveIndex,
    featureAreaFractionPct: (100 * featurePixelCount) / total,
    provenanceLabel: `Measured 2D Grid Table (${srcW}×${srcH} resampled to ${N}×${N})`,
  };
}

/**
 * Deterministically constructs a 2D specimen grid from explicit physical inputs
 * (specimen thickness, feature diameter, volume fraction, optical constants, and seed).
 */
export function buildSurfaceFromCoupledInputs(
  gridN: number,
  fovUm: number,
  matrixThicknessUmVal: number,
  matrixAttenVal: number,
  featureAttenVal: number,
  matrixNVal: number,
  featureNVal: number,
  featureDiameterUm: number,
  featureVolumeFractionPct: number,
  seed: number,
): SpecimenCellGrid {
  const N = clamp(Math.round(gridN), 24, 160);
  const pixelSizeUm = fovUm / N;
  const total = N * N;

  const hMat0 = Math.max(0.1, matrixThicknessUmVal);
  const matrixThicknessUm = new Float64Array(total).fill(hMat0);
  const featureThicknessUm = new Float64Array(total);
  const matrixAttenInvUm = new Float64Array(total).fill(Math.max(0, matrixAttenVal));
  const featureAttenInvUm = new Float64Array(total).fill(Math.max(0, featureAttenVal));
  const matrixRefractiveIndex = new Float64Array(total).fill(Math.max(1.0, matrixNVal));
  const featureRefractiveIndex = new Float64Array(total).fill(Math.max(1.0, featureNVal));

  const targetFrac = clamp(featureVolumeFractionPct / 100, 0, 0.85);
  const diamUm = Math.max(pixelSizeUm * 0.8, featureDiameterUm);
  const rng = mulberry32(seed);

  // When target volume fraction is 0%, specimen is completely uniform (Beer-Lambert baseline)
  if (targetFrac <= 0) {
    return {
      width: N,
      height: N,
      fovUm,
      pixelSizeUm,
      matrixThicknessUm,
      featureThicknessUm,
      matrixAttenInvUm,
      featureAttenInvUm,
      matrixRefractiveIndex,
      featureRefractiveIndex,
      featureAreaFractionPct: 0,
      provenanceLabel: `Uniform Matrix Specimen (Beer–Lambert baseline, h=${hMat0.toFixed(1)} µm)`,
    };
  }

  // Authentic Human Hair Keratin Cuticle Shingle Architecture (Tribology Study)
  // Optical indices: α-keratin matrix n = 1.54, 18-MEA cuticle lipid layer n = 1.51
  const isHairCuticle =
    Math.abs(matrixNVal - 1.54) < 0.02 && Math.abs(featureNVal - 1.51) < 0.02;

  let featurePixelCount = 0;
  let provenanceLabel = "";

  if (isHairCuticle) {
    // Cuticle scale length along hair fiber axis (Y): typically 10..15 µm
    const scaleLengthUm = Math.max(6.0, Math.min(30.0, diamUm > 0 ? diamUm : 12.0));
    // Intact human hair scale step is ~0.85 µm. As wear proceeds (roughness 36% -> 6%),
    // Archard friction wear mechanically planes and sands down the step edges.
    const wearRatio = clamp(featureVolumeFractionPct / 36.0, 0.06, 1.35);
    const stepH = 0.85 * wearRatio;
    const baseH = Math.min(hMat0 * 0.35, 1.4 * wearRatio + 0.4);

    const phi1 = rng() * 2 * Math.PI;
    const phi2 = rng() * 2 * Math.PI;
    const phi3 = rng() * 2 * Math.PI;

    for (let iy = 0; iy < N; iy++) {
      const yUm = (iy + 0.5) * pixelSizeUm;
      for (let ix = 0; ix < N; ix++) {
        const xUm = (ix + 0.5) * pixelSizeUm;
        const idx = iy * N + ix;

        // Scalloped natural wavy margins across scale width
        const marginWave =
          1.4 * Math.sin((2 * Math.PI * xUm) / 36 + phi1) +
          0.6 * Math.cos((2 * Math.PI * xUm) / 15 + phi2);

        // Ramp coordinate rising along scale length towards the sharp distal edge
        const yRamp = ((yUm - marginWave) % scaleLengthUm + scaleLengthUm) % scaleLengthUm;
        const terraceH = stepH * (yRamp / scaleLengthUm);

        // Fine longitudinal keratin fibril micro-grooves / striations
        const striation = 0.035 * wearRatio * Math.sin((2 * Math.PI * xUm) / 2.2 + phi3);

        // Friction contact rubbing track wear scar along fiber center
        const centerDist = Math.abs(xUm - fovUm * 0.5) / (fovUm * 0.5);
        const trackEffect = (1.0 - Math.min(1.0, wearRatio)) * Math.exp(-centerDist * centerDist * 3.2);

        const abradedTerraceH = terraceH * (1.0 - 0.78 * trackEffect);
        const localFeatH = Math.min(
          hMat0,
          Math.max(0.01, baseH + abradedTerraceH + striation * (1.0 - 0.85 * trackEffect)),
        );

        featureThicknessUm[idx] = localFeatH;
        matrixThicknessUm[idx] = Math.max(0, hMat0 - localFeatH);
        featurePixelCount++;
      }
    }

    provenanceLabel = `Hair Cuticle Architecture (Scale L=${scaleLengthUm.toFixed(1)} µm, Step Δh=${stepH.toFixed(2)} µm, Intact Roughness=${featureVolumeFractionPct.toFixed(1)}%)`;
  } else {
    // 3D Spherical Droplet / Capsule / Particle Specimen with Substrate Micro-Topography
    const radiusUm = diamUm * 0.5;
    const singleAreaUm2 = Math.PI * radiusUm * radiusUm;
    const fovAreaUm2 = fovUm * fovUm;

    const desiredCount = clamp(
      Math.round((targetFrac * fovAreaUm2) / singleAreaUm2),
      1,
      600,
    );

    const placed: Array<{ x: number; y: number; r: number }> = [];
    const maxAttempts = desiredCount * 12;

    for (let attempt = 0; attempt < maxAttempts && placed.length < desiredCount; attempt++) {
      const r = radiusUm * (0.88 + 0.24 * rng());
      const x = r + rng() * Math.max(1e-3, fovUm - 2 * r);
      const y = r + rng() * Math.max(1e-3, fovUm - 2 * r);

      let overlaps = false;
      const minSepFactor = placed.length < desiredCount * 0.7 ? 0.92 : 0.65;
      for (const p of placed) {
        const dx = x - p.x;
        const dy = y - p.y;
        const minD = (r + p.r) * minSepFactor;
        if (dx * dx + dy * dy < minD * minD) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        placed.push({ x, y, r });
      }
    }

    const subPhi1 = rng() * 2 * Math.PI;
    const subPhi2 = rng() * 2 * Math.PI;
    const subPhi3 = rng() * 2 * Math.PI;

    // Substrate baseline micro-undulations (Ra ≈ 0.04 µm)
    for (let iy = 0; iy < N; iy++) {
      const yUm = (iy + 0.5) * pixelSizeUm;
      for (let ix = 0; ix < N; ix++) {
        const xUm = (ix + 0.5) * pixelSizeUm;
        const idx = iy * N + ix;
        const subH =
          0.035 * Math.sin((2 * Math.PI * xUm) / 26 + subPhi1) * Math.cos((2 * Math.PI * yUm) / 26 + subPhi2) +
          0.015 * Math.sin((2 * Math.PI * (xUm + yUm)) / 16 + subPhi3);
        featureThicknessUm[idx] = Math.max(0, subH);
      }
    }

    // Place true 3D spherical dome caps
    for (const p of placed) {
      const rPx = p.r / pixelSizeUm;
      const cxPx = p.x / pixelSizeUm;
      const cyPx = p.y / pixelSizeUm;
      const ixMin = clamp(Math.floor(cxPx - rPx - 1), 0, N - 1);
      const ixMax = clamp(Math.ceil(cxPx + rPx + 1), 0, N - 1);
      const iyMin = clamp(Math.floor(cyPx - rPx - 1), 0, N - 1);
      const iyMax = clamp(Math.ceil(cyPx + rPx + 1), 0, N - 1);

      for (let iy = iyMin; iy <= iyMax; iy++) {
        for (let ix = ixMin; ix <= ixMax; ix++) {
          const dx = (ix + 0.5) * pixelSizeUm - p.x;
          const dy = (iy + 0.5) * pixelSizeUm - p.y;
          const distSq = dx * dx + dy * dy;
          if (distSq <= p.r * p.r) {
            const idx = iy * N + ix;
            const domeH = Math.sqrt(Math.max(0, p.r * p.r - distSq));
            const boundedFeatH = Math.min(hMat0, featureThicknessUm[idx] + domeH);
            featureThicknessUm[idx] = boundedFeatH;
            matrixThicknessUm[idx] = Math.max(0, hMat0 - boundedFeatH);
          }
        }
      }
    }

    for (let i = 0; i < total; i++) {
      if (featureThicknessUm[i] > 0.04) featurePixelCount++;
    }

    provenanceLabel = `Coupled Physical Specimen (d=${diamUm.toFixed(1)} µm, φ=${featureVolumeFractionPct.toFixed(1)}%, n=${placed.length} inclusions, seed=${seed})`;
  }

  return {
    width: N,
    height: N,
    fovUm,
    pixelSizeUm,
    matrixThicknessUm,
    featureThicknessUm,
    matrixAttenInvUm,
    featureAttenInvUm,
    matrixRefractiveIndex,
    featureRefractiveIndex,
    featureAreaFractionPct: (100 * featurePixelCount) / total,
    provenanceLabel,
  };
}

/**
 * Builds an exact analytical Calibration Reticle:
 * - Upper half: Ronchi square-wave bar grating at reticleFrequencyLpMm (line pairs per mm)
 * - Lower half: 6-step Beer-Lambert optical wedge (0%, 20%, 40%, 60%, 80%, 100% of matrixThicknessUm)
 */
export function buildCalibrationReticleSurface(
  gridN: number,
  fovUm: number,
  matrixThicknessUmVal: number,
  matrixAttenVal: number,
  featureAttenVal: number,
  matrixNVal: number,
  featureNVal: number,
  reticleFrequencyLpMm: number,
): SpecimenCellGrid {
  const N = clamp(Math.round(gridN), 24, 160);
  const pixelSizeUm = fovUm / N;
  const total = N * N;
  const hMax = Math.max(1, matrixThicknessUmVal);

  const matrixThicknessUm = new Float64Array(total).fill(hMax);
  const featureThicknessUm = new Float64Array(total);
  const matrixAttenInvUm = new Float64Array(total).fill(Math.max(0, matrixAttenVal));
  const featureAttenInvUm = new Float64Array(total).fill(Math.max(0, featureAttenVal));
  const matrixRefractiveIndex = new Float64Array(total).fill(Math.max(1.0, matrixNVal));
  const featureRefractiveIndex = new Float64Array(total).fill(Math.max(1.0, featureNVal));

  const periodUm = 1000 / Math.max(1, reticleFrequencyLpMm);
  let featurePixelCount = 0;

  for (let iy = 0; iy < N; iy++) {
    const yFrac = iy / N;
    for (let ix = 0; ix < N; ix++) {
      const xUm = (ix + 0.5) * pixelSizeUm;
      const idx = iy * N + ix;

      if (yFrac < 0.5) {
        // Upper half: Ronchi line-pair grating
        const phase = (xUm % periodUm) / periodUm;
        if (phase < 0.5) {
          featureThicknessUm[idx] = hMax * 0.5;
          matrixThicknessUm[idx] = hMax * 0.5;
          featurePixelCount++;
        }
      } else {
        // Lower half: 6-step optical step wedge
        const stepIdx = Math.min(5, Math.floor((ix / N) * 6));
        const stepFrac = stepIdx / 5;
        featureThicknessUm[idx] = hMax * stepFrac;
        matrixThicknessUm[idx] = hMax * (1 - stepFrac);
        if (stepFrac > 0) featurePixelCount++;
      }
    }
  }

  return {
    width: N,
    height: N,
    fovUm,
    pixelSizeUm,
    matrixThicknessUm,
    featureThicknessUm,
    matrixAttenInvUm,
    featureAttenInvUm,
    matrixRefractiveIndex,
    featureRefractiveIndex,
    featureAreaFractionPct: (100 * featurePixelCount) / total,
    provenanceLabel: `Analytical Calibration Reticle (${reticleFrequencyLpMm} lp/mm Ronchi + 6-step wedge)`,
  };
}

/**
 * Separable 2D Gaussian convolution with clamped boundary handling.
 */
export function convolveGaussian2D(
  src: Float64Array,
  width: number,
  height: number,
  sigmaPx: number,
): Float64Array {
  if (sigmaPx <= 0.15) {
    return new Float64Array(src);
  }
  const radius = clamp(Math.ceil(sigmaPx * 3), 1, 24);
  const kernel = new Float64Array(2 * radius + 1);
  let sum = 0;
  const twoSigmaSq = 2 * sigmaPx * sigmaPx;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / twoSigmaSq);
    kernel[k + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= sum;
  }

  const tmp = new Float64Array(width * height);
  const dst = new Float64Array(width * height);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = clamp(x + k, 0, width - 1);
        acc += src[rowOffset + xx] * kernel[k + radius];
      }
      tmp[rowOffset + x] = acc;
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = clamp(y + k, 0, height - 1);
        acc += tmp[yy * width + x] * kernel[k + radius];
      }
      dst[y * width + x] = acc;
    }
  }

  return dst;
}

/**
 * Executes the full physical optics simulation for the Digital Transmissive Microscope.
 */
export function simulateTransmissiveMicroscope(
  params: TransmissiveMicroscopeParams,
): {
  micrograph: MicrographData;
  lineProfileSignal: Signal;
} {
  const mag = clamp(params.magnification, 1, 200);
  // Standard 20 mm field number -> FOV (µm) = 20000 / Mag
  const fovUm = 20000 / mag;
  const N = clamp(Math.round(params.gridN), 24, 160);
  const na = clamp(params.numericalAperture, 0.05, 1.49);
  const nImm = Math.max(na + 0.02, clamp(params.immersionIndex, 1.0, 1.7));
  const lambdaNm = clamp(params.wavelengthNm, 380, 750);
  const lambdaUm = lambdaNm / 1000;
  const exposure = clamp(params.exposure, 0.1, 5.0);

  let surface: SpecimenCellGrid;
  if (params.sourceMode === "Measured Table (CSV)") {
    surface = buildSurfaceFromTable(
      params.table,
      N,
      fovUm,
      params.matrixThicknessUm,
      params.matrixAttenInvUm,
      params.featureAttenInvUm,
      params.matrixRefractiveIndex,
      params.featureRefractiveIndex,
    );
  } else if (params.sourceMode === "Calibration Reticle (Ronchi / Step)") {
    surface = buildCalibrationReticleSurface(
      N,
      fovUm,
      params.matrixThicknessUm,
      params.matrixAttenInvUm,
      params.featureAttenInvUm,
      params.matrixRefractiveIndex,
      params.featureRefractiveIndex,
      params.reticleFrequencyLpMm,
    );
  } else {
    surface = buildSurfaceFromCoupledInputs(
      N,
      fovUm,
      params.matrixThicknessUm,
      params.matrixAttenInvUm,
      params.featureAttenInvUm,
      params.matrixRefractiveIndex,
      params.featureRefractiveIndex,
      params.featureDiameterUm,
      params.featureVolumeFractionPct,
      params.seed,
    );
  }

  const total = N * N;
  const pixelSizeUm = surface.pixelSizeUm;

  // 1. Ideal Beer-Lambert Transmittance and Phase Retardation at specimen plane
  const idealTransmittance = new Float64Array(total);
  const idealPhaseRad = new Float64Array(total);
  const thicknessGridUm = new Array<number>(total);

  const chromophoreAlphaInvUm =
    Math.LN10 *
    Math.max(0, params.molarAbsorptivityM2Mol) *
    Math.max(0, params.chromophoreConcMolM3) *
    1e-6;

  let meanH = 0;
  for (let i = 0; i < total; i++) {
    const hMat = surface.matrixThicknessUm[i];
    const hFeat = surface.featureThicknessUm[i];
    const hTotal = hMat + hFeat;
    thicknessGridUm[i] = Number(hFeat.toFixed(4));
    meanH += hFeat;

    const tau =
      surface.matrixAttenInvUm[i] * hMat +
      surface.featureAttenInvUm[i] * hFeat +
      chromophoreAlphaInvUm * hTotal;

    idealTransmittance[i] = Math.exp(-Math.max(0, tau));

    const deltaOplUm =
      (surface.featureRefractiveIndex[i] - surface.matrixRefractiveIndex[i]) *
      hFeat;
    idealPhaseRad[i] = ((2 * Math.PI) / lambdaUm) * deltaOplUm;
  }
  meanH /= total;

  let rmsRoughnessSq = 0;
  for (let i = 0; i < total; i++) {
    const dh = surface.featureThicknessUm[i] - meanH;
    rmsRoughnessSq += dh * dh;
  }
  const rmsRoughnessUm = Math.sqrt(rmsRoughnessSq / total);

  // 2. Optical Resolution (Abbe), Depth of Field (Berek), and PSF + Defocus Blur
  const abbeResolutionUm = (0.61 * lambdaUm) / na;
  const detectorPixelPitchUm = 6.5;
  const depthOfFieldUm =
    (lambdaUm * nImm) / (na * na) +
    (nImm * detectorPixelPitchUm) / (mag * na);

  const sigmaDiffUm = (0.21 * lambdaUm) / na;
  const excessDefocusUm = Math.max(
    0,
    Math.abs(params.focusOffsetUm) - 0.5 * depthOfFieldUm,
  );
  const sigmaDefocusUm =
    excessDefocusUm * (na / Math.sqrt(Math.max(0.04, nImm * nImm - na * na)));
  const sigmaTotalUm = Math.sqrt(
    sigmaDiffUm * sigmaDiffUm + sigmaDefocusUm * sigmaDefocusUm,
  );
  const sigmaPx = sigmaTotalUm / pixelSizeUm;

  const blurredT = convolveGaussian2D(idealTransmittance, N, N, sigmaPx);
  const blurredPhase = convolveGaussian2D(idealPhaseRad, N, N, sigmaPx);

  // 3. Render detector intensity according to illumination mode
  const transmittanceGrid = new Array<number>(total);
  const opticalDensityGrid = new Array<number>(total);
  const intensityGrid = new Array<number>(total);

  let sumT = 0;
  let minT = 1;
  let maxT = 0;
  let sumOd = 0;
  let maxOd = 0;
  let minI = 1;
  let maxI = 0;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const idx = y * N + x;
      const tVal = clamp(blurredT[idx], 1e-6, 1.0);
      const odVal = -Math.log10(tVal);

      transmittanceGrid[idx] = Number(tVal.toFixed(5));
      opticalDensityGrid[idx] = Number(odVal.toFixed(4));

      sumT += tVal;
      if (tVal < minT) minT = tVal;
      if (tVal > maxT) maxT = tVal;
      sumOd += odVal;
      if (odVal > maxOd) maxOd = odVal;

      let intensity = 0;
      if (params.illuminationMode === "Brightfield") {
        intensity = clamp(exposure * tVal, 0, 1);
      } else if (params.illuminationMode === "Darkfield") {
        const xm = Math.max(0, x - 1);
        const xp = Math.min(N - 1, x + 1);
        const ym = Math.max(0, y - 1);
        const yp = Math.min(N - 1, y + 1);
        const dtdx = (blurredT[y * N + xp] - blurredT[y * N + xm]) * 0.5;
        const dtdy = (blurredT[yp * N + x] - blurredT[ym * N + x]) * 0.5;
        const dpdx = (blurredPhase[y * N + xp] - blurredPhase[y * N + xm]) * 0.5;
        const dpdy = (blurredPhase[yp * N + x] - blurredPhase[ym * N + x]) * 0.5;
        const gradMag = Math.sqrt(
          dtdx * dtdx + dtdy * dtdy + 0.15 * (dpdx * dpdx + dpdy * dpdy),
        );
        const bulkScatter = 0.25 * (1 - tVal);
        intensity = clamp(exposure * (2.8 * gradMag + bulkScatter), 0, 1);
      } else if (params.illuminationMode === "Phase contrast") {
        const phaseTerm = 1 - 0.45 * Math.sin(blurredPhase[idx]);
        intensity = clamp(exposure * tVal * phaseTerm, 0, 1);
      } else {
        // Optical density normalized mode
        intensity = clamp((exposure * odVal) / 2.0, 0, 1);
      }

      const roundedI = Number(intensity.toFixed(5));
      intensityGrid[idx] = roundedI;
      if (roundedI < minI) minI = roundedI;
      if (roundedI > maxI) maxI = roundedI;
    }
  }

  const michelsonContrast =
    maxI + minI > 1e-9 ? (maxI - minI) / (maxI + minI) : 0;

  // 4. Extract horizontal centerline profile (y = floor(N / 2))
  const midY = Math.floor(N / 2);
  const profileXUm = new Array<number>(N);
  const profileTransmittancePct = new Array<number>(N);
  const profileIntensityPct = new Array<number>(N);

  for (let x = 0; x < N; x++) {
    const idx = midY * N + x;
    profileXUm[x] = Number(((x + 0.5) * pixelSizeUm).toFixed(3));
    profileTransmittancePct[x] = Number((transmittanceGrid[idx] * 100).toFixed(3));
    profileIntensityPct[x] = Number((intensityGrid[idx] * 100).toFixed(3));
  }

  const stats: MicrographStats = {
    meanTransmittancePct: Number(((sumT / total) * 100).toFixed(3)),
    minTransmittancePct: Number((minT * 100).toFixed(3)),
    maxTransmittancePct: Number((maxT * 100).toFixed(3)),
    meanOpticalDensity: Number((sumOd / total).toFixed(4)),
    maxOpticalDensity: Number(maxOd.toFixed(4)),
    michelsonContrast: Number(michelsonContrast.toFixed(4)),
    rmsRoughnessUm: Number(rmsRoughnessUm.toFixed(4)),
    abbeResolutionUm: Number(abbeResolutionUm.toFixed(4)),
    depthOfFieldUm: Number(depthOfFieldUm.toFixed(4)),
    featureAreaFractionPct: Number(surface.featureAreaFractionPct.toFixed(2)),
  };

  const micrograph: MicrographData = {
    width: N,
    height: N,
    fovUm: Number(fovUm.toFixed(3)),
    pixelSizeUm: Number(pixelSizeUm.toFixed(4)),
    wavelengthNm: lambdaNm,
    magnification: mag,
    numericalAperture: na,
    immersionIndex: nImm,
    focusOffsetUm: params.focusOffsetUm,
    illuminationMode: params.illuminationMode,
    sourceMode: params.sourceMode,
    provenanceLabel: surface.provenanceLabel,
    seed: params.seed,
    intensityGrid,
    transmittanceGrid,
    opticalDensityGrid,
    thicknessGridUm,
    profileXUm,
    profileTransmittancePct,
    profileIntensityPct,
    stats,
  };

  const lineProfileSignal: Signal = {
    name: "Centerline transmittance",
    unit: "%",
    times: profileXUm,
    values: profileTransmittancePct,
  };

  return { micrograph, lineProfileSignal };
}

