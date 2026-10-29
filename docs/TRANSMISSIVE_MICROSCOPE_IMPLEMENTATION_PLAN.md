# Digital Transmissive Microscope — Prescriptive Implementation Plan
## (Zero-Ambiguity Step-by-Step Execution Specification for Coding Agents)

> **Purpose of this document:** This document is a **complete, copy-paste-ready implementation blueprint** for adding a **Digital Transmissive Microscope** (`transmissiveMicroscope` and `microscopeView`) to Lattice Lab. It is written so that an executing coding agent can implement every file, type, optical physics equation, UI canvas component, unit registration, and unit test **mechanically and sequentially without doing any architectural guesswork or math derivation of its own**.
>
> **Companion Documents:** Read [`AGENTS.md`](../AGENTS.md), [`docs/IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md), and [`docs/EXTENDING.md`](./EXTENDING.md) before starting.

---

## 0. Strict Operating Instructions & Hard Rules for the Executing Agent

1. **Execute tasks in exact ID order:** `TM-1` → `TM-2` → `TM-3` → `TM-4` → `TM-5` → `TM-6`. Do **not** skip ahead or reorder tasks.
2. **Hard Rule #1 — NEVER Invent Scientific or Surface Data:**
   - A digital transmissive microscope **cannot** magically inspect an unknown real-world surface out of thin air.
   - **Every surface inspected by the microscope MUST already be defined by known data** from one of three explicit, declared sources:
     1. **Measured Surface Table (`"Measured Table (CSV)"`):** Connected via the `surfaceTable` input port from a `csv` (or `table`) node containing actual user-supplied surface coordinates/thickness/attenuation data. **If this mode is selected and no valid table is connected, the node MUST throw a clear validation error and NEVER fall back to fake/random surface data.**
     2. **Upstream Physical Specimen Coupling (`"Coupled Physical Inputs"`):** Constructed deterministically from explicit physical quantities wired from upstream nodes (or explicitly entered by the user): specimen thickness $h_0$ ($\mu\text{m}$), inclusion/droplet/feature diameter $d$ ($\mu\text{m}$), volume/area fraction $\phi$ ($\%$), matrix attenuation $\alpha_{\text{matrix}}$ ($\mu\text{m}^{-1}$), feature attenuation $\alpha_{\text{feature}}$ ($\mu\text{m}^{-1}$), refractive indices $n_{\text{matrix}}, n_{\text{feature}}$, and an explicit deterministic PRNG seed (`seed`, Hard Rule #12).
     3. **Analytical Optical Calibration Reticle (`"Calibration Reticle (Ronchi / Step)"`):** A standard, mathematically exact USAF/Ronchi line-pair grating + Beer–Lambert step wedge of known spatial frequency ($\text{lp/mm}$) and step thicknesses ($\mu\text{m}$) used to verify optical resolution and contrast transfer.
3. **Hard Rule #2 — Never use `eval` / `exec` / `new Function`.**
4. **Hard Rule #8 — Preserve all persisted IDs.** Do not rename or remove any existing `DataType`, node `id`, port `id`, or field `key`. We are **only adding** a new packet type `"micrograph"`, two new node definitions (`"transmissiveMicroscope"` and `"microscopeDisplay"`), and their supporting renderer/test modules.
5. **Hard Rule #9 — Keep `src/Workspace.tsx` changes minimal.** Only update `exportPacket` in `src/Workspace.tsx` (5 lines) to support exporting `"micrograph"` packets as CSV. Put the microscope physics in `src/core/microscope.ts` and the UI component in `src/MicroscopeView.tsx`.
6. **Hard Rule #12 — Determinism:** Any spatial placement of coupled physical inclusions must use the deterministic `mulberry32(seed)` PRNG provided in `TM-2`. The exact `seed` is stored in the output `MicrographData` packet.
7. **Verification Gate After Every Task:**
   After completing each task, run:
   ```bash
   npm test
   npm run build
   npm run test:server
   uv run --directory server ruff check .
   ```
   All commands must exit `0` before marking the task `done` in [§7 Progress Tracker](#7-progress-tracker).

---

## 1. Scientific & Architectural Overview

### 1.1 Why a Digital Transmissive Microscope?
In wet-lab and engineering workflows (spray characterization, cement/concrete pore & microcrack inspection, microfluidic channel photometry, polymer film thickness mapping, crystal precipitation), scientists routinely evaluate specimens under a **transmitted-light optical microscope**.

Unlike a physical camera attached to a glass stage, a **digital transmissive microscope** in Lattice Lab operates on a **known 2D specimen surface representation** $\mathcal{S}(x, y) = \big(h(x,y),\; \alpha(x,y),\; n(x,y)\big)$ defined over a physical field of view $\text{FOV}_x \times \text{FOV}_y$ ($\mu\text{m} \times \mu\text{m}$), and applies **real physical optics** to simulate and display how that surface looks under conventional microscope settings:

1. **Specimen Plane $(x, y)$:**
   - Grid resolution: $N \times N$ pixels (default $96 \times 96$, configurable $48 \dots 160$).
   - Physical field of view:
     $$\text{FOV}(\text{Mag}) = \frac{\text{Field Number (FN)}}{\text{Mag}} = \frac{20\,000\;\mu\text{m}}{\text{Mag}}$$
     For example, at $10\times$ objective magnification, $\text{FOV} = 2000\;\mu\text{m}$; at $40\times$, $\text{FOV} = 500\;\mu\text{m}$; at $100\times$, $\text{FOV} = 200\;\mu\text{m}$.
   - Pixel pitch at specimen plane:
     $$\Delta x = \frac{\text{FOV}}{N}\quad (\mu\text{m/pixel})$$

2. **Beer–Lambert Transmissive Attenuation:**
   At each specimen pixel $(x, y)$, incident illumination of wavelength $\lambda$ ($\text{nm}$) passes through local matrix thickness $h_{\text{mat}}(x, y)$ ($\mu\text{m}$) with linear attenuation coefficient $\alpha_{\text{mat}}$ ($\mu\text{m}^{-1}$), local feature/inclusion thickness $h_{\text{feat}}(x, y)$ ($\mu\text{m}$) with attenuation $\alpha_{\text{feat}}$ ($\mu\text{m}^{-1}$), and optional dissolved chromophore concentration $c$ ($\text{mol/m}^3$) with molar absorptivity $\varepsilon$ ($\text{m}^2/\text{mol}$):
   $$\tau(x, y) = \alpha_{\text{mat}} \cdot h_{\text{mat}}(x, y) + \alpha_{\text{feat}}(x, y) \cdot h_{\text{feat}}(x, y) + \ln(10)\,\varepsilon \, c \, h_{\text{total}}(x, y) \cdot 10^{-6}$$
   $$T_{\text{ideal}}(x, y) = \exp\!\big(-\max(0, \tau(x, y))\big) \in (0, 1]$$
   $$\text{OD}_{\text{ideal}}(x, y) = -\log_{10}\!\big(\max(T_{\text{ideal}}(x, y), 10^{-6})\big)$$

3. **Optical Path Length & Phase Retardation:**
   When a specimen feature has refractive index $n_{\text{feat}}(x,y)$ embedded in medium $n_{\text{mat}}$, the optical path difference is:
   $$\Delta\text{OPL}(x, y) = \big(n_{\text{feat}}(x, y) - n_{\text{mat}}\big) \cdot h_{\text{feat}}(x, y) \quad (\mu\text{m})$$
   and the phase shift in radians at wavelength $\lambda_{\mu\text{m}} = \lambda_{\text{nm}} / 1000$ is:
   $$\Delta\phi(x, y) = \frac{2\pi}{\lambda_{\mu\text{m}}} \, \Delta\text{OPL}(x, y)$$

4. **Abbe Diffraction Limit, Depth of Field (DOF), and Defocus PSF Convolution:**
   - **Abbe lateral resolution limit:**
     $$\delta_{\text{Abbe}} = \frac{0.61 \, \lambda_{\mu\text{m}}}{\text{NA}_{\text{obj}}} \quad (\mu\text{m})$$
   - **Axial Depth of Field (Berek formula):**
     $$\text{DOF} = \frac{\lambda_{\mu\text{m}} \, n_{\text{imm}}}{\text{NA}_{\text{obj}}^2} + \frac{n_{\text{imm}} \, e_{\text{det}}}{\text{Mag} \cdot \text{NA}_{\text{obj}}} \quad (\mu\text{m})$$
     where $n_{\text{imm}}$ is immersion medium refractive index ($1.00$ for air, $1.515$ for oil) and $e_{\text{det}} = 6.5\;\mu\text{m}$ is detector pixel pitch.
   - **Point Spread Function (PSF) Gaussian blur radius $\sigma_{\text{total}}$ ($\mu\text{m}$):**
     $$\sigma_{\text{diff}} = \frac{0.21 \, \lambda_{\mu\text{m}}}{\text{NA}_{\text{obj}}}, \qquad \sigma_{\text{defocus}} = \max\!\left(0,\; |\Delta z| - \frac{\text{DOF}}{2}\right) \cdot \frac{\text{NA}_{\text{obj}}}{\sqrt{\max(n_{\text{imm}}^2 - \text{NA}_{\text{obj}}^2,\; 0.04)}}$$
     $$\sigma_{\text{total}} = \sqrt{\sigma_{\text{diff}}^2 + \sigma_{\text{defocus}}^2}, \qquad \sigma_{\text{px}} = \frac{\sigma_{\text{total}}}{\Delta x}$$
   - Both $T_{\text{ideal}}(x, y)$ and $\Delta\phi(x, y)$ are convolved with a normalized 2D separable Gaussian kernel of standard deviation $\sigma_{\text{px}}$ to yield $T_{\text{obs}}(x, y)$ and $\Delta\phi_{\text{obs}}(x, y)$.

5. **Illumination Contrast Modes:**
   - **Brightfield:** Direct transmitted intensity scaled by lamp exposure $E$:
     $$I(x, y) = \text{clamp}_{[0, 1]}\!\big(E \cdot T_{\text{obs}}(x, y)\big)$$
   - **Darkfield:** Zero-order beam blocked by condenser stop; only light scattered by attenuation/phase spatial gradients reaches the detector:
     $$G(x, y) = \sqrt{\left(\frac{\partial T_{\text{obs}}}{\partial x}\right)^2 + \left(\frac{\partial T_{\text{obs}}}{\partial y}\right)^2 + 0.25\left[\left(\frac{\partial \Delta\phi_{\text{obs}}}{\partial x}\right)^2 + \left(\frac{\partial \Delta\phi_{\text{obs}}}{\partial y}\right)^2\right]}$$
     $$I(x, y) = \text{clamp}_{[0, 1]}\!\big(E \cdot 2.5 \cdot G(x, y)\big)$$
   - **Phase Contrast (Zernike Positive Phase Contrast):** Converts phase gradients/shifts of transparent specimens into intensity contrast:
     $$I(x, y) = \text{clamp}_{[0, 1]}\!\Big(E \cdot T_{\text{obs}}(x, y) \cdot \big(1 - 0.45 \sin(\Delta\phi_{\text{obs}}(x, y))\big)\Big)$$
   - **Optical Density (Absorbance Map):** Normalized $-\log_{10}(T_{\text{obs}}(x, y))$ for quantitative densitometry.

6. **Integration with Flow Graph & Studies:**
   - The `transmissiveMicroscope` node outputs:
     - `micrograph` (`type: "micrograph"`) → rich 2D visual packet rendered in the bottom Results panel, on the node card preview, and in the dedicated `microscopeDisplay` Output node.
     - `transmittance` (`type: "number"`, unit `"%"`) → Mean field transmittance $100 \cdot \bar{T}_{\text{obs}}$.
     - `opticalDensity` (`type: "number"`, unit `"OD"`) → Mean field optical density $\overline{\text{OD}}_{\text{obs}}$.
     - `contrast` (`type: "number"`, unit `"1"`) → Michelson contrast $(I_{\max} - I_{\min}) / (I_{\max} + I_{\min} + 10^{-9})$.
     - `resolution` (`type: "number"`, unit `"µm"`) → Abbe diffraction limit $\delta_{\text{Abbe}}$.
     - `lineProfile` (`type: "signal"`, unit `"%"`) → 1D horizontal centerline transmittance profile $T_{\text{obs}}(x, y_{\text{mid}})$ across the FOV. Because it is a standard `"signal"` packet, it connects directly to `scope` (Oscilloscope), `stats` (Statistics), `threshold`, and Study Outcome reducers (`reduceOutcome`).

---

## 2. Step-by-Step Implementation Tasks

---

### `TM-1` · Extend Data Types, Packet Union, Colors, and Localization (`src/core/types.ts` & `src/core/ka.ts`)

#### Files to Modify
1. [`src/core/types.ts`](../src/core/types.ts)
2. [`src/core/ka.ts`](../src/core/ka.ts)

#### Exact Changes in `src/core/types.ts`

1. **In `src/core/types.ts` (lines 1–19), add `"micrograph"` to `DataType`:**
   Replace lines 1–19:
   ```ts
   export type DataType =
     | "event"
     | "number"
     | "boolean"
     | "text"
     | "vector3"
     | "signal"
     | "table"
     | "scene"
     | "sensor"
     | "sceneEvent";
   ```
   With:
   ```ts
   export type DataType =
     | "event"
     | "number"
     | "boolean"
     | "text"
     | "vector3"
     | "signal"
     | "table"
     | "scene"
     | "sensor"
     | "sceneEvent"
     | "micrograph";
   ```

2. **In `src/core/types.ts` (around line 55, right after `export interface TableData`), add `MicrographData` interface:**
   ```ts
   export type IlluminationMode =
     | "Brightfield"
     | "Darkfield"
     | "Phase contrast"
     | "Optical density";

   export type SpecimenSourceMode =
     | "Measured Table (CSV)"
     | "Coupled Physical Inputs"
     | "Calibration Reticle (Ronchi / Step)";

   export interface MicrographStats {
     meanTransmittancePct: number;
     minTransmittancePct: number;
     maxTransmittancePct: number;
     meanOpticalDensity: number;
     maxOpticalDensity: number;
     michelsonContrast: number;
     rmsRoughnessUm: number;
     abbeResolutionUm: number;
     depthOfFieldUm: number;
     featureAreaFractionPct: number;
   }

   export interface MicrographData {
     width: number;
     height: number;
     fovUm: number;
     pixelSizeUm: number;
     wavelengthNm: number;
     magnification: number;
     numericalAperture: number;
     immersionIndex: number;
     focusOffsetUm: number;
     illuminationMode: IlluminationMode;
     sourceMode: SpecimenSourceMode;
     provenanceLabel: string;
     seed: number;
     /** Row-major [height * width] rendered detector intensity in [0, 1] */
     intensityGrid: number[];
     /** Row-major [height * width] PSF-blurred transmittance in [0, 1] */
     transmittanceGrid: number[];
     /** Row-major [height * width] Optical Density (-log10 T) */
     opticalDensityGrid: number[];
     /** Row-major [height * width] known local specimen thickness in µm */
     thicknessGridUm: number[];
     /** Horizontal centerline x coordinates in µm [width] */
     profileXUm: number[];
     /** Horizontal centerline transmittance in % [width] */
     profileTransmittancePct: number[];
     /** Horizontal centerline rendered intensity in % [width] */
     profileIntensityPct: number[];
     stats: MicrographStats;
   }
   ```

3. **In `src/core/types.ts` (around line 140, in `export type Packet =`), add the `"micrograph"` variant:**
   Replace:
   ```ts
     | { type: "sensor"; value: SensorSpec }
     | { type: "sceneEvent"; value: SceneEventSpec };
   ```
   With:
   ```ts
     | { type: "sensor"; value: SensorSpec }
     | { type: "sceneEvent"; value: SceneEventSpec }
     | { type: "micrograph"; value: MicrographData };
   ```

4. **In `src/core/types.ts` (around line 222, in `export const typeColors: Record<DataType, string>`), add `"micrograph"` color:**
   Replace:
   ```ts
     sensor: "#38bdf8",
     sceneEvent: "#fb7185",
   };
   ```
   With:
   ```ts
     sensor: "#38bdf8",
     sceneEvent: "#fb7185",
     micrograph: "#2dd4bf",
   };
   ```

#### Exact Changes in `src/core/ka.ts`

In `src/core/ka.ts`, right before `});` around line 512, add Georgian translations for the new microscope labels and packet type:
```ts
  micrograph: "მიკროგრაფია",
  "Transmissive microscope": "ტრანსმისიური მიკროსკოპი",
  "Simulate optical transmission, diffraction & DOF on a known surface":
    "ცნობილი ზედაპირის ოპტიკური გამჭვირვალობისა და დიფრაქციის სიმულაცია",
  "Microscope display": "მიკროსკოპის ეკრანი",
  "Inspect 2D transmissive micrographs and line profiles":
    "2D ტრანსმისიური მიკროგრაფიისა და პროფილის დათვალიერება",
  "Specimen data source": "ნიმუშის მონაცემთა წყარო",
  "Measured Table (CSV)": "გაზომილი ცხრილი (CSV)",
  "Coupled Physical Inputs": "ფიზიკური შემავალი პარამეტრები",
  "Calibration Reticle (Ronchi / Step)": "საკალიბრო ბადე (Ronchi / საფეხური)",
  "Illumination mode": "განათების რეჟიმი",
  Brightfield: "ნათელი ველი (Brightfield)",
  Darkfield: "ბნელი ველი (Darkfield)",
  "Phase contrast": "ფაზური კონტრასტი",
  "Optical density": "ოპტიკური სიმკვრივე (OD)",
  "Objective magnification": "ობიექტივის გადიდება",
  "Numerical aperture (NA)": "რიცხვითი აპერტურა (NA)",
  "Wavelength": "ტალღის სიგრძე",
  "Focus offset Δz": "ფოკუსის წანაცვლება Δz",
  "Immersion index n": "იმერსიის გარდატეხის მაჩვენებელი n",
  "Lamp exposure": "განათების ექსპოზიცია",
  "Grid resolution": "ბადის გარჩევადობა",
  "Matrix thickness": "მატრიცის სისქე",
  "Matrix attenuation": "მატრიცის შესუსტება",
  "Feature attenuation": "ჩანართის შესუსტება",
  "Matrix refractive index": "მატრიცის გარდატეხის მაჩვენებელი",
  "Feature refractive index": "ჩანართის გარდატეხის მაჩვენებელი",
  "Feature diameter": "ჩანართის დიამეტრი",
  "Feature volume fraction": "ჩანართების წილი",
  "Molar absorptivity": "მოლური შთანთქმა",
  "Reticle frequency": "ბადის სიხშირე",
  "Microstructure seed": "მიკროსტრუქტურის თესლი (seed)",
