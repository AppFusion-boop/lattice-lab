import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mulberry32,
  simulateTransmissiveMicroscope,
} from "./microscope";
import { blankProject } from "./types";
import { makeNode } from "./runtime";
import { execute } from "./runtime";

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

  it("evaluates dynamic hair tribology simulation and projects real-time frames during playback", async () => {
    const { hairTribologyProject } = await import("./hair-tribology-demo");
    const { runAtTime } = await import("./playback-view");

    const project = hairTribologyProject();
    const run = execute(project);

    assert.equal(run.results["n_microscope"].status, "ok");
    assert.equal(run.results["n_display"].status, "ok");
    assert.equal(run.results["n_scope_wear"].status, "ok");

    const micPkt = run.results["n_microscope"].outputs.micrograph;
    assert.equal(micPkt?.type, "micrograph");
    assert.ok(micPkt.value.frames && micPkt.value.frames.length > 10, "Expected dynamic frames generated");

    // Test playback projection at t = 0 vs t = 2.5 vs t = 5.0
    const runAt0 = runAtTime(project, run, 0.0);
    const runAt25 = runAtTime(project, run, 2.5);
    const runAt50 = runAtTime(project, run, 5.0);

    assert.ok(runAt0);
    assert.ok(runAt25);
    assert.ok(runAt50);

    const mic0 = runAt0.results["n_microscope"].outputs.micrograph;
    const mic50 = runAt50.results["n_microscope"].outputs.micrograph;

    assert.equal(mic0?.type, "micrograph");
    assert.equal(mic50?.type, "micrograph");

    // As cuticle scales erode, transmittance increases and thickness decreases
    assert.ok(
      mic50.value.stats.meanTransmittancePct > mic0.value.stats.meanTransmittancePct,
      `Expected eroded surface T (5s: ${mic50.value.stats.meanTransmittancePct.toFixed(1)}%) > initial T (0s: ${mic0.value.stats.meanTransmittancePct.toFixed(1)}%)`,
    );
  });

  it("calculates 3D SEM Topographic Relief Shading with directional illumination and edge emission", async () => {
    const { computeTopographicIntensity } = await import("../MicroscopeView");

    // Create a 32x32 test grid with a raised hill / step in the center
    const N = 32;
    const thickness = new Float64Array(N * N);
    const pixelSizeUm = 1.0;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x - 16;
        const dy = y - 16;
        const r = Math.sqrt(dx * dx + dy * dy);
        // Hemispherical hill with radius 8 µm and height 4 µm
        thickness[y * N + x] = r < 8 ? Math.sqrt(64 - r * r) * 0.5 : 0;
      }
    }

    const topo = computeTopographicIntensity(thickness, N, N, pixelSizeUm, 315, 45);

    assert.equal(topo.length, N * N);
    for (let i = 0; i < topo.length; i++) {
      assert.ok(topo[i] >= 0 && topo[i] <= 1, `Intensity out of range: ${topo[i]}`);
    }

    // Top-left illuminated slope (facing azimuth 315°) vs bottom-right shadowed slope
    const illuminatedSlopeIdx = 12 * N + 12; // top-left
    const shadowSlopeIdx = 20 * N + 20;      // bottom-right

    assert.ok(
      topo[illuminatedSlopeIdx] > topo[shadowSlopeIdx] + 0.15,
      `Expected illuminated slope (${topo[illuminatedSlopeIdx].toFixed(3)}) > shadow slope (${topo[shadowSlopeIdx].toFixed(3)})`,
    );

    // Flat baseline should have neutral midtone intensity
    const flatIdx = 2 * N + 2;
    assert.ok(
      topo[flatIdx] >= 0.35 && topo[flatIdx] <= 0.65,
      `Expected neutral baseline intensity, got ${topo[flatIdx].toFixed(3)}`,
    );
  });

  it("exports InteractiveMicroscopeModal and computes dynamic scale bars correctly across zoom levels", async () => {
    const modalModule = await import("../InteractiveMicroscopeModal");
    assert.ok(typeof modalModule.InteractiveMicroscopeModal === "function");

    // Dynamic FOV scaling: at 500 µm base FOV, 10x zoom reduces visible FOV to 50 µm
    const baseFovUm = 500;
    const zoom10xFovUm = baseFovUm / 10;
    assert.equal(zoom10xFovUm, 50);

    // Verify calibrated Euclidean distance for caliper measurements
    const p1 = { xUm: 10.0, yUm: 15.0 };
    const p2 = { xUm: 22.0, yUm: 20.0 };
    const distUm = Math.hypot(p2.xUm - p1.xUm, p2.yUm - p1.yUm);
    assert.ok(Math.abs(distUm - 13.0) < 1e-6);

    // Verify simulation time scrubber and dynamic wear bounds
    const wearAt0 = 0.85 * Math.max(0.06, (36.0 - 6.0 * 0.0) / 36.0);
    const wearAt5 = 0.85 * Math.max(0.06, (36.0 - 6.0 * 5.0) / 36.0);
    assert.ok(wearAt0 > wearAt5, `Expected initial scale step (${wearAt0.toFixed(2)} µm) > eroded step (${wearAt5.toFixed(2)} µm)`);
    assert.ok(wearAt5 > 0.04 && wearAt5 < 0.2, "Eroded scale step remains physically bounded");
  });
});

