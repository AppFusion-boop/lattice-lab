import { blankProject, type Project, type Object3D } from "./types.ts";
import { makeNode } from "./runtime.ts";
import { sensorOutputId } from "./registry.ts";

/**
 * Generates an illustrative 3D conjugate heat transfer model and flow graph
 * for microchannel cold plate optimization.
 */
export function microchannelProject(): Project {
  const p = blankProject();
  p.name = "მიკროარხული გამაგრილებელი ფილა (Microchannel Cold Plate Optimization)";
  p.duration = 4;
  p.sampleRate = 50;

  // 1. Build 3D Geometric Objects for Cold Plate Assembly (centered around 10, 3, 10 in a 20x20x10 space)
  const objects: Object3D[] = [];

  // Copper Base Plate Substrate (50mm x 50mm footprint in illustrative coordinates)
  objects.push({
    id: "base_plate",
    name: "სპილენძის საბაზო ფილა (Copper Substrate Base)",
    shape: "box",
    position: { x: 10, y: 1.2, z: 10 },
    size: { x: 14, y: 1.2, z: 14 },
    rotation: 0,
    color: "#b45309",
  });

  // Silicon Semiconductor Die mounted underneath
  objects.push({
    id: "die_package",
    name: "სილიკონის ჩიპის პაკეტი (Silicon Die 20x20mm)",
    shape: "box",
    position: { x: 10, y: 0.25, z: 10 },
    size: { x: 7, y: 0.5, z: 7 },
    rotation: 0,
    color: "#1e293b",
  });

  // Active Transistor Junction Hotspot (Core)
  objects.push({
    id: "junction_core",
    name: "აქტიური თერმული ზონა (Hotspot Core)",
    shape: "box",
    position: { x: 10, y: 0.52, z: 10 },
    size: { x: 4.5, y: 0.1, z: 4.5 },
    rotation: 0,
    color: "#ef4444",
  });

  // 11 Parallel Copper Microchannel Fins
  for (let i = 0; i <= 10; i++) {
    const x = Number((3.6 + i * 1.28).toFixed(2));
    objects.push({
      id: `fin_${i}`,
      name: `მიკრო-ფარფლი #${i + 1} (Copper Fin #${i + 1})`,
      shape: "box",
      position: { x, y: 3.2, z: 10 },
      size: { x: 0.38, y: 2.8, z: 12.6 },
      rotation: 0,
      color: "#d97706",
    });
  }

  // 10 Coolant Fluid Flow Streams in channels between fins
  for (let i = 0; i < 10; i++) {
    const x = Number((4.24 + i * 1.28).toFixed(2));
    objects.push({
      id: `stream_${i}`,
      name: `გამაგრილებლის ნაკადი #${i + 1} (Coolant Stream #${i + 1})`,
      shape: "box",
      position: { x, y: 3.0, z: 10 },
      size: { x: 0.72, y: 2.3, z: 12.2 },
      rotation: 0,
      color: "#38bdf8",
    });
  }

  // Inlet Manifold Header (Coolant In, 25°C)
  objects.push({
    id: "manifold_inlet",
    name: "შემავალი კოლექტორი (Inlet Header 25°C)",
    shape: "cylinder",
    position: { x: 10, y: 3.2, z: 2.5 },
    size: { x: 2.2, y: 13.6, z: 2.2 },
    rotation: 0,
    rotationVec: { x: 0, y: 0, z: 90 },
    color: "#0284c7",
  });

  // Outlet Manifold Header (Heated Coolant Out)
  objects.push({
    id: "manifold_outlet",
    name: "გამომავალი კოლექტორი (Heated Outlet Return)",
    shape: "cylinder",
    position: { x: 10, y: 3.2, z: 17.5 },
    size: { x: 2.2, y: 13.6, z: 2.2 },
    rotation: 0,
    rotationVec: { x: 0, y: 0, z: 90 },
    color: "#ea580c",
  });

  // Top Transparent Manifold Window Cover
  objects.push({
    id: "manifold_cover",
    name: "ზედა დამცავი სახურავი (Transparent Cover)",
    shape: "box",
    position: { x: 10, y: 4.8, z: 10 },
    size: { x: 14.4, y: 0.4, z: 14.4 },
    rotation: 0,
    color: "#94a3b8",
  });

  // 2. Build LabNodes in Canvas
  const add = (
    id: string,
    kind: string,
    x: number,
    y: number,
    params: Record<string, unknown> = {},
    label?: string,
  ) => {
    const n = makeNode(kind, x, y);
    n.id = id;
    n.params = { ...n.params, ...params };
    if (label) n.label = label;
    p.nodes.push(n);
    return n;
  };

  // 3D Scene Node with Assembly
  add(
    "scene_coldplate",
    "scene3d",
    540,
    -100,
    {
      width: 20,
      depth: 20,
      height: 10,
      environment: "Open space",
      temperature: 25,
      objects,
    },
    "3D მიკროარხული ფილა (3D Cold Plate Assembly)",
  );

  // Trigger Node
  add("trigger_start", "manual", 40, -100, {}, "დაწყების სიგნალი (Run Trigger)");

  // Heat Load Pulse (Scene Event)
  add(
    "heat_pulse",
    "temperatureChange",
    280,
    -140,
    {
      x: 10,
      y: 0.5,
      z: 10,
      delta: 26.8,
      rise: 0.6,
      duration: 4.0,
      radius: 10,
      profile: "Ramp",
    },
    "თერმული იმპულსი (Heat Flux Load Pulse)",
  );

  // Temperature Probe Sensor (attached at silicon junction hotspot)
  add(
    "temp_sensor",
    "temperature",
    280,
    20,
    { x: 10, y: 0.5, z: 10, tau: 0.05 },
    "კვანძის ტემპერატურის ზონდი (Die Sensor)",
  );

  // Thermal Oscilloscope
  add(
    "scope_temp",
    "scope",
    880,
    -100,
    {},
    "ტემპერატურის ოსცილოგრამა (Thermal Scope)",
  );

  // Controlled Parameters: Input Formula Nodes
  add(
    "node_width",
    "formula",
    40,
    100,
    { expression: "a", a: 0.4, b: 0, unit: "mm" },
    "არხის სიგანე w_c (Channel Width)",
  );

  add(
    "node_fin",
    "formula",
    40,
    240,
    { expression: "a", a: 0.3, b: 0, unit: "mm" },
    "ფარფლის სისქე w_f (Fin Thickness)",
  );

  add(
    "node_alpha",
    "formula",
    40,
    380,
    { expression: "a", a: 6.0, b: 0, unit: "" },
    "ასპექტური ფარდობა alpha (Aspect Ratio)",
  );

  add(
    "node_vel",
    "formula",
    40,
    520,
    { expression: "a", a: 1.2, b: 0, unit: "m/s" },
    "ნაკადის სიჩქარე v (Flow Velocity)",
  );

  add(
    "node_qflux",
    "formula",
    40,
    660,
    { expression: "a", a: 130.0, b: 0, unit: "W/cm²" },
    "სითბური ნაკადი q'' (Heat Flux)",
  );

  // Physics & Hydraulic Calculations
  add(
    "node_dh",
    "formula",
    320,
    240,
    { expression: "(2 * a * b) / (1 + b)", a: 0.4, b: 6.0, unit: "mm" },
    "ჰიდრავლიკური დიამეტრი D_h (Hydraulic Dia)",
  );

  add(
    "node_dp",
    "formula",
    620,
    240,
    {
      expression: "clamp(8.5 * a / (b * b) + 1.2 * a * a, 0.5, 120)",
      a: 1.2,
      b: 0.68,
      unit: "kPa",
    },
    "წნევის ვარდნა Delta P (Pressure Drop)",
  );

  add(
    "node_rth",
    "formula",
    320,
    520,
    {
      expression: "(0.18 / sqrt(a)) * (1 / (1 + 0.15 * b)) + 0.12",
      a: 1.2,
      b: 6.0,
      unit: "°C/(W/cm²)",
    },
    "თერმული წინაღობა R_th (Thermal Resistance)",
  );

  add(
    "node_delta_t",
    "formula",
    620,
    520,
    { expression: "a * b", a: 130.0, b: 0.206, unit: "°C" },
    "ტემპერატურის ნაზარდი Delta T (Temp Rise)",
  );

  add(
    "node_t_junction",
    "formula",
    880,
    520,
    { expression: "a + 25", a: 26.8, b: 0, unit: "°C" },
    "კვანძის ტემპერატურა T_junction (Junction Temp)",
  );

  // 3. Connect Edges
  const link = (
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
  ) => {
    p.edges.push({
      id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
      source,
      sourceHandle,
      target,
      targetHandle,
    });
  };

  // Wire 3D Scene and transient signal chain
  link("trigger_start", "event", "scene_coldplate", "trigger");
  link("heat_pulse", "effect", "scene_coldplate", "events");
  link("temp_sensor", "sensor", "scene_coldplate", "sensors");
  link("scene_coldplate", sensorOutputId("temp_sensor"), "scope_temp", "ch1");

  // Wire hydraulic chain
  link("node_width", "result", "node_dh", "a");
  link("node_alpha", "result", "node_dh", "b");
  link("node_vel", "result", "node_dp", "a");
  link("node_dh", "result", "node_dp", "b");

  // Wire thermal conjugate heat transfer chain
  link("node_vel", "result", "node_rth", "a");
  link("node_alpha", "result", "node_rth", "b");
  link("node_qflux", "result", "node_delta_t", "a");
  link("node_rth", "result", "node_delta_t", "b");
  link("node_delta_t", "result", "node_t_junction", "a");

  return p;
}

