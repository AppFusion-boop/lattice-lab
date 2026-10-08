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
  for (const template of ["sensor", "data", "events"]) {
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
  const pressure = r.results.sensor.outputs.signal;
  const formula = r.results.formula.outputs.result;
  assert.equal(pressure.type, "signal");
  assert.equal(formula.type, "signal");
  if (pressure.type !== "signal" || formula.type !== "signal") return;
  assert.deepEqual(pressure.value.times, formula.value.times);
  assert.equal(formula.value.unit, "V");
  assert.equal(formula.value.values[15], pressure.value.values[15] * 0.01);
  p.nodes.find((n) => n.id === "sensor")!.params.x = 4;
  const changed = execute(p).results.sensor.outputs.signal as {
    type: "signal";
    value: Signal;
  };
  assert.notDeepEqual(changed.value.values, pressure.value.values);
  assert.ok(
    changed.value.values.findIndex((x) => x > 0.1) <
      pressure.value.values.findIndex((x) => x > 0.1),
  );
});
test("disconnect propagates waiting; optional event inputs with no events keep generator silent", () => {
  const p = exampleProject();
  p.edges = p.edges.filter((e) => e.target !== "sensor");
  const r = execute(p);
  assert.equal(r.results.sensor.status, "waiting");
  assert.equal(r.results.formula.status, "waiting");
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
      target: "sensor",
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
    const r = execute(p).results.sensor;
    assert.equal(r.status, "ok");
    const v = r.outputs.signal;
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
