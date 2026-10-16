import test from "node:test";
import assert from "node:assert/strict";
import { compileExpression } from "./expression.ts";
import {
  definitions,
  parseCSV,
  defaultParams,
  getDefinition,
} from "./registry.ts";
import {
  execute,
  exampleProject,
  parseProject,
  connectionError,
  makeNode,
  outputTypes,
} from "./runtime.ts";
import { blankProject, type Packet, type Signal } from "./types.ts";
import { autoLayoutNodes, autoLayoutProject } from "./auto-layout.ts";
test("formula parser obeys precedence, exponent associativity, comparisons and lazy branches", () => {
  assert.equal(compileExpression("-2^2 + 2^3^2")({}), 508);
  assert.equal(
    compileExpression("if(a > 0 && b < 3, sqrt(a), 1 / 0)")({ a: 9, b: 2 }),
    3,
  );
  assert.ok(Math.abs(compileExpression("sin(pi/2) + log(e)")({}) - 2) < 1e-12);
  assert.equal(compileExpression("clamp(a, 0, 1)")({ a: 3 }), 1);
});
test("formula parser rejects code, unknown names, invalid arity, domains and excess nesting", () => {
  for (const expr of [
    "globalThis",
    "a.constructor",
    "foo(a)",
    "sin(1,2)",
    "a = 3",
    "(()=>1)()",
    "(".repeat(40) + "1" + ")".repeat(40),
  ])
    assert.throws(() => compileExpression(expr));
  assert.throws(() => compileExpression("1 / 0")({}), /non-finite/);
  assert.throws(() => compileExpression("sqrt(-1)")({}), /non-finite/);
});
test("all starter graphs execute with valid typed results independent of node order", () => {
  for (const template of ["sensor", "data", "events", "scene-events"]) {
    const p = exampleProject(template);
    p.nodes.reverse();
    const r = execute(p);
    assert.ok(
      Object.values(r.results).every((n) => n.status === "ok"),
      JSON.stringify(r.results),
    );
    assert.deepEqual(parseProject(JSON.stringify(p)), p);
  }
});
test("sensor position changes arrival and formula preserves time and maps values", () => {
  const p = exampleProject(),
    r = execute(p);
  const pressure = r.results.scene.outputs["sensor:sensor"];
  const formula = r.results.formula.outputs.result;
  assert.equal(pressure.type, "signal");
  assert.equal(formula.type, "signal");
  if (pressure.type !== "signal" || formula.type !== "signal") return;
  assert.deepEqual(pressure.value.times, formula.value.times);
  assert.equal(formula.value.unit, "V");
  assert.equal(formula.value.values[15], pressure.value.values[15] * 0.01);
  p.nodes.find((n) => n.id === "sensor")!.params.x = 4;
  const changed = execute(p).results.scene.outputs["sensor:sensor"] as {
    type: "signal";
    value: Signal;
  };
  assert.notDeepEqual(changed.value.values, pressure.value.values);
  assert.ok(
    changed.value.values.findIndex((x) => x > 0.1) <
      pressure.value.values.findIndex((x) => x > 0.1),
  );
});
test("missing dynamic output reports an error; optional empty event inputs keep generator silent", () => {
  const p = exampleProject();
  p.edges = p.edges.filter((e) => e.source !== "sensor");
  const r = execute(p);
  assert.equal(r.results.sensor.status, "ok");
  assert.equal(r.results.formula.status, "error");
  const q = exampleProject("events");
  q.nodes.find((n) => n.id === "clock")!.params.start = 3;
  q.edges.push({
    id: "start-generator",
    source: "clock",
    sourceHandle: "event",
    target: "gen",
    targetHandle: "trigger",
  });
  const g = execute(q).results.gen.outputs.signal;
  assert.equal(g.type, "signal");
  if (g.type === "signal") assert.ok(g.value.values.every((x) => x === 0));
});
test("connections reject incompatible structural types, occupied ports and cycles", () => {
  const p = exampleProject();
  assert.match(
    connectionError(p, {
      source: "start",
      sourceHandle: "event",
      target: "scope",
      targetHandle: "ch2",
    })!,
    /Type mismatch/,
  );
  assert.match(connectionError(p, p.edges[0])!, /already/);
  assert.match(
    connectionError(p, {
      source: "threshold",
      sourceHandle: "event",
      target: "scene",
      targetHandle: "trigger",
    })!,
    /already/,
  );
  p.edges = p.edges.filter((e) => e.targetHandle !== "trigger");
  assert.match(
    connectionError(p, {
      source: "threshold",
      sourceHandle: "event",
      target: "sensor",
      targetHandle: "trigger",
    })!,
    /Feedback/,
  );
});
test("dynamic formula type follows input; runtime prevents scalar from entering a scope", () => {
  const p = exampleProject();
  p.edges = p.edges.filter((e) => e.target !== "formula");
  assert.deepEqual(outputTypes(p, "formula", "result"), ["number"]);
  const r = execute(p);
  assert.equal(r.results.formula.status, "ok");
  assert.equal(r.results.scope.status, "error");
  assert.match(r.results.scope.message, /expects signal/);
});
test("CSV parser handles quotes and CRLF and rejects malformed columns", () => {
  const t = parseCSV('time,"value, V"\r\n0,2\r\n1,3');
  assert.deepEqual(t.columns, ["time", "value, V"]);
  assert.deepEqual(t.rows, [
    [0, 2],
    [1, 3],
  ]);
  assert.throws(() => parseCSV("x,x\n1,2"), /unique/);
  assert.throws(() => parseCSV("x,y\n1"), /length/);
  assert.throws(() => parseCSV('x\n"oops'), /quote/);
});
test("mismatched time grids require explicit resampling", () => {
  const p = exampleProject("data");
  const gen = makeNode("generator");
  p.nodes.push(gen);
  p.edges.push({
    id: "b",
    source: gen.id,
    sourceHandle: "signal",
    target: "formula",
    targetHandle: "b",
  });
  assert.match(execute(p).results.formula.message, /Time grids differ/);
});
test("threshold detects and interpolates crossings, event gate zeroes earlier samples", () => {
  const p = exampleProject("events"),
    r = execute(p),
    gate = r.results.gate.outputs.signal;
  if (gate.type !== "signal") assert.fail();
  assert.ok(
    gate.value.values
      .filter((_, i) => gate.value.times[i] < 0.5)
      .every((v) => v === 0),
  );
  assert.ok(gate.value.values.some((v) => v !== 0));
  const s = exampleProject(),
    events = execute(s).results.threshold.outputs.event;
  assert.equal(events.type, "event");
  if (events.type === "event") {
    assert.equal(events.value.length, 1);
    assert.ok(events.value[0] > 0.05 && events.value[0] < 0.1);
  }
});
test("project importer enforces limits, identifiers and mesh safety", () => {
  const p = exampleProject();
  p.nodes[0].id = "__proto__";
  assert.throws(() => parseProject(JSON.stringify(p)));
  const q = exampleProject();
  q.duration = 60;
  q.sampleRate = 2000;
  assert.throws(() => parseProject(JSON.stringify(q)));
  const z = exampleProject();
  z.edges[0].source = "missing";
  assert.throws(() => parseProject(JSON.stringify(z)), /Missing/);
});
test("custom formula is restored as a registry-backed reusable node", () => {
  const p = blankProject();
  p.tools = [
    { id: "custom-double", label: "Double", expression: "a * 2", unit: "V" },
  ];
  const n = makeNode("custom-double", 0, 0, p.tools);
  n.params.a = 3;
  p.nodes.push(n);
  const restored = parseProject(JSON.stringify(p));
  const packet = execute(restored).results[n.id].outputs.result;
  assert.deepEqual(packet, { type: "number", value: 6, unit: "V" });
});
test("each registered node has a complete schema with unique ports and fields", () => {
  for (const d of definitions) {
    assert.equal(new Set(d.inputs.map((p) => p.id)).size, d.inputs.length);
    assert.equal(new Set(d.outputs.map((p) => p.id)).size, d.outputs.length);
    assert.equal(new Set(d.fields.map((p) => p.key)).size, d.fields.length);
    assert.equal(typeof d.evaluate, "function");
    assert.ok(d.help);
    assert.ok(defaultParams(d.id));
  }
});
test("all ideal sensor models produce finite values and correct units", () => {
  for (const [kind, unit] of [
    ["pressure", "Pa"],
    ["temperature", "°C"],
    ["accelerometer", "m/s²"],
    ["microphone", "Pa"],
    ["light", "lx"],
  ]) {
    const p = exampleProject();
    const node = p.nodes.find((n) => n.id === "sensor")!;
    node.kind = kind;
    node.params = defaultParams(kind);
    const r = execute(p).results.scene;
    assert.equal(r.status, "ok");
    const v = r.outputs["sensor:sensor"];
    if (v.type !== "signal") assert.fail();
    assert.equal(v.value.unit, unit);
    assert.ok(v.value.values.every(Number.isFinite));
  }
});