```

---

### `TM-2` · Create Deterministic Optical Physics & Surface Grid Engine (`src/core/microscope.ts`)

Create a new file [`src/core/microscope.ts`](../src/core/microscope.ts). This module implements:
1. `mulberry32(seed)` — deterministic 32-bit PRNG (Hard Rule #12).
2. `buildSurfaceFromTable(table, gridN, fovUm, baseMatrixAtten, baseMatrixN)` — parses a user-supplied `TableData` packet into a known 2D specimen grid without ever inventing fallback data. Supports:
   - **Coordinate / Feature rows** (`x_um`, `y_um`, `thickness_um`, optional `radius_um`, `attenuation_inv_um`, `refractive_index`)
   - **2D numeric matrix rows** (each cell in the CSV table is a measured thickness in $\mu\text{m}$).
   - Throws a descriptive `Error` if the table is empty or lacks numeric data.
3. `buildSurfaceFromCoupledInputs(...)` — deterministically constructs a 2D specimen thickness and attenuation map from explicit physical inputs (matrix thickness, feature diameter, feature area/volume fraction, attenuation coefficients, refractive indices, chromophore concentration, and `seed`).
4. `buildCalibrationReticleSurface(...)` — constructs an exact analytical Ronchi line-pair bar target in the upper half of the field of view and a 6-step Beer–Lambert optical wedge in the lower half.
5. `simulateTransmissiveMicroscope(params)` — computes Beer–Lambert transmittance, optical path phase shift, Abbe diffraction limit, Berek depth of field, separable 2D Gaussian PSF + defocus convolution, contrast mode rendering, centerline `Signal`, and summary `MicrographStats`.

#### Exact Code for `src/core/microscope.ts`

Write the following complete file to `src/core/microscope.ts`:

```ts
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
  // Check if header row itself is all numbers; if not, only use table.rows
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
  const radiusUm = diamUm * 0.5;
  const singleAreaUm2 = Math.PI * radiusUm * radiusUm;
  const fovAreaUm2 = fovUm * fovUm;

  const rng = mulberry32(seed);
  const desiredCount =
    targetFrac <= 0
      ? 0
      : clamp(Math.round((targetFrac * fovAreaUm2) / singleAreaUm2), 1, 600);

  const placed: Array<{ x: number; y: number; r: number }> = [];
  const maxAttempts = desiredCount * 12;

  for (let attempt = 0; attempt < maxAttempts && placed.length < desiredCount; attempt++) {
    // Allow slight deterministic polydispersity (±12%) around declared featureDiameterUm
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
          // Spherical / cylindrical chord thickness through the inclusion
          const chordUm = 2 * Math.sqrt(Math.max(0, p.r * p.r - distSq));
          const boundedFeatH = Math.min(hMat0, featureThicknessUm[idx] + chordUm);
          featureThicknessUm[idx] = boundedFeatH;
          matrixThicknessUm[idx] = Math.max(0, hMat0 - boundedFeatH);
        }
      }
    }
  }

  let featurePixelCount = 0;
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
    provenanceLabel: `Coupled Physical Specimen (d=${diamUm.toFixed(1)} µm, φ=${featureVolumeFractionPct.toFixed(1)}%, n=${placed.length} inclusions, seed=${seed})`,
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

  // Period in µm: 1000 µm/mm divided by lp/mm
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
```

---

### `TM-3` · Register `transmissiveMicroscope` and `microscopeDisplay` Nodes (`src/core/registry.ts` & `src/NodeCard.tsx`)

#### Files to Modify
1. [`src/core/registry.ts`](../src/core/registry.ts)
2. [`src/NodeCard.tsx`](../src/NodeCard.tsx)

#### Exact Changes in `src/core/registry.ts`

1. **Import `simulateTransmissiveMicroscope`, `IlluminationMode`, and `SpecimenSourceMode` at the top of `src/core/registry.ts` (around line 20):**
   ```ts
   import {
     type DataType,
     type IlluminationMode,
     type LabNode,
     type NodeDefinition,
     type Packet,
     type Project,
     type ReusableTool,
     type SceneData,
     type SceneEventSpec,
     type SensorSpec,
     type Signal,
     type SpecimenSourceMode,
   } from "./types";
   import { simulateTransmissiveMicroscope } from "./microscope";
   ```

2. **Add the `"transmissiveMicroscope"` node (category `"Processing"`) and `"microscopeDisplay"` node (category `"Outputs"`) to `rawDefinitions` in `src/core/registry.ts` (right before the closing `];` of `rawDefinitions` around line 2012):**

   ```ts
     {
       id: "transmissiveMicroscope",
       title: "Transmissive microscope",
       category: "Processing",
       description:
         "Simulate optical transmission, diffraction & DOF on a known surface",
       icon: "Microscope",
       inputs: [
         {
           id: "surfaceTable",
           label: "Measured surface (CSV)",
           types: ["table"],
           optional: true,
         },
         {
           id: "featureDiameter",
           label: "Feature diameter (µm)",
           types: ["number", "signal"],
           optional: true,
         },
         {
           id: "volumeFraction",
           label: "Feature fraction (%)",
           types: ["number", "signal"],
           optional: true,
         },
         {
           id: "thickness",
           label: "Specimen thickness (µm)",
           types: ["number", "signal"],
           optional: true,
         },
         {
           id: "concentration",
           label: "Chromophore conc. (mol/m³)",
           types: ["number", "signal"],
           optional: true,
         },
         {
           id: "focusOffset",
           label: "Focus offset Δz (µm)",
           types: ["number", "signal"],
           optional: true,
         },
       ],
       outputs: [
         { id: "micrograph", label: "Micrograph", types: ["micrograph"] },
         { id: "transmittance", label: "Mean transmittance", types: ["number"] },
         { id: "opticalDensity", label: "Mean OD", types: ["number"] },
         { id: "contrast", label: "Michelson contrast", types: ["number"] },
         { id: "resolution", label: "Abbe limit", types: ["number"] },
         { id: "lineProfile", label: "Centerline profile", types: ["signal"] },
       ],
       fields: [
         {
           key: "sourceMode",
           label: "Specimen data source",
           kind: "select",
           options: [
             "Coupled Physical Inputs",
             "Measured Table (CSV)",
             "Calibration Reticle (Ronchi / Step)",
           ],
           defaultValue: "Coupled Physical Inputs",
         },
         {
           key: "illuminationMode",
           label: "Illumination mode",
           kind: "select",
           options: [
             "Brightfield",
             "Darkfield",
             "Phase contrast",
             "Optical density",
           ],
           defaultValue: "Brightfield",
         },
         {
           key: "magnification",
           label: "Objective magnification",
           kind: "number",
           defaultValue: 40,
           min: 2,
           max: 100,
           step: 1,
           unit: "×",
         },
         {
           key: "numericalAperture",
           label: "Numerical aperture (NA)",
           kind: "number",
           defaultValue: 0.65,
           min: 0.08,
           max: 1.45,
           step: 0.01,
           unit: "1",
         },
         {
           key: "wavelengthNm",
           label: "Wavelength",
           kind: "number",
           defaultValue: 550,
           min: 380,
           max: 750,
           step: 5,
           unit: "nm",
         },
         {
           key: "focusOffsetUm",
           label: "Focus offset Δz",
           kind: "number",
           defaultValue: 0,
           min: -200,
           max: 200,
           step: 0.5,
           unit: "µm",
         },
         {
           key: "immersionIndex",
           label: "Immersion index n",
           kind: "number",
           defaultValue: 1.0,
           min: 1.0,
           max: 1.55,
           step: 0.005,
           unit: "1",
         },
         {
           key: "exposure",
           label: "Lamp exposure",
           kind: "number",
           defaultValue: 1.0,
           min: 0.1,
           max: 4.0,
           step: 0.05,
           unit: "1",
         },
         {
           key: "gridN",
           label: "Grid resolution",
           kind: "number",
           defaultValue: 80,
           min: 32,
           max: 128,
           step: 8,
           unit: "px",
         },
         {
           key: "matrixThicknessUm",
           label: "Matrix thickness",
           kind: "number",
           defaultValue: 50,
           min: 0.5,
           max: 5000,
           step: 1,
           unit: "µm",
         },
         {
           key: "matrixAttenInvUm",
           label: "Matrix attenuation",
           kind: "number",
           defaultValue: 0.003,
           min: 0,
           max: 2,
           step: 0.001,
           unit: "1/µm",
         },
         {
           key: "featureAttenInvUm",
           label: "Feature attenuation",
           kind: "number",
           defaultValue: 0.045,
           min: 0,
           max: 5,
           step: 0.001,
           unit: "1/µm",
         },
         {
           key: "matrixRefractiveIndex",
           label: "Matrix refractive index",
           kind: "number",
           defaultValue: 1.333,
           min: 1.0,
           max: 2.5,
           step: 0.001,
           unit: "1",
         },
         {
           key: "featureRefractiveIndex",
           label: "Feature refractive index",
           kind: "number",
           defaultValue: 1.48,
           min: 1.0,
           max: 2.5,
           step: 0.001,
           unit: "1",
         },
         {
           key: "featureDiameterUm",
           label: "Feature diameter",
           kind: "number",
           defaultValue: 28,
           min: 0.5,
           max: 1000,
           step: 0.5,
           unit: "µm",
         },
         {
           key: "featureVolumeFractionPct",
           label: "Feature volume fraction",
           kind: "number",
           defaultValue: 18,
           min: 0,
           max: 85,
           step: 0.5,
           unit: "%",
         },
         {
           key: "molarAbsorptivityM2Mol",
           label: "Molar absorptivity",
           kind: "number",
           defaultValue: 0,
           min: 0,
           max: 10000,
           step: 1,
           unit: "m²/mol",
         },
         {
           key: "reticleFrequencyLpMm",
           label: "Reticle frequency",
           kind: "number",
           defaultValue: 40,
           min: 2,
           max: 500,
           step: 2,
           unit: "1/mm",
         },
         {
           key: "seed",
           label: "Microstructure seed",
           kind: "number",
           defaultValue: 42,
           min: 1,
           max: 999999,
           step: 1,
         },
       ],
       help: "Digital transmissive optical microscope. Evaluates Beer–Lambert attenuation, Zernike phase shift, Abbe diffraction PSF blur (0.61λ/NA) and Berek depth-of-field defocus across a known 2D specimen surface (from a measured CSV table, upstream coupled physical inputs, or an analytical calibration reticle).",
       evaluate: ({ node, inputs }) => {
         const scalarFrom = (portId: string, fallback: number): number => {
           const pkt = inputs[portId]?.[0];
           if (!pkt) return fallback;
           if (pkt.type === "number") return pkt.value;
           if (pkt.type === "signal" && pkt.value.values.length > 0) {
             const sum = pkt.value.values.reduce((a, b) => a + b, 0);
             return sum / pkt.value.values.length;
           }
           return fallback;
         };

         const tablePkt = inputs.surfaceTable?.[0];
         const table = tablePkt?.type === "table" ? tablePkt.value : undefined;

         const sourceMode = String(
           node.params.sourceMode || "Coupled Physical Inputs",
         ) as SpecimenSourceMode;
         const illuminationMode = String(
           node.params.illuminationMode || "Brightfield",
         ) as IlluminationMode;

         const { micrograph, lineProfileSignal } =
           simulateTransmissiveMicroscope({
             sourceMode,
             table,
             gridN: Number(node.params.gridN ?? 80),
             magnification: Number(node.params.magnification ?? 40),
             numericalAperture: Number(node.params.numericalAperture ?? 0.65),
             wavelengthNm: Number(node.params.wavelengthNm ?? 550),
             focusOffsetUm: scalarFrom(
               "focusOffset",
               Number(node.params.focusOffsetUm ?? 0),
             ),
             immersionIndex: Number(node.params.immersionIndex ?? 1.0),
             illuminationMode,
             exposure: Number(node.params.exposure ?? 1.0),
             matrixThicknessUm: scalarFrom(
               "thickness",
               Number(node.params.matrixThicknessUm ?? 50),
             ),
             matrixAttenInvUm: Number(node.params.matrixAttenInvUm ?? 0.003),
             featureAttenInvUm: Number(node.params.featureAttenInvUm ?? 0.045),
             matrixRefractiveIndex: Number(
               node.params.matrixRefractiveIndex ?? 1.333,
             ),
             featureRefractiveIndex: Number(
               node.params.featureRefractiveIndex ?? 1.48,
             ),
             featureDiameterUm: scalarFrom(
               "featureDiameter",
               Number(node.params.featureDiameterUm ?? 28),
             ),
             featureVolumeFractionPct: scalarFrom(
               "volumeFraction",
               Number(node.params.featureVolumeFractionPct ?? 18),
             ),
             chromophoreConcMolM3: scalarFrom("concentration", 0),
             molarAbsorptivityM2Mol: Number(
               node.params.molarAbsorptivityM2Mol ?? 0,
             ),
             reticleFrequencyLpMm: Number(
               node.params.reticleFrequencyLpMm ?? 40,
             ),
             seed: Number(node.params.seed ?? 42),
           });

         return {
           outputs: {
             micrograph: { type: "micrograph", value: micrograph },
             transmittance: {
               type: "number",
               value: micrograph.stats.meanTransmittancePct,
               unit: "%",
             },
             opticalDensity: {
               type: "number",
               value: micrograph.stats.meanOpticalDensity,
               unit: "OD",
             },
             contrast: {
               type: "number",
               value: micrograph.stats.michelsonContrast,
               unit: "1",
             },
             resolution: {
               type: "number",
               value: micrograph.stats.abbeResolutionUm,
               unit: "µm",
             },
             lineProfile: {
               type: "signal",
               value: lineProfileSignal,
             },
           },
           message: `${micrograph.magnification}× / ${micrograph.numericalAperture} NA · T̄ = ${micrograph.stats.meanTransmittancePct.toFixed(1)}% · OD = ${micrograph.stats.meanOpticalDensity.toFixed(3)} · δ = ${micrograph.stats.abbeResolutionUm.toFixed(2)} µm`,
         };
       },
     },
     {
       id: "microscopeDisplay",
       title: "Microscope display",
       category: "Outputs",
       description: "Inspect 2D transmissive micrographs and line profiles",
       icon: "Microscope",
       inputs: [
         {
           id: "micrograph",
           label: "Micrograph",
           types: ["micrograph"],
         },
       ],
       outputs: [],
       fields: [],
       help: "Dedicated viewport for inspecting simulated 2D transmissive micrographs, optical resolution metadata, interactive pixel densitometry and cross-section line profiles.",
       evaluate: ({ inputs }) => {
         const pkt = inputs.micrograph?.[0];
         if (!pkt || pkt.type !== "micrograph") {
           throw Error("Connect a micrograph");
         }
         const m = pkt.value;
         return {
           outputs: {},
           message: `${m.magnification}× ${m.illuminationMode} · FOV ${m.fovUm.toFixed(0)} µm · T̄ ${m.stats.meanTransmittancePct.toFixed(1)}%`,
         };
       },
     },
   ```

#### Exact Changes in `src/NodeCard.tsx`

1. **Import `Microscope` from `lucide-react` in `src/NodeCard.tsx` (lines 2–38):**
   Add `Microscope,` to the `lucide-react` import list and add `Microscope,` to `const iconMap: Record<string, typeof Activity> = { ... }` around line 73.

2. **Add a compact micrograph preview on the canvas card in `src/NodeCard.tsx`:**
   - In `src/NodeCard.tsx` (around line 142, where `table` and `signal` are extracted), also extract any `"micrograph"` packet:
     ```ts
     const micrographPkt = packets.find(
       (p): p is Extract<Packet, { type: "micrograph" }> =>
         p?.type === "micrograph",
     );
     ```
   - Around line 235 (inside `<div className="node-preview">`, right before `table ? (`), render a compact summary badge when `micrographPkt` is present:
     ```tsx
     ) : micrographPkt ? (
       <div className="node-table-preview">
         <strong>
           {micrographPkt.value.magnification}× /{" "}
           {micrographPkt.value.numericalAperture} NA ·{" "}
           {L(micrographPkt.value.illuminationMode)}
         </strong>
         <span>
           T̄ = {micrographPkt.value.stats.meanTransmittancePct.toFixed(1)}% · OD ={" "}
           {micrographPkt.value.stats.meanOpticalDensity.toFixed(3)} · δ ={" "}
           {micrographPkt.value.stats.abbeResolutionUm.toFixed(2)} µm
         </span>
       </div>
     ```

---

### `TM-4` · Create Interactive Digital Microscope Viewport (`src/MicroscopeView.tsx`, `src/Plots.tsx`, `src/Workspace.tsx`, `src/workspace.css`)

#### Files to Create / Modify
1. **Create** [`src/MicroscopeView.tsx`](../src/MicroscopeView.tsx)
2. **Modify** [`src/Plots.tsx`](../src/Plots.tsx)
3. **Modify** [`src/Workspace.tsx`](../src/Workspace.tsx)
4. **Modify** [`src/workspace.css`](../src/workspace.css)

#### 1. Exact Code for `src/MicroscopeView.tsx`

Write the following complete React component to `src/MicroscopeView.tsx`. It renders:
- A provenance & scientific transparency header showing the exact specimen data source (`provenanceLabel`), assuring the user that **no surface data was invented**.
- Color LUT selector (`Spectral λ`, `Monochrome`, `Viridis`, `Optical Density Heat`).
- Interactive HTML5 `<canvas>` rendering the $N \times N$ micrograph with bilinear/crisp display, calibrated physical scale bar ($\mu\text{m}$), objective HUD badge, and crosshair overlay.
- Real-time pixel densitometry inspector (hover or click any point on the micrograph to read exact $(x, y)$ in $\mu\text{m}$, local feature thickness $h(x,y)$ in $\mu\text{m}$, local transmittance $T(x,y)$ in $\%$, and local Optical Density $\text{OD}(x,y)$).
- Dynamic 1D horizontal cross-section line profile SVG plot at the currently selected $y$-row (defaults to centerline $y = \text{FOV}/2$, updates when the user clicks or drags on the micrograph!).
- One-click **Download PNG Micrograph** button (renders the image + scale bar + metadata caption directly to a downloadable PNG file).

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Crosshair, Info } from "lucide-react";
import type { MicrographData } from "./core/types";
import { L } from "./core/ka";

type ColorLut = "spectral" | "grayscale" | "viridis" | "inferno";

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

function mapLut(
  val01: number,
  lut: ColorLut,
  wavelengthNm: number,
): [number, number, number] {
  const v = Math.max(0, Math.min(1, val01));
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
  const b = Math.round(255 * Math.max(0, Math.min(1, Math.sin(v * Math.PI) * 0.7 + (v > 0.8 ? (v - 0.8) * 2 : 0))));
  return [r, g, b];
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

export function MicroscopeView({ data }: { data: MicrographData }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [lut, setLut] = useState<ColorLut>(
    data.illuminationMode === "Optical density" ? "viridis" : "spectral",
  );
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

  const displaySize = 320;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width: N, height: M, intensityGrid, wavelengthNm } = data;
    const offscreen = document.createElement("canvas");
    offscreen.width = N;
    offscreen.height = M;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    const imgData = offCtx.createImageData(N, M);
    for (let i = 0; i < N * M; i++) {
      const [r, g, b] = mapLut(intensityGrid[i] ?? 0, lut, wavelengthNm);
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
    ctx.strokeStyle = "rgba(45, 212, 191, 0.75)";
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
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
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
    ctx.fillStyle = "rgba(9, 13, 22, 0.72)";
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
  }, [data, lut, selectedRow, hoverPx, scaleBarUm]);

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

  const rowProfileT = useMemo(() => {
    const arr: number[] = [];
    const offset = selectedRow * data.width;
    for (let x = 0; x < data.width; x++) {
      arr.push((data.transmittanceGrid[offset + x] ?? 0) * 100);
    }
    return arr;
  }, [data, selectedRow]);

  const exportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `micrograph-${data.magnification}x-${data.illuminationMode.toLowerCase().replace(/\s+/g, "-")}.png`;
    a.click();
  };

  const handlePointer = (e: React.MouseEvent<HTMLCanvasElement>, click = false) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const px = Math.max(0, Math.min(data.width - 1, Math.floor(relX * data.width)));
    const py = Math.max(0, Math.min(data.height - 1, Math.floor(relY * data.height)));
    setHoverPx({ x: px, y: py });
    if (click || e.buttons === 1) {
      setSelectedRow(py);
    }
  };

  const isDefocused = Math.abs(data.focusOffsetUm) > data.stats.depthOfFieldUm * 0.5;

  return (
    <div className="microscope-view">
      <div className="microscope-provenance-banner">
        <Info size={14} />
        <span>
          <strong>Known Surface Source:</strong> {data.provenanceLabel} ·{" "}
          <em>Simulated optical transmission (Beer–Lambert + Abbe PSF)</em>
        </span>
      </div>

      <div className="microscope-main-grid">
        <div className="microscope-stage-column">
          <div className="microscope-hud-bar">
            <span className="microscope-badge">
              {data.magnification}× / {data.numericalAperture.toFixed(2)} NA
            </span>
            <span className="microscope-badge">
              λ = {data.wavelengthNm} nm · {L(data.illuminationMode)}
            </span>
            <span
              className={
                "microscope-badge " + (isDefocused ? "microscope-badge-warn" : "")
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
              onMouseLeave={() => setHoverPx(null)}
            />
          </div>

          <div className="microscope-controls-row">
            <label className="microscope-lut-select">
              <span>LUT:</span>
              <select
                aria-label="Micrograph color palette"
                value={lut}
                onChange={(e) => setLut(e.target.value as ColorLut)}
              >
                <option value="spectral">True Wavelength ({data.wavelengthNm} nm)</option>
                <option value="grayscale">Monochrome Grayscale</option>
                <option value="viridis">Viridis Quantitative</option>
                <option value="inferno">Inferno Thermal/OD</option>
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              onClick={exportPng}
              title="Download simulated micrograph as PNG"
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
                <small>Feature Thickness h(x,y)</small>
                <strong>{activeThicknessUm.toFixed(2)} µm</strong>
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
            </div>
          </div>

          <div className="microscope-readout-card">
            <header>
              <span>Field Optical Summary (FOV {data.fovUm.toFixed(0)} × {data.fovUm.toFixed(0)} µm)</span>
            </header>
            <div className="microscope-kv-grid">
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
              <div>
                <small>Feature Area Coverage</small>
                <strong>{data.stats.featureAreaFractionPct.toFixed(1)}%</strong>
              </div>
            </div>
          </div>

          <div className="microscope-profile-card">
            <header>
              <span>
                Horizontal Line Profile at y ={" "}
                {((selectedRow + 0.5) * data.pixelSizeUm).toFixed(1)} µm (click
                image to move scanline)
              </span>
            </header>
            <svg
              className="microscope-profile-svg"
              viewBox="0 0 360 96"
              role="img"
              aria-label="Transmittance cross-section line profile"
            >
              <line x1="28" y1="10" x2="350" y2="10" stroke="#263244" strokeDasharray="2 2" />
              <line x1="28" y1="45" x2="350" y2="45" stroke="#263244" strokeDasharray="2 2" />
              <line x1="28" y1="80" x2="350" y2="80" stroke="#263244" />
              <text x="4" y="14" fill="#8fa3b8" fontSize="9">100%</text>
              <text x="8" y="48" fill="#8fa3b8" fontSize="9">50%</text>
              <text x="12" y="83" fill="#8fa3b8" fontSize="9">0%</text>
              <polyline
                fill="none"
                stroke="#2dd4bf"
                strokeWidth="1.75"
                points={rowProfileT
                  .map((tPct, i) => {
                    const px = 28 + (i / Math.max(1, rowProfileT.length - 1)) * 322;
                    const py = 80 - (Math.max(0, Math.min(100, tPct)) / 100) * 70;
                    return `${px.toFixed(1)},${py.toFixed(1)}`;
                  })
                  .join(" ")}
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
```

#### 2. Exact Changes in `src/Plots.tsx`

In `src/Plots.tsx`:
1. At the top of `src/Plots.tsx` (line 4), import `MicroscopeView`:
   ```tsx
   import { MicroscopeView } from "./MicroscopeView";
   ```
2. Inside `export function PacketView({ packet }: { packet?: Packet })` (around line 143, right before `if (packet.type === "signal")`), add:
   ```tsx
   if (packet.type === "micrograph") return <MicroscopeView data={packet.value} />;
   ```

#### 3. Exact Changes in `src/Workspace.tsx`

In `src/Workspace.tsx` (lines 142–164, inside `function exportPacket(packet: Packet, name: string)`), add CSV export support for `"micrograph"` packets so clicking the Export button exports the full 2D `(x_um, y_um, thickness_um, transmittance_pct, optical_density, intensity)` table:
```ts
  } else if (packet.type === "micrograph") {
    const m = packet.value;
    const rows: string[] = [
      "pixel_x,pixel_y,x_um,y_um,feature_thickness_um,transmittance_pct,optical_density,rendered_intensity",
    ];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const idx = y * m.width + x;
        const xUm = ((x + 0.5) * m.pixelSizeUm).toFixed(3);
        const yUm = ((y + 0.5) * m.pixelSizeUm).toFixed(3);
        rows.push(
          `${x},${y},${xUm},${yUm},${m.thicknessGridUm[idx]},${(m.transmittanceGrid[idx] * 100).toFixed(3)},${m.opticalDensityGrid[idx]},${m.intensityGrid[idx]}`,
        );
      }
    }
    download(name + "-micrograph.csv", rows.join("\n"), "text/csv");
  } else download(name + ".json", JSON.stringify(packet, null, 2));
```

#### 4. Exact Styling to Append to `src/workspace.css`

Append the following CSS rules to the end of [`src/workspace.css`](../src/workspace.css):

```css
/* Digital Transmissive Microscope View */
.microscope-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px 2px;
}

.microscope-provenance-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 11px;
  border-radius: 6px;
  background: rgba(45, 212, 191, 0.08);
  border: 1px solid rgba(45, 212, 191, 0.25);
  color: #cbd5e1;
  font-size: 12px;
}

.microscope-main-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px;
  align-items: start;
}

@media (max-width: 860px) {
  .microscope-main-grid {
    grid-template-columns: 1fr;
  }
}

.microscope-stage-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.microscope-hud-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.microscope-badge {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 3px 7px;
  border-radius: 4px;
  background: #131c2b;
  border: 1px solid #26354d;
  color: #e2e8f0;
}

.microscope-badge-warn {
  border-color: rgba(245, 158, 11, 0.5);
  color: #fcd34d;
}

.microscope-canvas-wrap {
  position: relative;
  width: 320px;
  height: 320px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #26354d;
  background: #070b12;
  box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.7);
}

.microscope-canvas {
  width: 320px;
  height: 320px;
  display: block;
  cursor: crosshair;
}

.microscope-controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.microscope-lut-select {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #94a3b8;
}

.microscope-lut-select select {
  background: #0f172a;
  color: #e2e8f0;
  border: 1px solid #26354d;
  border-radius: 5px;
  padding: 4px 8px;
  font-size: 12px;
}

.microscope-metrics-column {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 260px;
}

.microscope-readout-card,
.microscope-profile-card {
  background: #0d1420;
  border: 1px solid #1e293b;
  border-radius: 7px;
  padding: 9px 12px;
}

.microscope-readout-card header,
.microscope-profile-card header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: #94a3b8;
  margin-bottom: 8px;
}

.microscope-kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(110px, 1fr));
  gap: 7px 12px;
}

.microscope-kv-grid small {
  display: block;
  font-size: 10.5px;
  color: #64748b;
}

.microscope-kv-grid strong {
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #f1f5f9;
}

.microscope-profile-svg {
  width: 100%;
  height: 96px;
  display: block;
  background: #090e17;
  border-radius: 5px;
}
```

---

### `TM-5` · Register Optical & Microscopy Units in Frontend & Backend (`src/study/units.ts` & `server/lattice_server/units.py`)

So that Study Parameters and Outcomes bound to `transmissiveMicroscope` ports (`%`, `OD`, `µm`, `nm`, `1/µm`, `1/mm`, `m²/mol`, `×`, `px`, `1`) validate and convert cleanly during Study creation and Real Experiment Ground-Truth entry (`RecordExperimentModal.tsx`), register the optical units in both unit registries.

#### Files to Modify
1. [`server/lattice_server/units.py`](../server/lattice_server/units.py)
2. [`src/study/units.ts`](../src/study/units.ts)

#### 1. Exact Changes in `server/lattice_server/units.py`

In `server/lattice_server/units.py`:
1. Right after `_ureg.define("thou = 0.001 * inch")` (around line 14), add:
   ```python
   with contextlib.suppress(Exception):
       _ureg.define("OD = dimensionless = optical_density")
       _ureg.define("magnification_x = dimensionless = ×")
       _ureg.define("pixel = dimensionless = px")
   ```
2. In `_UNIT_NORMALIZATION: dict[str, str]` (around line 20), add the following entries:
   ```python
       "OD": "dimensionless",
       "×": "dimensionless",
       "px": "dimensionless",
       "1/µm": "1 / micrometer",
       "1/um": "1 / micrometer",
       "1/mm": "1 / millimeter",
       "m²/mol": "meter ** 2 / mole",
       "m^2/mol": "meter ** 2 / mole",
   ```

#### 2. Exact Changes in `src/study/units.ts`

In `src/study/units.ts`:
1. In `const UNIT_GROUPS: UnitGroup[]` (around line 88, before the Dimensionless group), add two groups for Optical Attenuation and Spatial Frequency, and add `"OD"`, `"×"`, and `"px"` to the Dimensionless group:
   ```ts
     {
       dimension: "linear_attenuation",
       canonical: "1/µm",
       units: {
         "1/µm": 1,
         "1/um": 1,
         "1/mm": 1e-3,
         "1/cm": 1e-4,
         "1/m": 1e-6,
       },
     },
     {
       dimension: "molar_absorptivity",
       canonical: "m²/mol",
       units: {
         "m²/mol": 1,
         "m^2/mol": 1,
         "cm²/mol": 1e-4,
       },
     },
   ```
2. In the `"dimensionless"` group of `src/study/units.ts`, add `"OD": 1`, `"×": 1`, `"px": 1`:
   ```ts
     {
       dimension: "dimensionless",
       canonical: "1",
       units: {
         "1": 1,
         "": 1,
         "-": 1,
         OD: 1,
         "×": 1,
         px: 1,
         "%": (v) => v * 0.01,
         ppm: (v) => v * 1e-6,
       },
       fromCanonical: {
         "%": (v) => v * 100,
         ppm: (v) => v * 1e6,
       },
     },
   ```

---

### `TM-6` · Comprehensive Unit & Scientific Conformance Tests (`src/core/microscope.test.ts` & `package.json`)

#### Files to Create / Modify
1. **Create** [`src/core/microscope.test.ts`](../src/core/microscope.test.ts)
2. **Modify** [`package.json`](../package.json) (line 14)

#### 1. Exact Code for `src/core/microscope.test.ts`

Write the following complete test file to `src/core/microscope.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mulberry32,
  simulateTransmissiveMicroscope,
} from "./microscope";
import { blankProject } from "./types";
import { makeNode } from "./runtime";
import { execute } from "./engine";

describe("Digital Transmissive Microscope Physics & Integrity", () => {
  it("obeys Beer-Lambert law exactly for a uniform specimen (0% inclusions)", () => {
    const hUm = 100;
    const alphaInvUm = 0.01; // tau = 1.0 -> T = exp(-1) = 0.367879...
    const { micrograph } = simulateTransmissiveMicroscope({
      sourceMode: "Coupled Physical Inputs",
      gridN: 32,
      magnification: 20,
      numericalAperture: 0.5,
      wavelengthNm: 550,
      focusOffsetUm: 0,
      immersionIndex: 1.0,
      illuminationMode: "Brightfield",
      exposure: 1.0,
      matrixThicknessUm: hUm,
      matrixAttenInvUm: alphaInvUm,
      featureAttenInvUm: 0.05,
      matrixRefractiveIndex: 1.333,
      featureRefractiveIndex: 1.48,
      featureDiameterUm: 20,
      featureVolumeFractionPct: 0,
      chromophoreConcMolM3: 0,
      molarAbsorptivityM2Mol: 0,
      reticleFrequencyLpMm: 20,
      seed: 42,
    });

    const expectedT = Math.exp(-1.0) * 100;
    const expectedOd = 1.0 / Math.LN10;
    assert.ok(
      Math.abs(micrograph.stats.meanTransmittancePct - expectedT) < 0.02,
      `Expected T=${expectedT.toFixed(3)}%, got ${micrograph.stats.meanTransmittancePct}%`,
    );
    assert.ok(
      Math.abs(micrograph.stats.meanOpticalDensity - expectedOd) < 0.002,
      `Expected OD=${expectedOd.toFixed(4)}, got ${micrograph.stats.meanOpticalDensity}`,
    );
    assert.equal(micrograph.stats.michelsonContrast, 0);
  });

  it("throws an explicit error in Measured Table (CSV) mode when no table is provided (Hard Rule #1)", () => {
    assert.throws(
      () =>
        simulateTransmissiveMicroscope({
          sourceMode: "Measured Table (CSV)",
          table: undefined,
          gridN: 32,
          magnification: 40,
          numericalAperture: 0.65,
          wavelengthNm: 550,
          focusOffsetUm: 0,
          immersionIndex: 1.0,
          illuminationMode: "Brightfield",
          exposure: 1.0,
          matrixThicknessUm: 50,
          matrixAttenInvUm: 0.002,
          featureAttenInvUm: 0.05,
          matrixRefractiveIndex: 1.33,
          featureRefractiveIndex: 1.5,
          featureDiameterUm: 20,
          featureVolumeFractionPct: 15,
          chromophoreConcMolM3: 0,
          molarAbsorptivityM2Mol: 0,
          reticleFrequencyLpMm: 20,
          seed: 1,
        }),
      /Connect a CSV\/Table with measured surface data/,
    );
  });

  it("reconstructs a known surface from a measured CSV feature table without inventing data", () => {
    const { micrograph } = simulateTransmissiveMicroscope({
      sourceMode: "Measured Table (CSV)",
      table: {
        columns: ["x_um", "y_um", "radius_um", "thickness_um", "attenuation_inv_um"],
        rows: [
          ["250", "250", "60", "40", "0.06"],
        ],
      },
      gridN: 48,
      magnification: 40, // FOV = 500 µm
      numericalAperture: 0.75,
      wavelengthNm: 520,
      focusOffsetUm: 0,
      immersionIndex: 1.0,
      illuminationMode: "Brightfield",
      exposure: 1.0,
      matrixThicknessUm: 50,
      matrixAttenInvUm: 0.001,
      featureAttenInvUm: 0.05,
      matrixRefractiveIndex: 1.33,
      featureRefractiveIndex: 1.5,
      featureDiameterUm: 20,
      featureVolumeFractionPct: 10,
      chromophoreConcMolM3: 0,
      molarAbsorptivityM2Mol: 0,
      reticleFrequencyLpMm: 20,
      seed: 7,
    });

    // Center pixel should have higher optical density than corner pixel
    const centerIdx = Math.floor(48 / 2) * 48 + Math.floor(48 / 2);
    const cornerIdx = 0;
    assert.ok(
      micrograph.opticalDensityGrid[centerIdx] >
        micrograph.opticalDensityGrid[cornerIdx] + 0.3,
    );
    assert.match(micrograph.provenanceLabel, /Measured Table/);
  });

  it("degrades grating contrast when defocused far beyond Depth of Field (DOF)", () => {
    const baseParams = {
      sourceMode: "Calibration Reticle (Ronchi / Step)" as const,
      gridN: 64,
      magnification: 40,
      numericalAperture: 0.75,
      wavelengthNm: 550,
      immersionIndex: 1.0,
      illuminationMode: "Brightfield" as const,
      exposure: 1.0,
      matrixThicknessUm: 40,
      matrixAttenInvUm: 0.001,
      featureAttenInvUm: 0.06,
      matrixRefractiveIndex: 1.33,
      featureRefractiveIndex: 1.5,
      featureDiameterUm: 20,
      featureVolumeFractionPct: 20,
      chromophoreConcMolM3: 0,
      molarAbsorptivityM2Mol: 0,
      reticleFrequencyLpMm: 60,
      seed: 42,
    };

    const inFocus = simulateTransmissiveMicroscope({
      ...baseParams,
      focusOffsetUm: 0,
    }).micrograph;
    const defocused = simulateTransmissiveMicroscope({
      ...baseParams,
      focusOffsetUm: 45, // >> DOF
    }).micrograph;

    // Measure std-dev across a row in the upper half (Ronchi grating region)
    const rowY = Math.floor(64 * 0.25);
    const stdRow = (grid: number[]) => {
      const slice = grid.slice(rowY * 64, (rowY + 1) * 64);
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      return Math.sqrt(
        slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / slice.length,
      );
    };

    const modInFocus = stdRow(inFocus.transmittanceGrid);
    const modDefocused = stdRow(defocused.transmittanceGrid);
    assert.ok(
      modInFocus > modDefocused * 1.4,
      `Expected in-focus grating modulation (${modInFocus.toFixed(4)}) > defocused (${modDefocused.toFixed(4)})`,
    );
  });

  it("is 100% deterministic for a fixed seed and executes inside the flow engine", () => {
    const r1 = mulberry32(12345);
    const r2 = mulberry32(12345);
    for (let i = 0; i < 20; i++) {
      assert.equal(r1(), r2());
    }

    const p = blankProject();
    const micNode = makeNode("transmissiveMicroscope", 100, 100, []);
    const dispNode = makeNode("microscopeDisplay", 420, 100, []);
    p.nodes = [micNode, dispNode];
    p.edges = [
      {
        id: "e-mic-disp",
        source: micNode.id,
        sourceHandle: "micrograph",
        target: dispNode.id,
        targetHandle: "micrograph",
      },
    ];

    const run = execute(p);
    assert.equal(run.results[micNode.id].status, "ok");
    assert.equal(run.results[dispNode.id].status, "ok");
    const out = run.results[micNode.id].outputs;
    assert.equal(out.micrograph?.type, "micrograph");
    assert.equal(out.transmittance?.type, "number");
    assert.equal(out.opticalDensity?.type, "number");
    assert.equal(out.lineProfile?.type, "signal");
  });
});
```

#### 2. Exact Change in `package.json`

In `package.json` (line 14), append `src/core/microscope.test.ts` to the `"test"` script:
Replace:
```json
    "test": "tsx --test src/core/engine.test.ts src/core/expression.conformance.test.ts src/core/study/batch.test.ts src/core/study/eval-batch.test.ts",
```
With:
```json
    "test": "tsx --test src/core/engine.test.ts src/core/expression.conformance.test.ts src/core/study/batch.test.ts src/core/study/eval-batch.test.ts src/core/microscope.test.ts",
```

---

## 3. End-to-End Verification Checklist for the Executing Agent

After completing `TM-1` through `TM-6`, run the following four commands in `/home/saba/Desktop/AppFusion/lattice-lab`:

```bash
npm test
npm run build
npm run test:server
uv run --directory server ruff check .
```

Verify that:
1. `npm test` runs all 5 test suites including `src/core/microscope.test.ts` with `0` failures.
2. `npm run build` (`tsc --noEmit && vite build`) succeeds with `0` TypeScript or bundler errors.
3. `npm run test:server` passes all Python tests (`0` failures).
4. `uv run --directory server ruff check .` reports `All checks passed!`.

---

## 7. Progress Tracker

Update the status column (`todo` → `in progress` → `done`) as you execute each task:

| Task ID | Title | Key Files | Status |
| :--- | :--- | :--- | :--- |
| `TM-1` | Extend `DataType`, `Packet`, `MicrographData`, `typeColors`, and Georgian localization | `src/core/types.ts`, `src/core/ka.ts` | `done` |
| `TM-2` | Implement deterministic optical physics & known surface engine | `src/core/microscope.ts` | `done` |
| `TM-3` | Register `transmissiveMicroscope` and `microscopeDisplay` nodes + canvas icon | `src/core/registry.ts`, `src/NodeCard.tsx` | `done` |
| `TM-4` | Build interactive `<canvas>` `MicroscopeView`, `PacketView` integration & CSV/PNG export | `src/MicroscopeView.tsx`, `src/Plots.tsx`, `src/Workspace.tsx`, `src/workspace.css` | `done` |
| `TM-5` | Register optical units (`OD`, `1/µm`, `m²/mol`, `×`, `px`) in frontend & backend | `src/study/units.ts`, `server/lattice_server/units.py` | `done` |
| `TM-6` | Add unit & physics conformance test suite for the digital microscope | `src/core/microscope.test.ts`, `package.json` | `done` |
| `TM-7` | SEM 3D Topographic Relief Shading & Keratin Cuticle Architecture (Edge emission δ ∝ sec θ, Lambertian diffuse, ambient occlusion, shingle terrace wear) | `src/MicroscopeView.tsx`, `src/core/microscope.ts`, `src/core/microscope.test.ts` | `done` |
| `TM-8` | Interactive Microscope Workstation Dialog (Stage pan & zoom 1x-12x, dynamic scale bar, minimap radar, Z-focus knob, objective turret 10x-100x, caliper distance & elevation tool, virtual detector lighting) | `src/InteractiveMicroscopeModal.tsx`, `src/MicroscopeView.tsx`, `src/NodeCard.tsx` | `done` |

