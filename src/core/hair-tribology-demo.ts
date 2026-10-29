import { blankProject, type Project } from "./types.ts";

/**
 * Generates an illustrative physical simulation flow graph for:
 * Hair Keratin Fiber Tribology & Cuticle Abrasion Wear (Transmissive Microscopy)
 *
 * Demonstrates in-situ real-time micrograph evolution as hair fibers rub
 * against each other over 5.0 seconds. The protruding keratin cuticle scales
 * (~0.8 µm shingle height) undergo progressive mechanical shear wear
 * (Archard wear law: Δh = kw * P * v * t), smoothing down the surface roughness
 * and altering optical transmittance and diffraction contrast in real time.
 */
export function hairTribologyProject(): Project {
  const p = blankProject();
  p.name = "თმის კუტიკულის ტრიბოლოგია & აბრაზიული ცვეთა (Hair Cuticle Friction Wear)";
  p.duration = 5.0;
  p.sampleRate = 50;

  p.nodes = [
    {
      id: "n_stroke",
      kind: "generator",
      label: "Reciprocating Rubbing Stroke (mm)",
      position: { x: 40, y: 160 },
      params: {
        wave: "triangle",
        frequency: 1.0,
        amplitude: 5.0,
        offset: 0.0,
        phase: 0.0,
        unit: "mm",
      },
    },
    {
      id: "n_friction",
      kind: "formula",
      label: "Frictional Shear Force (mN)",
      position: { x: 340, y: 60 },
      params: {
        expression: "120.0 * (0.35 + 0.06 * (a / 5.0) - 0.02 * t)",
        a: 0.0,
        b: 0.0,
        unit: "mN",
      },
    },
    {
      id: "n_wear_thick",
      kind: "formula",
      label: "Cuticle Layer Thickness d(t) (µm)",
      position: { x: 340, y: 220 },
      // Archard wear: Starting from 32 µm fiber matrix, cuticle wears down toward 18 µm over 5s
      params: {
        expression: "max(18.0, 32.0 - 2.8 * t + 0.2 * (a / 5.0))",
        a: 0.0,
        b: 0.0,
        unit: "µm",
      },
    },
    {
      id: "n_scale_frac",
      kind: "formula",
      label: "Cuticle Scale Roughness Fraction (%)",
      position: { x: 340, y: 380 },
      // Cuticle shingles erode from 36% protrusion down to ~8% polished smooth surface
      params: {
        expression: "max(6.0, 36.0 - 5.8 * t + 1.5 * (a / 5.0))",
        a: 0.0,
        b: 0.0,
        unit: "%",
      },
    },
    {
      id: "n_vibration",
      kind: "formula",
      label: "Stage Micro-Vibration Δz (µm)",
      position: { x: 340, y: 540 },
      params: {
        expression: "0.35 * sin(2.0 * pi * 1.5 * t)",
        a: 0.0,
        b: 0.0,
        unit: "µm",
      },
    },
    {
      id: "n_microscope",
      kind: "transmissiveMicroscope",
      label: "Transmissive Microscope",
      position: { x: 680, y: 260 },
      params: {
        sourceMode: "Coupled Physical Inputs",
        illuminationMode: "Brightfield",
        magnification: 40.0,
        numericalAperture: 0.65,
        wavelengthNm: 546.0,
        focusOffsetUm: 0.0,
        immersionIndex: 1.0,
        exposure: 1.0,
        gridN: 64.0,
        matrixThicknessUm: 32.0,
        matrixAttenInvUm: 0.005,
        featureAttenInvUm: 0.075,
        matrixRefractiveIndex: 1.54, // Keratin bulk cortex refractive index
        featureRefractiveIndex: 1.51, // Cuticle scale lipid layer refractive index
        featureDiameterUm: 12.0, // Scale shingle length ~12 µm
        featureVolumeFractionPct: 36.0,
        chromophoreConcMolM3: 40.0, // Melanin pigmentation
        molarAbsorptivityM2Mol: 0.15,
        reticleFrequencyLpMm: 50.0,
        seed: 777.0,
      },
    },
    {
      id: "n_display",
      kind: "microscopeDisplay",
      label: "Real-Time Micrograph Viewport",
      position: { x: 1040, y: 120 },
      params: {},
    },
    {
      id: "n_scope_wear",
      kind: "scope",
      label: "Cuticle Wear & Friction Kinetics",
      position: { x: 1040, y: 320 },
      params: {},
    },
    {
      id: "n_scope_optical",
      kind: "scope",
      label: "Optical Centerline Transmission",
      position: { x: 1040, y: 500 },
      params: {},
    },
  ];

  p.edges = [
    {
      id: "e_stroke_fric",
      source: "n_stroke",
      sourceHandle: "signal",
      target: "n_friction",
      targetHandle: "a",
    },
    {
      id: "e_stroke_thick",
      source: "n_stroke",
      sourceHandle: "signal",
      target: "n_wear_thick",
      targetHandle: "a",
    },
    {
      id: "e_stroke_frac",
      source: "n_stroke",
      sourceHandle: "signal",
      target: "n_scale_frac",
      targetHandle: "a",
    },
    {
      id: "e_thick_mic",
      source: "n_wear_thick",
      sourceHandle: "result",
      target: "n_microscope",
      targetHandle: "thickness",
    },
    {
      id: "e_frac_mic",
      source: "n_scale_frac",
      sourceHandle: "result",
      target: "n_microscope",
      targetHandle: "volumeFraction",
    },
    {
      id: "e_vib_mic",
      source: "n_vibration",
      sourceHandle: "result",
      target: "n_microscope",
      targetHandle: "focusOffset",
    },
    {
      id: "e_mic_disp",
      source: "n_microscope",
      sourceHandle: "micrograph",
      target: "n_display",
      targetHandle: "micrograph",
    },
    {
      id: "e_mic_scan",
      source: "n_microscope",
      sourceHandle: "lineProfile",
      target: "n_scope_optical",
      targetHandle: "ch1",
    },
    {
      id: "e_wear_scope",
      source: "n_wear_thick",
      sourceHandle: "result",
      target: "n_scope_wear",
      targetHandle: "ch1",
    },
    {
      id: "e_fric_scope",
      source: "n_friction",
      sourceHandle: "result",
      target: "n_scope_wear",
      targetHandle: "ch2",
    },
  ];

  return p;
}