import { parseOBJMesh } from "./mesh.ts";
test("OBJ imports are centered, normalized, finite and persist in project JSON", () => {
  const vertices = parseOBJMesh("v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3");
  assert.equal(vertices.length, 9);
  assert.equal(Math.max(...vertices), 0.5);
  assert.equal(Math.min(...vertices), -0.5);
  assert.throws(() => parseOBJMesh("nothing here"));
  const p = exampleProject();
  (p.nodes.find((n) => n.id === "scene")!.params.objects as any[]).push({
    id: "mesh",
    name: "Imported",
    shape: "mesh",
    position: { x: 5, y: 1, z: 4 },
    size: { x: 2, y: 2, z: 2 },
    rotation: 0,
    color: "#abcdef",
    vertices,
  });
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
});
test("valid imported connections are independent of serialization order", () => {
  const p = exampleProject();
  p.edges.reverse();
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
});
test("syntax errors remain editable in saved drafts and isolate downstream execution", () => {
  const p = exampleProject();
  p.nodes.find((n) => n.id === "formula")!.params.expression = "a +";
  const draft = parseProject(JSON.stringify(p)),
    run = execute(draft);
  assert.equal(run.results.formula.status, "error");
  assert.equal(run.results.scope.status, "waiting");
  assert.equal(run.results.sensor.status, "ok");
});

