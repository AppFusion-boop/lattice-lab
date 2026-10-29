import { blankProject, type Project } from "./types.ts";

/**
 * Generates an illustrative flow graph and transmissive microscope simulation model
 * for microfluidic drug-delivery microcapsule / emulsion quality screening.
 */
export function microscopeProject(): Project {
  const p = blankProject();
  p.name = "მიკროკაფსულების ტრანსმისიური მიკროსკოპია (Microcapsule Transmissive Optical Analysis)";
  p.duration = 5;
  p.sampleRate = 50;

  p.nodes = [
    {
      id: "n_diam",
      kind: "formula",
      label: "Feature Diam (µm)",
      position: { x: 60, y: 80 },
      params: { expression: "a", a: 28.0, b: 0.0, unit: "µm" },
    },
    {
      id: "n_frac",
      kind: "formula",
      label: "Volume Fraction (%)",
      position: { x: 60, y: 200 },
      params: { expression: "a", a: 18.0, b: 0.0, unit: "%" },
    },
    {
      id: "n_thick",
      kind: "formula",
      label: "Specimen Thickness (µm)",
      position: { x: 60, y: 320 },
      params: { expression: "a", a: 50.0, b: 0.0, unit: "µm" },
    },
    {
      id: "n_conc",
      kind: "formula",
      label: "Dye Concentration (mol/m³)",
      position: { x: 60, y: 440 },
      params: { expression: "a", a: 10.0, b: 0.0, unit: "" },
    },
    {
      id: "n_focus",
      kind: "formula",
      label: "Focus Offset Δz (µm)",
      position: { x: 60, y: 560 },
      params: { expression: "a", a: 0.0, b: 0.0, unit: "µm" },
    },
    {
      id: "n_microscope",
      kind: "transmissiveMicroscope",
      label: "Transmissive Microscope",
      position: { x: 420, y: 180 },
      params: {
        sourceMode: "Coupled Physical Inputs",
        illuminationMode: "Brightfield",
        magnification: 40.0,
        numericalAperture: 0.65,
        wavelengthNm: 550.0,
        focusOffsetUm: 0.0,
        immersionIndex: 1.0,
        exposure: 1.0,
        gridN: 80.0,
        matrixThicknessUm: 50.0,
        matrixAttenInvUm: 0.003,
        featureAttenInvUm: 0.045,
        matrixRefractiveIndex: 1.333,
        featureRefractiveIndex: 1.48,
        featureDiameterUm: 28.0,
        featureVolumeFractionPct: 18.0,
        molarAbsorptivityM2Mol: 85.0,
        reticleFrequencyLpMm: 40.0,
        seed: 42.0,
      },
    },
    {
      id: "n_display",
      kind: "microscopeDisplay",
      label: "Micrograph Viewport",
      position: { x: 860, y: 100 },
      params: {},
    },
    {
      id: "n_scope",
      kind: "scope",
      label: "Centerline Scan Profile",
      position: { x: 860, y: 280 },
      params: {},
    },
  ];

  p.edges = [
    { id: "e_diam", source: "n_diam", sourceHandle: "result", target: "n_microscope", targetHandle: "featureDiameter" },
    { id: "e_frac", source: "n_frac", sourceHandle: "result", target: "n_microscope", targetHandle: "volumeFraction" },
    { id: "e_thick", source: "n_thick", sourceHandle: "result", target: "n_microscope", targetHandle: "thickness" },
    { id: "e_conc", source: "n_conc", sourceHandle: "result", target: "n_microscope", targetHandle: "concentration" },
    { id: "e_focus", source: "n_focus", sourceHandle: "result", target: "n_microscope", targetHandle: "focusOffset" },
    { id: "e_view", source: "n_microscope", sourceHandle: "micrograph", target: "n_display", targetHandle: "micrograph" },
    { id: "e_scan", source: "n_microscope", sourceHandle: "lineProfile", target: "n_scope", targetHandle: "ch1" },
  ];

  return p;
}

