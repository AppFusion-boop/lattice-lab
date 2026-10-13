import { L } from "./ka.ts";
import {
  getDefinition,
  defaultParams,
  nodeDefinition,
  sensorOutputId,
} from "./registry.ts";
import { compileExpression } from "./expression.ts";
import {
  signature,
  blankProject,
  type Project,
  type LabNode,
  type Wire,
  type Run,
  type Packet,
  type NodeResult,
  type DataType,
} from "./types.ts";
export function makeNode(
  kind: string,
  x = 0,
  y = 0,
  tools: Project["tools"] = [],
): LabNode {
  return {
    id: crypto.randomUUID(),
    kind,
    label: getDefinition(kind, tools)!.title,
    position: { x, y },
    params: defaultParams(kind, tools),
  };
}
export function outputTypes(
  p: Project,
  id: string,
  handle: string,
  seen = new Set<string>(),
): DataType[] {
  const node = p.nodes.find((n) => n.id === id),
    def = node && nodeDefinition(node, p);
  if (!node || !def) return [];
  if (
    (node.kind === "formula" || p.tools.some((t) => t.id === node.kind)) &&
    handle === "result"
  ) {
    if (seen.has(id)) return ["number", "signal"];
    seen.add(id);
    return p.edges
      .filter((e) => e.target === id)
      .some((e) =>
        outputTypes(p, e.source, e.sourceHandle, new Set(seen)).includes(
          "signal",
        ),
      )
      ? ["signal"]
      : ["number"];
  }
  return def.outputs.find((x) => x.id === handle)?.types || [];
}
export function connectionError(
  p: Project,
  w: Omit<Wire, "id">,
): string | null {
  const source = p.nodes.find((n) => n.id === w.source),
    target = p.nodes.find((n) => n.id === w.target);
  if (!source || !target) return "Missing node";
  if (source.id === target.id) return "A node cannot connect to itself";
  const src = nodeDefinition(source, p)!.outputs.find(
      (x) => x.id === w.sourceHandle,
    ),
    dest = nodeDefinition(target, p)!.inputs.find(
      (x) => x.id === w.targetHandle,
    );
  if (!src || !dest) return "Unknown port";
  const actual = outputTypes(p, source.id, w.sourceHandle);
  if (!actual.some((t) => dest.types.includes(t)))
    return (
      "Type mismatch: " + actual.join(" | ") + " → " + dest.types.join(" | ")
    );
  if (
    p.edges.some(
      (e) =>
        e.source === w.source &&
        e.sourceHandle === w.sourceHandle &&
        e.target === w.target &&
        e.targetHandle === w.targetHandle,
    )
  )
    return "This output is already connected";
  if (
    !dest.multiple &&
    p.edges.some(
      (e) => e.target === w.target && e.targetHandle === w.targetHandle,
    )
  )
    return "This input already has a connection";
  const seen = new Set<string>();
  const reaches = (id: string): boolean => {
    if (id === source.id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return p.edges
      .filter((e) => e.source === id)
      .some((e) => reaches(e.target));
  };
  return reaches(target.id)
    ? "Feedback cycles need a stateful solver and are not supported"
    : null;
}
export function inputPacket(
  p: Project,
  run: Run | null,
  node: string,
  port: string,
): Packet | undefined {
  const e = p.edges.find((e) => e.target === node && e.targetHandle === port);
  return e ? run?.results[e.source]?.outputs[e.sourceHandle] : undefined;
}
export function execute(p: Project): Run {
  const begin = performance.now(),
    results: Record<string, NodeResult> = Object.create(null),
    visiting = new Set<string>();
  const count = Math.round(p.duration * p.sampleRate) + 1;
  if (count > 10001 || count < 2)
    throw Error("Use between 2 and 10,001 samples per run");
  const times = Array.from({ length: count }, (_, i) => i / p.sampleRate);
  const evaluate = (id: string): NodeResult => {
    if (results[id]) return results[id];
    if (visiting.has(id)) throw Error("Cycle in graph");
    visiting.add(id);
    const node = p.nodes.find((n) => n.id === id)!;
    const d = nodeDefinition(node, p);
    const start = performance.now();
    let status: NodeResult["status"] = "ok",
      message = "Complete";
    const inputs: Record<string, Packet | undefined> = Object.create(null);
    const inputLists: Record<string, Packet[]> = Object.create(null);
    let outputs: Record<string, Packet> = {};
    try {
      if (!d) throw Error("Unknown node definition");
      for (const port of d.inputs) {
        const wires = p.edges.filter(
          (e) => e.target === id && e.targetHandle === port.id,
        );
        if (!wires.length && !port.optional) {
          status = "waiting";
          throw Error("Connect " + port.label);
        }
        if (wires.length > 1 && !port.multiple)
          throw Error(
            "Multiple connections are not supported on " + port.label,
          );
        inputLists[port.id] = [];
        for (const edge of wires) {
          const previous = evaluate(edge.source);
          if (previous.status !== "ok") {
            status = "waiting";
            throw Error(
              "Waiting for " + p.nodes.find((n) => n.id === edge.source)?.label,
            );
          }
          const packet = previous.outputs[edge.sourceHandle];
          if (!packet || !port.types.includes(packet.type))
            throw Error(
              "Input " + port.label + " expects " + port.types.join(" | "),
            );
          inputLists[port.id].push(packet);
        }
        inputs[port.id] = inputLists[port.id][0];
      }
      outputs = d.evaluate({
        duration: p.duration,
        sampleRate: p.sampleRate,
        times,
        params: node.params,
        inputs,
        inputLists,
        node,
      });
      for (const [key, value] of Object.entries(outputs)) {
        const port = d.outputs.find((x) => x.id === key);
        if (!port?.types.includes(value.type))
          throw Error("Node returned an incompatible output");
        if (value.type === "number" && !Number.isFinite(value.value))
          throw Error("Non-finite output");
        if (
          value.type === "signal" &&
          (value.value.values.length !== value.value.times.length ||
            value.value.values.some((x) => !Number.isFinite(x)))
        )
          throw Error("Invalid signal output");
      }
    } catch (err) {
      if (status === "ok") status = "error";
      message = err instanceof Error ? err.message : String(err);
      outputs = {};
    }
    visiting.delete(id);
    return (results[id] = {
      outputs,
      status,
      message,
      ms: performance.now() - start,
    });
  };
  p.nodes.forEach((n) => evaluate(n.id));
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    durationMs: performance.now() - begin,
    results,
    signature: signature(p),
  };
}
export function exampleProject(template = "sensor"): Project {
  const p = blankProject();
  const add = (
    id: string,
    kind: string,
    x: number,
    y: number,
    params: Record<string, unknown> = {},
  ) => {
    const n = makeNode(kind, x, y);
    n.id = id;
    n.params = { ...n.params, ...params };
    p.nodes.push(n);
    return n;
  };
  const link = (a: string, ah: string, b: string, bh: string) =>
    p.edges.push({
      id: a + "-" + ah + "-" + b + "-" + bh,
      source: a,
      sourceHandle: ah,
      target: b,
      targetHandle: bh,
    });
  if (template === "sensor") {
    p.name = "Acoustic sensor · signal chain";
    add("start", "manual", 0, 0);
    add("scene", "scene3d", 325, 90);
    add("sensor", "pressure", 0, 190);
    add("formula", "formula", 655, 110, { expression: "a * 0.01", unit: "V" });
    add("scope", "scope", 990, 110);
    add("threshold", "threshold", 650, 395, { level: 0.2 });
    add("monitor", "eventlog", 990, 420);
    link("start", "event", "scene", "trigger");
    link("sensor", "sensor", "scene", "sensors");
    link("scene", sensorOutputId("sensor"), "formula", "a");
    link("formula", "result", "scope", "ch1");
    link("formula", "result", "threshold", "signal");
    link("threshold", "event", "monitor", "event");
  } else if (template === "scene-events") {
    p.name = "Scene events · controlled comparison";
    add("pulse", "wavePulse", 0, -160, { x: 5, y: 1, z: 6, radius: 25 });
    add("zone", "dampingZone", 0, 130, {
      x: 12,
      y: 1,
      z: 6,
      start: 0,
      duration: 2,
      radius: 8,
      falloff: "Uniform",
      reduction: 60,
    });
    add("sensor", "pressure", 0, 420, { x: 12, y: 1, z: 6 });
    const a = add("scene", "scene2d", 350, -100, { objects: [] });
    a.label = "A · Reference";
    const b = add("treated", "scene2d", 350, 400, { objects: [] });
    b.label = "B · Damping zone";
    add("scope", "scope", 730, 170);
    link("pulse", "effect", "scene", "events");
    link("pulse", "effect", "treated", "events");
    link("zone", "effect", "treated", "events");
    link("sensor", "sensor", "scene", "sensors");
    link("sensor", "sensor", "treated", "sensors");
    link("scene", sensorOutputId("sensor"), "scope", "ch1");
    link("treated", sensorOutputId("sensor"), "scope", "ch2");
  } else if (template === "data") {
    p.name = "CSV · formula · analysis";
    add("csv", "csv", 0, 120);
    add("column", "column", 310, 120);
    add("formula", "formula", 620, 120, { expression: "a * 2", unit: "V" });
    add("scope", "scope", 940, 100);
    add("statistics", "statistics", 930, 390);
    add("display", "inspect", 1240, 390);
    link("csv", "table", "column", "table");
    link("column", "signal", "formula", "a");
    link("formula", "result", "scope", "ch1");
    link("formula", "result", "statistics", "signal");
    link("statistics", "rms", "display", "value");
  } else if (template === "events") {
    p.name = "Events · gated waveform";
    add("clock", "interval", 0, 0, { interval: 0.5, start: 0.5 });
    add("gen", "generator", 0, 250);
    add("gate", "gate", 350, 150);
    add("scope", "scope", 710, 150);
    add("log", "eventlog", 350, -50);
    link("clock", "event", "gate", "event");
    link("clock", "event", "log", "event");
    link("gen", "signal", "gate", "signal");
    link("gate", "signal", "scope", "ch1");
    link("gen", "signal", "scope", "ch2");
  }
  p.name = L(p.name);
  p.nodes = p.nodes.map((n) => ({ ...n, label: L(n.label) }));
  return p;
}
const reserved = new Set(["__proto__", "constructor", "prototype"]);
export function parseProject(raw: string): Project {
  if (raw.length > 5e6) throw Error("Project limit is 5 MB");
  let p = JSON.parse(raw);
  if (p?.version === 2 && Array.isArray(p.nodes) && Array.isArray(p.edges))
    p = migrateV2(p);
  if (
    !p ||
    p.version !== 3 ||
    typeof p.name !== "string" ||
    p.name.length > 100 ||
    !Array.isArray(p.nodes) ||
    p.nodes.length > 100 ||
    !Array.isArray(p.edges) ||
    p.edges.length > 300 ||
    !Array.isArray(p.tools) ||
    p.tools.length > 30 ||
    !Number.isFinite(p.duration) ||
    p.duration < 0.1 ||
    p.duration > 60 ||
    !Number.isFinite(p.sampleRate) ||
    p.sampleRate < 10 ||
    p.sampleRate > 2000 ||
    p.duration * p.sampleRate > 10000
  )
    throw Error("Invalid workflow settings");
  const customIds = new Set();
  for (const t of p.tools) {
    if (
      !t ||
      typeof t.id !== "string" ||
      !t.id.startsWith("custom-") ||
      customIds.has(t.id) ||
      typeof t.label !== "string" ||
      t.label.length > 80 ||
      typeof t.unit !== "string" ||
      t.unit.length > 40
    )
      throw Error("Invalid custom tool");
    compileExpression(t.expression);
    customIds.add(t.id);
  }
  const ids = new Set();
  for (const node of p.nodes) {
    if (
      !node ||
      typeof node.id !== "string" ||
      reserved.has(node.id) ||
      node.id.length > 100 ||
      ids.has(node.id) ||
      typeof node.label !== "string" ||
      node.label.length > 100 ||
      !node.position ||
      ![node.position.x, node.position.y].every(
        (x) => Number.isFinite(x) && Math.abs(x) < 100000,
      )
    )
      throw Error("Invalid node");
    ids.add(node.id);
    const def = nodeDefinition(node, p);
    if (!def || !node.params || typeof node.params !== "object")
      throw Error("Unknown node type");
    if (def.category === "Scenes" && node.params.environment === undefined)
      node.params.environment = "Open space";
    for (const f of def.fields) {
      const v = node.params[f.key];
      if (f.kind === "number") {
        if (
          typeof v !== "number" ||
          !Number.isFinite(v) ||
          v < (f.min ?? -Infinity) ||
          v > (f.max ?? Infinity)
        )
          throw Error("Invalid " + f.label + " in " + node.label);
      } else if (
        typeof v !== "string" ||
        v.length >
          (f.kind === "csv" ? 500000 : f.kind === "expression" ? 500 : 1000) ||
        (f.options && !f.options.includes(v))
      )
        throw Error("Invalid " + f.label);
    }
    if (node.kind.startsWith("scene")) {
      if (
        !Array.isArray(node.params.objects) ||
        node.params.objects.length > 40
      )
        throw Error("Invalid scene objects");
      const objectIds = new Set();
      for (const o of node.params.objects) {
        if (
          !o ||
          typeof o.id !== "string" ||
          objectIds.has(o.id) ||
          typeof o.name !== "string" ||
          o.name.length > 100 ||
          !["box", "sphere", "source", "mesh"].includes(o.shape) ||
          typeof o.color !== "string" ||
          !/^#[a-f\d]{6}$/i.test(o.color) ||
          !Number.isFinite(o.rotation) ||
          Math.abs(o.rotation) > 360 ||
          !o.position ||
          !o.size ||
          !Object.values(o.position).every(
            (v) =>
              typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 100,
          ) ||
          !["x", "y", "z"].every(
            (k) =>
              typeof o.position[k] === "number" &&
              typeof o.size[k] === "number" &&
              o.size[k] >= 0.01 &&
              o.size[k] <= 100,
          )
        )
          throw Error("Invalid scene object");
        objectIds.add(o.id);
        if (
          o.shape === "mesh" &&
          (!Array.isArray(o.vertices) ||
            !o.vertices.length ||
            o.vertices.length > 90000 ||
            o.vertices.length % 9 ||
            o.vertices.some(
              (x: number) => !Number.isFinite(x) || Math.abs(x) > 1e5,
            ))
        )
          throw Error("Invalid mesh");
      }
    }
  }
  const checked = { ...p, edges: [] } as Project;
  const edgeIds = new Set();
  for (const edge of p.edges) {
    if (!edge || typeof edge.id !== "string" || edgeIds.has(edge.id))
      throw Error("Invalid wire");
    const err = connectionError(
      { ...p, edges: p.edges.filter((candidate: Wire) => candidate !== edge) },
      edge,
    );
    if (err) throw Error(err);
    checked.edges.push(edge);
    edgeIds.add(edge.id);
  }
  return {
    ...checked,
    name: L(checked.name),
    nodes: checked.nodes.map((n) => ({ ...n, label: L(n.label) })),
  };
}

function migrateV2(old: Project & { version: unknown }): Project {
  const isSensor = (id: string) => {
    const n = old.nodes.find((n) => n?.id === id);
    return n && getDefinition(n.kind, old.tools || [])?.category === "Sensors";
  };
  const bindings = new Map<string, string>();
  for (const e of old.edges) {
    if (e?.targetHandle === "scene" && isSensor(e.target))
      bindings.set(e.target, e.source);
  }
  const edges: Wire[] = [];
  for (const e of old.edges) {
    if (!e) continue;
    if (e.targetHandle === "scene" && isSensor(e.target)) {
      edges.push({
        ...e,
        source: e.target,
        sourceHandle: "sensor",
        target: e.source,
        targetHandle: "sensors",
      });
      continue;
    }
    if (e.sourceHandle === "signal" && isSensor(e.source)) {
      const scene = bindings.get(e.source);
      if (scene)
        edges.push({
          ...e,
          source: scene,
          sourceHandle: sensorOutputId(e.source),
        });
      continue;
    }
    edges.push(e);
  }
  return { ...old, version: 3, edges };
}