import { applyNodeChanges } from "@xyflow/react";
import {
  reconcileCanvasNodes,
  retainExecutionProject,
} from "./canvas-state.ts";
test("dragging preserves measured dimensions and the identities of untouched nodes", () => {
  const project = exampleProject();
  const initial = reconcileCanvasNodes([], project.nodes, "formula");
  const measured = applyNodeChanges(
    initial.map((n) => ({
      id: n.id,
      type: "dimensions" as const,
      dimensions: { width: 242, height: 200 },
    })),
    initial,
  );
  const moved = applyNodeChanges(
    [
      {
        id: "formula",
        type: "position",
        position: { x: 700, y: 160 },
        dragging: true,
      },
    ],
    measured,
  );
  const nextProject = {
    ...project,
    nodes: project.nodes.map((n) =>
      n.id === "formula" ? { ...n, position: { x: 700, y: 160 } } : n,
    ),
  };
  const next = reconcileCanvasNodes(moved, nextProject.nodes, "formula");
  assert.strictEqual(next, moved);
  for (let i = 0; i < next.length; i++) {
    assert.deepEqual(next[i].measured, { width: 242, height: 200 });
    if (next[i].id !== "formula") assert.strictEqual(next[i], measured[i]);
  }
  assert.strictEqual(
    next.find((n) => n.id === "formula")!.data,
    measured.find((n) => n.id === "formula")!.data,
  );
  const restored = reconcileCanvasNodes(next, project.nodes, "formula");
  assert.deepEqual(restored.find((n) => n.id === "formula")!.position, {
    x: 655,
    y: 110,
  });
  assert.ok(
    restored.every(
      (n) => n.measured?.width === 242 && n.measured?.height === 200,
    ),
  );
});
test("layout-only changes retain the execution context while parameter edits invalidate it", () => {
  const project = exampleProject();
  const moved = {
    ...project,
    nodes: project.nodes.map((n) => ({
      ...n,
      position: { x: n.position.x + 100, y: n.position.y + 100 },
    })),
  };
  assert.strictEqual(retainExecutionProject(project, moved), project);
  const changed = {
    ...moved,
    nodes: moved.nodes.map((n) =>
      n.id === "sensor" ? { ...n, params: { ...n.params, x: 5 } } : n,
    ),
  };
  assert.strictEqual(retainExecutionProject(project, changed), changed);
});

