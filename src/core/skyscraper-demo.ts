import { blankProject, type Project, type Object3D } from "./types.ts";
import { makeNode } from "./runtime.ts";
import { sensorOutputId } from "./registry.ts";

/**
 * Generates an illustrative 3D structural model and flow graph
 * for Ultra-High-Performance Damped Cementitious Composites in Tall Buildings.
 */
export function skyscraperProject(): Project {
  const p = blankProject();
  p.name = "თვითჩამქრობი ბეტონის კომპოზიტი ცათამბჯენებისთვის (Smart Damped Cement Skyscraper)";
  p.duration = 6;
  p.sampleRate = 50;

  // 1. Build 3D Geometric Objects for 300m Supertall Tower (centered at x=15, z=15 in a 30x50x30 space)
  const objects: Object3D[] = [];

  // Deep Reinforced Concrete Mat Foundation
  objects.push({
    id: "foundation_mat",
    name: "საძირკვლის რკინაბეტონის ფილა (Foundation Mat Slab)",
    shape: "box",
    position: { x: 15, y: 1.0, z: 15 },
    size: { x: 24, y: 2.0, z: 24 },
    rotation: 0,
    color: "#334155",
  });

  // Central UHPC Shear Core Tube
  objects.push({
    id: "shear_core",
    name: "ცენტრალური ხისტი ბირთვი (Central Shear Core)",
    shape: "box",
    position: { x: 15, y: 23, z: 15 },
    size: { x: 8, y: 42, z: 8 },
    rotation: 0,
    color: "#64748b",
  });

  // 4 Perimeter Mega-Columns (Corner Structural Columns)
  const colPositions = [
    { id: "col_sw", name: "მეგა-სვეტი SW (Mega Column SW)", x: 6.5, z: 6.5 },
    { id: "col_se", name: "მეგა-სვეტი SE (Mega Column SE)", x: 23.5, z: 6.5 },
    { id: "col_ne", name: "მეგა-სვეტი NE (Mega Column NE)", x: 23.5, z: 23.5 },
    { id: "col_nw", name: "მეგა-სვეტი NW (Mega Column NW)", x: 6.5, z: 23.5 },
  ];

  for (const c of colPositions) {
    objects.push({
      id: c.id,
      name: c.name,
      shape: "box",
      position: { x: c.x, y: 22, z: c.z },
      size: { x: 2.2, y: 40, z: 2.2 },
      rotation: 0,
      color: "#475569",
    });
  }

  // 8 Diaphragm Floor Slabs
  for (let i = 1; i <= 8; i++) {
    const y = 2 + i * 5;
    objects.push({
      id: `floor_slab_${i}`,
      name: `სართულის დიაფრაგმა #${i * 6} (Floor Slab L${i * 6})`,
      shape: "box",
      position: { x: 15, y, z: 15 },
      size: { x: 19, y: 0.5, z: 19 },
      rotation: 0,
      color: "#94a3b8",
    });
  }

  // Mid-Height & Top Outrigger Belt Trusses (Viscoelastic Damped Belts)
  objects.push({
    id: "outrigger_mid",
    name: "შუალედური დემპფერული აუტრიგერი (Mid-Height Damped Outrigger)",
    shape: "box",
    position: { x: 15, y: 22, z: 15 },
    size: { x: 20, y: 2.2, z: 20 },
    rotation: 0,
    color: "#0284c7",
  });

  objects.push({
    id: "outrigger_top",
    name: "სახურავის აუტრიგერის სარტყელი (Roof Belt Outrigger)",
    shape: "box",
    position: { x: 15, y: 42, z: 15 },
    size: { x: 19.5, y: 2.0, z: 19.5 },
    rotation: 0,
    color: "#0369a1",
  });

  // Aerodynamic Glass Curtain Wall Facade Envelope
  objects.push({
    id: "curtain_wall",
    name: "აეროდინამიკური შუშის ფასადი (Curtain Wall Envelope)",
    shape: "box",
    position: { x: 15, y: 22, z: 15 },
    size: { x: 18.2, y: 39.5, z: 18.2 },
    rotation: 0,
    color: "#38bdf8",
  });

  // Rooftop Crown Spire
  objects.push({
    id: "spire_crown",
    name: "არქიტექტურული შპილი (Penthouse Spire)",
    shape: "cylinder",
    position: { x: 15, y: 46.5, z: 15 },
    size: { x: 2.0, y: 7.0, z: 2.0 },
    rotation: 0,
    color: "#e2e8f0",
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

  // 3D Scene Node
  add(
    "scene_skyscraper",
    "scene3d",
    540,
    -100,
    {
      width: 30,
      depth: 30,
      height: 50,
      environment: "Open space",
      temperature: 20,
      objects,
    },
    "3D ცათამბჯენის კონსტრუქცია (300m Tower Scene)",
  );

  // Trigger Node
  add("trigger_wind", "manual", 40, -100, {}, "ქარის შტორმის იმპულსი (Wind Storm Trigger)");

  // Wind Vortex-Shedding Dynamic Excitation Event
  add(
    "wind_excitation",
    "vibration",
    280,
    -140,
    {
      x: 15,
      y: 35,
      z: 15,
      amplitude: 14.5,
      frequency: 0.25,
      damping: 0.35,
      phase: 0,
      radius: 25,
    },
    "ქარის გრიგალის რხევა (Wind Vortex Shedding)",
  );

  // Accelerometer Sensor Probe at Rooftop Penthouse
  add(
    "accel_sensor_top",
    "accelerometer",
    280,
    20,
    { x: 15, y: 42, z: 15, frequency: 0.25 },
    "სახურავის აჩქარების სენსორი (Penthouse Accelerometer)",
  );

  // Acceleration Dynamic Scope
  add(
    "scope_accel",
    "scope",
    880,
    -100,
    {},
    "რხევის აჩქარების ოსცილოგრამა (Vibration Scope)",
  );

  // Controlled Mix Design Parameters: Formula Input Nodes
  add(
    "node_wb",
    "formula",
    40,
    100,
    { expression: "a", a: 0.22, b: 0, unit: "" },
    "წყალ-შემკვრელის ფარდობა w/b (Water-to-Binder)",
  );

  add(
    "node_sf",
    "formula",
    40,
    220,
    { expression: "a", a: 0.15, b: 0, unit: "ratio" },
    "მიკრო-სილიციუმის წილი (Silica Fume Ratio)",
  );

  add(
    "node_polymer",
    "formula",
    40,
    340,
    { expression: "a", a: 4.5, b: 0, unit: "%" },
    "ვისკოელასტიური პოლიმერი p/c (Polymer Dosage)",
  );

  add(
    "node_fiber",
    "formula",
    40,
    460,
    { expression: "a", a: 1.2, b: 0, unit: "%" },
    "ფიბრის მოცულობითი წილი V_f (Fiber Volume)",
  );

  add(
    "node_wind_gust",
    "formula",
    40,
    580,
    { expression: "a", a: 42.0, b: 0, unit: "m/s" },
    "ქარის მაქსიმალური სიჩქარე (Wind Gust Speed)",
  );

  // Chained Physics Formula Nodes (each strictly uses a and b)
  // 1. Compressive Strength fc
  add(
    "node_fc_base",
    "formula",
    280,
    100,
    {
      expression: "clamp((210 / (1 + 3.2 * a)) * (1 + 0.6 * b), 50, 180)",
      a: 0.22,
      b: 0.15,
      unit: "MPa",
    },
    "ბაზური სიმტკიცე (Matrix Base fc)",
  );

  add(
    "node_fc_mod",
    "formula",
    280,
    220,
    {
      expression: "clamp(1 - 0.035 * a + 0.08 * b, 0.5, 1.3)",
      a: 4.5,
      b: 1.2,
      unit: "factor",
    },
    "მოდიფიკატორის კოეფიციენტი (Poly/Fiber Mod)",
  );

  add(
    "node_fc",
    "formula",
    500,
    100,
    {
      expression: "clamp(a * b, 45, 180)",
      a: 123.0,
      b: 0.95,
      unit: "MPa",
    },
    "სიმტკიცე კუმშვაზე f_c (Compressive Strength)",
  );

  // 2. Damping Ratio zeta
  add(
    "node_damping_add",
    "formula",
    280,
    340,
    {
      expression: "0.38 * a + 0.52 * b",
      a: 4.5,
      b: 1.2,
      unit: "%",
    },
    "დამატებითი დემპფირება (Poly/Fiber Damping)",
  );

  add(
    "node_damping",
    "formula",
    500,
    340,
    {
      expression: "clamp(1.1 + a - 0.8 * b, 0.8, 6.5)",
      a: 2.33,
      b: 0.22,
      unit: "%",
    },
    "დემპფირების კოეფიციენტი zeta (Damping Ratio)",
  );

  // 3. Wind Dynamic Excitation Force
  add(
    "node_wind_force",
    "formula",
    280,
    580,
    {
      expression: "clamp(0.042 * a * a, 20, 220)",
      a: 42.0,
      b: 0,
      unit: "kN",
    },
    "აეროდინამიკური ქარის ძალა (Wind Load)",
  );

  // 4. Dynamic Resonance Amplification Q = 50 / zeta
  add(
    "node_amplification",
    "formula",
    700,
    340,
    {
      expression: "clamp(50 / a, 5, 55)",
      a: 3.26,
      b: 0,
      unit: "",
    },
    "დინამიკური გაძლიერება Q (Dynamic Amplification)",
  );

  // 5. Peak Top Floor Acceleration
  add(
    "node_stiffness",
    "formula",
    700,
    100,
    {
      expression: "12 + 0.35 * sqrt(a)",
      a: 116.8,
      b: 0,
      unit: "factor",
    },
    "სტრუქტურული სიხისტე (Modal Stiffness)",
  );

  add(
    "node_accel_raw",
    "formula",
    700,
    580,
    {
      expression: "0.2 * a * b",
      a: 74.1,
      b: 15.3,
      unit: "force-Q",
    },
    "დინამიკური ძალვა (Dynamic Excitation)",
  );

  add(
    "node_top_accel",
    "formula",
    920,
    340,
    {
      expression: "clamp(a / b, 2, 60)",
      a: 226.7,
      b: 15.8,
      unit: "milli-g",
    },
    "მაქსიმალური აჩქარება a_peak (Top Acceleration)",
  );

  // 6. Embodied Carbon Footprint
  add(
    "node_carbon_clinker",
    "formula",
    280,
    460,
    {
      expression: "clamp(460 * (1 - 1.2 * a), 180, 500)",
      a: 0.15,
      b: 0,
      unit: "kg CO2/m³",
    },
    "კლინკერის ემისია (Clinker Carbon)",
  );

  add(
    "node_carbon_admix",
    "formula",
    500,
    460,
    {
      expression: "12 * a + 25 * b",
      a: 4.5,
      b: 1.2,
      unit: "kg CO2/m³",
    },
    "დანამატების ემისია (Admixture Carbon)",
  );

  add(
    "node_carbon",
    "formula",
    700,
    460,
    {
      expression: "clamp(a + b, 180, 580)",
      a: 377.2,
      b: 84.0,
      unit: "kg CO2/m³",
    },
    "ნახშირბადის ემისია (Embodied Carbon)",
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
  link("trigger_wind", "event", "scene_skyscraper", "trigger");
  link("wind_excitation", "effect", "scene_skyscraper", "events");
  link("accel_sensor_top", "sensor", "scene_skyscraper", "sensors");
  link("scene_skyscraper", sensorOutputId("accel_sensor_top"), "scope_accel", "ch1");

  // Wire Compressive Strength Chain
  link("node_wb", "result", "node_fc_base", "a");
  link("node_sf", "result", "node_fc_base", "b");
  link("node_polymer", "result", "node_fc_mod", "a");
  link("node_fiber", "result", "node_fc_mod", "b");
  link("node_fc_base", "result", "node_fc", "a");
  link("node_fc_mod", "result", "node_fc", "b");

  // Wire Damping Chain
  link("node_polymer", "result", "node_damping_add", "a");
  link("node_fiber", "result", "node_damping_add", "b");
  link("node_damping_add", "result", "node_damping", "a");
  link("node_wb", "result", "node_damping", "b");

  // Wire Dynamic Amplification: damping -> Q
  link("node_damping", "result", "node_amplification", "a");

  // Wire Wind Force
  link("node_wind_gust", "result", "node_wind_force", "a");

  // Wire Top Floor Acceleration
  link("node_fc", "result", "node_stiffness", "a");
  link("node_wind_force", "result", "node_accel_raw", "a");
  link("node_amplification", "result", "node_accel_raw", "b");
  link("node_accel_raw", "result", "node_top_accel", "a");
  link("node_stiffness", "result", "node_top_accel", "b");

  // Wire Embodied Carbon Chain
  link("node_sf", "result", "node_carbon_clinker", "a");
  link("node_polymer", "result", "node_carbon_admix", "a");
  link("node_fiber", "result", "node_carbon_admix", "b");
  link("node_carbon_clinker", "result", "node_carbon", "a");
  link("node_carbon_admix", "result", "node_carbon", "b");

  return p;
}

