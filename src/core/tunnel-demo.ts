import { blankProject, type Project } from "./types.ts";
import { makeNode } from "./runtime.ts";
import { sensorOutputId } from "./registry.ts";
export type DemoSettings = {
  ignition: number;
  waterStart: number;
  waterFlow: number;
  reduction: number;
  distance: number;
  droplet: number;
  nozzles: number;
  speed: number;
};
export const demoDefaults: DemoSettings = {
  ignition: 1.5,
  waterStart: 1.25,
  waterFlow: 18,
  reduction: 45,
  distance: 12,
  droplet: 80,
  nozzles: 8,
  speed: 0.25,
};
export function tunnelProject(settings: DemoSettings = demoDefaults): Project {
  const p = blankProject();
  p.name = "გვირაბი · მეთანი და წყლის ნისლი";
  p.duration = 5;
  p.sampleRate = 1000;
  const add = (
    id: string,
    kind: string,
    x: number,
    y: number,
    params: Record<string, unknown>,
    label?: string,
  ) => {
    const n = makeNode(kind, x, y);
    n.id = id;
    n.params = { ...n.params, ...params };
    if (label) n.label = label;
    p.nodes.push(n);
    return n;
  };
  add("methane", "methaneExplosion", 0, 0, {
    x: 16,
    y: 1.5,
    z: 3,
    start: settings.ignition,
    duration: 0.7,
    radius: 80,
    falloff: "Linear",
    amplitude: 18000,
  });
  add("water", "waterMist", 0, 300, {
    x: 27,
    y: 4.5,
    z: 3,
    start: settings.waterStart,
    duration: 3.5,
    radius: 13,
    falloff: "Uniform",
    flow: settings.waterFlow,
    droplet: settings.droplet,
    nozzles: settings.nozzles,
    reduction: settings.reduction,
    rise: 0.25,
  });
  add(
    "probe",
    "pressure",
    0,
    690,
    { x: 16 + settings.distance, y: 1.5, z: 3, tau: 0.004 },
    "წნევის სენსორი",
  );
  for (const [id, x, y, label] of [
    ["reference", 380, 0, "ა · წყლის გარეშე"],
    ["mist", 380, 600, "ბ · წყლის ნისლით"],
  ] as const)
    add(
      id,
      "scene3d",
      x,
      y,
      { width: 40, depth: 6, height: 5, objects: [], environment: "Tunnel" },
      label,
    );
  add("scope", "scope", 800, 300, {}, "წნევის შედარება");
  const link = (
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
  ) =>
    p.edges.push({
      id: source + "-" + sourceHandle + "-" + target + "-" + targetHandle,
      source,
      sourceHandle,
      target,
      targetHandle,
    });
  for (const id of ["reference", "mist"]) {
    link("methane", "effect", id, "events");
    link("probe", "sensor", id, "sensors");
  }
  link("water", "effect", "mist", "events");
  link("reference", sensorOutputId("probe"), "scope", "ch1");
  link("mist", sensorOutputId("probe"), "scope", "ch2");
  return p;
}
export function visibleSampleIndex(times: number[], time: number) {
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