import {
  nodeDefinition,
  sensorOutputId,
  pruneSceneConnections,
} from "./registry.ts";
import {
  sceneEvents,
  applySceneEvents,
  eventConfig,
  eventEnd,
} from "./scene-events.ts";
import type { Project, LabNode, SceneEventConfig } from "./types.ts";
function attach(p: Project, node: LabNode, port = "events") {
  p.nodes.push(node);
  p.edges.push({
    id: crypto.randomUUID(),
    source: node.id,
    sourceHandle: port === "events" ? "effect" : "sensor",
    target: "scene",
    targetHandle: port,
  });
}
function sceneSignal(p: Project, id = "sensor") {
  const out = execute(p).results.scene;
  assert.equal(out.status, "ok", out.message);
  const signal = out.outputs[sensorOutputId(id)];
  assert.equal(signal.type, "signal");
  return (signal as { type: "signal"; value: Signal }).value;
}
test("multiple sensors create stable, typed scene outputs; detach removes only invalid wires", () => {
  const p = exampleProject(),
    temp = makeNode("temperature");
  attach(p, temp, "sensors");
  const def = nodeDefinition(
    p.nodes.find((n) => n.id === "scene")!,
    p,
  )!;
  assert.deepEqual(
    def.outputs.map((p) => p.id),
    ["scene", "sensor:sensor", sensorOutputId(temp.id)],
  );
  assert.equal(sceneSignal(p, temp.id).unit, "°C");
  assert.equal(sceneSignal(p).unit, "Pa");
  assert.equal(
    connectionError(p, {
      source: "scene",
      sourceHandle: sensorOutputId(temp.id),
      target: "scope",
      targetHandle: "ch2",
    }),
    null,
  );
  const cleaned = pruneSceneConnections({
    ...p,
    edges: p.edges.filter((e) => e.source !== "sensor"),
  });
  assert.ok(!cleaned.edges.some((e) => e.sourceHandle === "sensor:sensor"));
  assert.ok(
    nodeDefinition(
      cleaned.nodes.find((n) => n.id === "scene")!,
      cleaned,
    )!.outputs.some((o) => o.id === sensorOutputId(temp.id)),
  );
  assert.equal(cleaned.nodes.length, p.nodes.length);
});
test("v2 migration reverses sensor attachment and reroutes signal consumers without changing values", () => {
  const p = exampleProject();
  const legacy = { ...structuredClone(p), version: 2 };
  legacy.edges = legacy.edges.map((e) =>
    e.targetHandle === "sensors"
      ? {
          ...e,
          source: e.target,
          sourceHandle: "scene",
          target: e.source,
          targetHandle: "scene",
        }
      : e.sourceHandle === "sensor:sensor"
        ? { ...e, source: "sensor", sourceHandle: "signal" }
        : e,
  );
  const restored = parseProject(JSON.stringify(legacy));
  assert.equal(restored.version, 3);
  assert.deepEqual(sceneSignal(restored), sceneSignal(p));
});
test("physical event registry generates node schemas and compatible scene inputs automatically", () => {
  for (const d of sceneEvents) {
    const p = exampleProject(),
      event = makeNode(d.id);
    attach(p, event);
    assert.ok(
      getDefinition(d.id)!.outputs.some((o) => o.types.includes("sceneEvent")),
    );
    assert.equal(execute(p).results[event.id].status, "ok");
    assert.deepEqual(parseProject(JSON.stringify(p)), p);
  }
  const p = exampleProject(),
    e = makeNode("wavePulse");
  p.nodes.push(e);
  assert.match(
    connectionError(p, {
      source: e.id,
      sourceHandle: "effect",
      target: "scene",
      targetHandle: "trigger",
    })!,
    /Type mismatch/,
  );
});
test("wave pulse arrival depends on distance and time; doubling amplitude doubles the measured field", () => {
  const p = exampleProject(),
    wave = makeNode("wavePulse");
  Object.assign(wave.params, {
    x: 5,
    y: 1,
    z: 6,
    start: 0.4,
    radius: 30,
    falloff: "Uniform",
    width: 0.04,
  });
  attach(p, wave);
  const sensor = p.nodes.find((n) => n.id === "sensor")!;
  Object.assign(sensor.params, { x: 5, y: 1, z: 6, tau: 0 });
  const a = sceneSignal(p);
  assert.ok(a.values.filter((_, i) => a.times[i] < 0.4).every((v) => v === 0));
  wave.params.amplitude = 2000;
  const b = sceneSignal(p);
  assert.ok(a.values.every((v, i) => Math.abs(b.values[i] - v * 2) < 1e-9));
  sensor.params.x = 18;
  const c = sceneSignal(p);
  assert.ok(
    c.values.findIndex((v) => v > 100) > b.values.findIndex((v) => v > 100),
  );
  wave.params.radius = 2;
  assert.ok(sceneSignal(p).values.every((v) => v === 0));
});
test("damping combines after additive fields, independent of connection order", () => {
  const p = exampleProject(),
    wave = makeNode("wavePulse"),
    zone = makeNode("dampingZone");
  Object.assign(wave.params, {
    x: 8,
    y: 1,
    z: 6,
    start: 0.3,
    radius: 30,
    falloff: "Uniform",
  });
  attach(p, wave);
  const sensor = p.nodes.find((n) => n.id === "sensor")!;
  Object.assign(sensor.params, { x: 8, y: 1, z: 6, tau: 0 });
  const baseline = sceneSignal(p);
  Object.assign(zone.params, {
    x: 8,
    y: 1,
    z: 6,
    start: 0,
    duration: 2,
    radius: 30,
    falloff: "Uniform",
    reduction: 75,
    rise: 0.01,
  });
  attach(p, zone);
  const attenuated = sceneSignal(p);
  assert.ok(
    baseline.values.every(
      (v, i) => Math.abs(attenuated.values[i] - v * 0.25) < 1e-9,
    ),
  );
  p.edges.reverse();
  assert.deepEqual(sceneSignal(p), attenuated);
});
test("thermal, light and vibration effects target matching sensors and respect enable state", () => {
  for (const [kind, sensorKind, baseline] of [
    ["temperatureChange", "temperature", 22],
    ["lightPulse", "light", 500],
    ["vibration", "accelerometer", 0],
  ] as const) {
    const p = exampleProject(),
      sensor = p.nodes.find((n) => n.id === "sensor")!,
      e = makeNode(kind);
    sensor.kind = sensorKind;
    sensor.params = { ...defaultParams(sensorKind), x: 5, y: 1, z: 6, tau: 0 };
    Object.assign(e.params, { x: 5, y: 1, z: 6 });
    attach(p, e);
    const signal = sceneSignal(p);
    assert.ok(signal.values.some((v) => Math.abs(v - baseline) > 1));
    assert.ok(
      signal.values
        .filter((_, i) => signal.times[i] < 0.2)
        .every((v) => v === baseline),
    );
    e.params.enabled = "Off";
    assert.ok(sceneSignal(p).values.every((v) => v === baseline));
  }
});
test("event trigger offsets support repeated schedules, empty triggers, cycle rejection and sample limits", () => {
  const p = exampleProject(),
    event = makeNode("lightPulse"),
    clock = makeNode("interval");
  clock.params = { interval: 0.5, start: 0 };
  p.nodes.push(clock);
  attach(p, event);
  p.edges.push({
    id: "clock-event",
    source: clock.id,
    sourceHandle: "event",
    target: event.id,
    targetHandle: "trigger",
  });
  let out = execute(p).results[event.id].outputs.effect as {
    type: "sceneEvent";
    value: SceneEventConfig;
  };
  assert.deepEqual(out.value.starts, [0.2, 0.7, 1.2, 1.7, 2.2]);
  clock.params.start = 3;
  out = execute(p).results[event.id].outputs.effect as typeof out;
  assert.deepEqual(out.value.starts, []);
  assert.match(
    connectionError(
      { ...p, edges: p.edges.filter((e) => e.id !== "clock-event") },
      {
        source: "threshold",
        sourceHandle: "event",
        target: event.id,
        targetHandle: "trigger",
      },
    )!,
    /Feedback/,
  );
  clock.params = { interval: 0.001, start: 0 };
  assert.match(execute(p).results[event.id].message, /256/);
  const q = exampleProject(),
    v = makeNode("vibration");
  v.params.frequency = 100;
  attach(q, v);
  assert.match(execute(q).results[v.id].message, /sample rate/);
});

import {
  tunnelProject,
  demoDefaults,
  visibleSampleIndex,
} from "./tunnel-demo.ts";
test("tunnel demo is a portable ordinary graph with two scenes and shared event/sensor nodes", () => {
  const p = tunnelProject();
  const restored = parseProject(JSON.stringify(p));
  assert.deepEqual(restored, p);
  const run = execute(restored);
  assert.ok(Object.values(run.results).every((r) => r.status === "ok"));
  assert.equal(p.nodes.filter((n) => n.kind === "scene3d").length, 2);
  assert.equal(p.edges.filter((e) => e.source === "methane").length, 2);
  assert.equal(p.edges.filter((e) => e.source === "probe").length, 2);
});
test("methane produces no pressure before ignition and water never acts before its scheduled start", () => {
  const p = tunnelProject({ ...demoDefaults, waterStart: 2.5 }),
    run = execute(p);
  const a = run.results.reference.outputs["sensor:probe"] as {
      type: "signal";
      value: Signal;
    },
    b = run.results.mist.outputs["sensor:probe"] as typeof a;
  assert.ok(
    a.value.values
      .filter((_, i) => a.value.times[i] < demoDefaults.ignition)
      .every((v) => v === 0),
  );
  assert.deepEqual(a.value.values, b.value.values);
  const early = execute(tunnelProject()).results.mist.outputs[
    "sensor:probe"
  ] as typeof a;
  assert.ok(
    Math.max(...early.value.values) < Math.max(...a.value.values) * 0.6,
  );
});
test("water can be disabled without changing the reference and respects temperature channel semantics", () => {
  const p = tunnelProject();
  p.nodes.find((n) => n.id === "water")!.params.enabled = "Off";
  const r = execute(p);
  assert.deepEqual(
    (r.results.reference.outputs["sensor:probe"] as any).value,
    (r.results.mist.outputs["sensor:probe"] as any).value,
  );
  const w = makeNode("waterMist");
  Object.assign(w.params, {
    x: 1,
    y: 1,
    z: 1,
    start: 0.5,
    radius: 5,
    falloff: "Uniform",
    rise: 0.1,
    cooling: 4,
  });
  const config = eventConfig(w);
  assert.equal(
    applySceneEvents(22, [config], "temperature", { x: 1, y: 1, z: 1 }, 0.4, 3),
    22,
  );
  assert.equal(
    applySceneEvents(22, [config], "temperature", { x: 1, y: 1, z: 1 }, 0.8, 3),
    18,
  );
});
test("playback cursor never reveals a future sample and handles exact boundaries", () => {
  const times = [0, 0.1, 0.2, 0.3];
  assert.equal(visibleSampleIndex(times, -0.01), -1);
  assert.equal(visibleSampleIndex(times, 0), 0);
  assert.equal(visibleSampleIndex(times, 0.1999), 1);
  assert.equal(visibleSampleIndex(times, 0.2), 2);
  assert.equal(visibleSampleIndex(times, 10), 3);
  assert.equal(visibleSampleIndex([], 0), -1);
});

import { PlaybackClock } from "./playback-clock.ts";
test("simulation preparation does not consume time; completion requires the configured duration", () => {
  const clock = new PlaybackClock(5);
  clock.play(false);
  clock.step(100000);
  assert.equal(clock.time, 0);
  assert.equal(clock.phase, "preparing");
  clock.prepared(true);
  clock.step(200000);
  assert.equal(clock.time, 0);
  for (let i = 1; i <= 40; i++) clock.step(200000 + i * 100);
  assert.ok(Math.abs(clock.time - 4) < 1e-9);
  assert.equal(clock.phase, "playing");
  for (let i = 41; i <= 51; i++) clock.step(200000 + i * 100);
  assert.equal(clock.time, 5);
  assert.equal(clock.phase, "complete");
});
test("pause and resume exclude paused wall time and replay starts at zero", () => {
  const clock = new PlaybackClock(1);
  clock.play(true);
  clock.step(0);
  clock.step(200);
  clock.pause();
  clock.step(10000);
  assert.equal(clock.time, 0.2);
  clock.play(true);
  clock.step(20000);
  clock.step(20200);
  assert.equal(clock.time, 0.4);
  clock.seek(1);
  clock.play(true);
  assert.equal(clock.time, 0);
  assert.equal(clock.phase, "playing");
});
test("playback speed scales simulation seconds and scrub stays paused", () => {
  const clock = new PlaybackClock(5);
  clock.setSpeed(0.25);
  clock.play(true);
  clock.step(0);
  for (let i = 1; i <= 10; i++) clock.step(i * 100);
  assert.ok(Math.abs(clock.time - 0.25) < 1e-9);
  clock.seek(2);
  clock.step(1100);
  assert.equal(clock.time, 2);
  assert.equal(clock.phase, "paused");
  clock.setSpeed(1);
  clock.play(true);
  clock.step(1200);
  clock.step(1400);
  assert.equal(clock.time, 2.2);
});
test("a suspended or stalled frame cannot skip straight to the end", () => {
  const clock = new PlaybackClock(5);
  clock.play(true);
  clock.step(0);
  clock.step(100);
  clock.step(90000);
  assert.equal(clock.time, 0.1);
  assert.equal(clock.phase, "playing");
  clock.step(90100);
  assert.equal(clock.time, 0.2);
});
test("cancelling preparation prevents a late worker result from restarting playback", () => {
  const clock = new PlaybackClock(5);
  clock.play(false);
  clock.pause();
  clock.prepared(true);
  clock.step(1000);
  assert.equal(clock.phase, "paused");
  assert.equal(clock.time, 0);
  clock.play(false);
  clock.prepared(false);
  assert.equal(clock.phase, "paused");
  clock.reset(10);
  assert.equal(clock.duration, 10);
  assert.equal(clock.phase, "idle");
});

import { runAtTime } from "./playback-view.ts";
test("generic playback limits signals and events in a graph without any scenes", () => {
  const project = exampleProject("events");
  const run = execute(project);
  const early = runAtTime(project, run, 0.3)!;
  assert.ok(!project.nodes.some((n) => n.kind.startsWith("scene")));
  const signal = early.results.gen.outputs.signal;
  assert.equal(signal.type, "signal");
  if (signal.type === "signal")
    assert.ok(signal.value.times.every((t) => t <= 0.3));
  const events = early.results.clock.outputs.event;
  assert.equal(events.type, "event");
  if (events.type === "event") assert.deepEqual(events.value, []);
  const later = runAtTime(project, run, 0.8)!;
  const laterEvents = later.results.clock.outputs.event;
  if (laterEvents.type === "event") assert.deepEqual(laterEvents.value, [0.5]);
  assert.equal(runAtTime(project, run, project.duration), run);
});
test("whole-signal summaries and their dependants wait until acquisition ends", () => {
  const project = exampleProject("data");
  const run = execute(project);
  const early = runAtTime(project, run, 0.5)!;
  assert.equal(early.results.statistics.status, "waiting");
  assert.deepEqual(early.results.statistics.outputs, {});
  assert.equal(early.results.display.status, "waiting");
  assert.equal(early.results.formula.status, "ok");
  assert.equal(
    runAtTime(project, run, project.duration)!.results.statistics.status,
    "ok",
  );
});
test("scrubbing cached results backwards never mutates the prepared run", () => {
  const project = exampleProject("events"),
    run = execute(project);
  const before = JSON.stringify(run);
  const later = runAtTime(project, run, 1.5)!.results.gen.outputs.signal;
  const early = runAtTime(project, run, 0.1)!.results.gen.outputs.signal;
  if (later.type === "signal" && early.type === "signal")
    assert.ok(early.value.times.length < later.value.times.length);
  assert.equal(JSON.stringify(run), before);
});

test("all scientific nodes execute successfully with finite outputs and correct schemas", () => {
  const p = blankProject();
  p.duration = 1.0;
  p.sampleRate = 100;
  // Test scalar evaluation of physical nodes
  const scalarKinds = [
    "chemicalReactor",
    "gasMixture",
    "toxicScrubber",
    "bernoulliOrifice",
    "darcyFriction",
    "shockwaveJump",
    "heatConduction",
    "heatConvection",
    "dropletEvaporation",
    "beamDeflection",
  ];
  for (const kind of scalarKinds) {
    const node = makeNode(kind);
    p.nodes.push(node);
  }
  const run = execute(p);
  for (const kind of scalarKinds) {
    const node = p.nodes.find((n) => n.kind === kind)!;
    const res = run.results[node.id];
    assert.equal(res.status, "ok", `Node ${kind} failed: ${res.message}`);
    for (const [outKey, packet] of Object.entries(res.outputs)) {
      if (packet.type === "number") {
        assert.ok(Number.isFinite(packet.value), `${kind}.${outKey} is not finite`);
      } else if (packet.type === "boolean") {
        assert.equal(typeof packet.value, "boolean");
      }
    }
  }

  // Test signal processing nodes with a generator signal
  const pSig = blankProject();
  pSig.duration = 1.0;
  pSig.sampleRate = 100;
  const gen = makeNode("generator");
  pSig.nodes.push(gen);

  const signalConsumerKinds = [
    { kind: "sdofVibration", inputPort: "force" },
    { kind: "viscoelasticDamper", inputPort: "displacement" },
    { kind: "fftSpectrum", inputPort: "signal" },
    { kind: "integrator", inputPort: "signal" },
    { kind: "differentiator", inputPort: "signal" },
    { kind: "pidController", inputPort: "measurement" },
    { kind: "bandpassFilter", inputPort: "signal" },
  ];

  for (const { kind, inputPort } of signalConsumerKinds) {
    const node = makeNode(kind);
    pSig.nodes.push(node);
    pSig.edges.push({
      id: `wire-${kind}`,
      source: gen.id,
      sourceHandle: "signal",
      target: node.id,
      targetHandle: inputPort,
    });
  }

  const runSig = execute(pSig);
  for (const { kind } of signalConsumerKinds) {
    const node = pSig.nodes.find((n) => n.kind === kind)!;
    const res = runSig.results[node.id];
    assert.equal(res.status, "ok", `Signal node ${kind} failed: ${res.message}`);
    for (const [outKey, packet] of Object.entries(res.outputs)) {
      if (packet.type === "signal") {
        assert.ok(packet.value.values.length > 0, `${kind}.${outKey} signal empty`);
        assert.ok(
          packet.value.values.every(Number.isFinite),
          `${kind}.${outKey} has non-finite values`,
        );
      } else if (packet.type === "number") {
        assert.ok(Number.isFinite(packet.value), `${kind}.${outKey} is not finite`);
      }
    }
  }
});

test("auto-layout organizes DAG nodes into left-to-right ranks with clean non-overlapping coordinates", () => {
  const p = blankProject();
  const nA = makeNode("generator", 500, 300); // source
  const nB = makeNode("filter", 100, 100);    // intermediate
  const nC = makeNode("scope", 50, 400);      // sink
  p.nodes = [nA, nB, nC];
  p.edges = [
    { id: "e1", source: nA.id, sourceHandle: "signal", target: nB.id, targetHandle: "signal" },
    { id: "e2", source: nB.id, sourceHandle: "signal", target: nC.id, targetHandle: "ch1" },
  ];

  const aligned = autoLayoutProject(p, { startX: 100, columnSpacing: 300 });
  const posA = aligned.nodes.find((n) => n.id === nA.id)!.position;
  const posB = aligned.nodes.find((n) => n.id === nB.id)!.position;
  const posC = aligned.nodes.find((n) => n.id === nC.id)!.position;

  // Left to right rank progression: A -> B -> C
  assert.equal(posA.x, 100);
  assert.equal(posB.x, 400);
  assert.equal(posC.x, 700);

  // Test branching topology
  const nBranch1 = makeNode("filter", 0, 0);
  const nBranch2 = makeNode("filter", 0, 0);
  const nJoin = makeNode("scope", 0, 0);
  const pBranch = blankProject();
  pBranch.nodes = [nA, nBranch1, nBranch2, nJoin];
  pBranch.edges = [
    { id: "e3", source: nA.id, sourceHandle: "signal", target: nBranch1.id, targetHandle: "signal" },
    { id: "e4", source: nA.id, sourceHandle: "signal", target: nBranch2.id, targetHandle: "signal" },
    { id: "e5", source: nBranch1.id, sourceHandle: "signal", target: nJoin.id, targetHandle: "ch1" },
    { id: "e6", source: nBranch2.id, sourceHandle: "signal", target: nJoin.id, targetHandle: "ch2" },
  ];
  const alignedBranch = autoLayoutProject(pBranch);
  const b1 = alignedBranch.nodes.find((n) => n.id === nBranch1.id)!.position;
  const b2 = alignedBranch.nodes.find((n) => n.id === nBranch2.id)!.position;
  assert.equal(b1.x, b2.x); // Same column
  assert.notEqual(b1.y, b2.y); // Different rows, no overlap
});
