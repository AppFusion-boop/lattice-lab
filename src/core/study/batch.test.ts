import { test } from "node:test";
import assert from "node:assert/strict";
import { tunnelProject } from "../tunnel-demo.ts";
import { evaluateRows } from "./batch.ts";
import { reduceOutcome } from "./outcomes.ts";
import { HeaderError } from "./bindings.ts";
import type { BatchHeader, BatchRowInput } from "./types.ts";
import type { Packet } from "../types.ts";

test("tunnel demo: water.reduction 0 vs 45 attenuates peak pressure on mist scene while reference remains unchanged", () => {
  const project = tunnelProject();
  const header: BatchHeader = {
    project,
    parameterBindings: [
      { parameterKey: "reduction", nodeId: "water", paramKey: "reduction" },
    ],
    outcomeBindings: [
      {
        outcomeKey: "peak_mist",
        nodeId: "mist",
        port: "sensor:probe",
        reducer: "maxAbs",
      },
      {
        outcomeKey: "peak_ref",
        nodeId: "reference",
        port: "sensor:probe",
        reducer: "maxAbs",
      },
    ],
  };

  const rows: BatchRowInput[] = [
    { id: "row_reduction_0", values: { reduction: 0 } },
    { id: "row_reduction_45", values: { reduction: 45 } },
  ];

  const results = evaluateRows(header, rows);
  assert.equal(results.length, 2);
  assert.equal(results[0].status, "ok");
  assert.equal(results[1].status, "ok");

  const r0_ref = results[0].outcomes.peak_ref;
  const r45_ref = results[1].outcomes.peak_ref;
  const r0_mist = results[0].outcomes.peak_mist;
  const r45_mist = results[1].outcomes.peak_mist;

  // Reference tunnel has no water mist, so peak pressure must be identical
  assert.ok(Math.abs(r0_ref - r45_ref) < 1e-4, "Reference scene pressure must be unaffected by water reduction parameter");

  // Mist tunnel with 45% reduction must have strictly lower peak pressure than 0% reduction
  assert.ok(
    r45_mist < r0_mist,
    `Mist scene pressure (${r45_mist}) must be lower with 45% reduction than 0% reduction (${r0_mist})`,
  );
});

test("out-of-range parameter value results in row error without clamping", () => {
  const project = tunnelProject();
  const header: BatchHeader = {
    project,
    parameterBindings: [
      { parameterKey: "reduction", nodeId: "water", paramKey: "reduction" },
    ],
    outcomeBindings: [
      {
        outcomeKey: "peak_mist",
        nodeId: "mist",
        port: "sensor:probe",
        reducer: "maxAbs",
      },
    ],
  };

  // reduction field has max 95
  const rows: BatchRowInput[] = [
    { id: "valid_row", values: { reduction: 50 } },
    { id: "out_of_range_row", values: { reduction: 150 } },
  ];

  const results = evaluateRows(header, rows);
  assert.equal(results.length, 2);
  assert.equal(results[0].status, "ok");
  assert.equal(results[1].status, "error");
  assert.match(results[1].message || "", /above maximum 95/);
});

test("unknown node or port in bindings causes immediate HeaderError", () => {
  const project = tunnelProject();

  // 1. Unknown node in parameter bindings
  assert.throws(
    () =>
      evaluateRows(
        {
          project,
          parameterBindings: [
            { parameterKey: "foo", nodeId: "ghost_node", paramKey: "flow" },
          ],
          outcomeBindings: [],
        },
        [],
      ),
    (err: unknown) => err instanceof HeaderError && /ghost_node/.test(err.message),
  );

  // 2. Unknown field on valid node
  assert.throws(
    () =>
      evaluateRows(
        {
          project,
          parameterBindings: [
            { parameterKey: "foo", nodeId: "water", paramKey: "nonexistent_field" },
          ],
          outcomeBindings: [],
        },
        [],
      ),
    (err: unknown) => err instanceof HeaderError && /nonexistent_field/.test(err.message),
  );

  // 3. Unknown port in outcome bindings
  assert.throws(
    () =>
      evaluateRows(
        {
          project,
          parameterBindings: [],
          outcomeBindings: [
            {
              outcomeKey: "peak",
              nodeId: "mist",
              port: "sensor:nonexistent_sensor",
              reducer: "maxAbs",
            },
          ],
        },
        [],
      ),
    (err: unknown) => err instanceof HeaderError && /sensor:nonexistent_sensor/.test(err.message),
  );
});

test("outcome reducers evaluate correctly against hand-built signals and packets", () => {
  const times = [0, 0.5, 1.0, 1.5, 2.0];
  const values = [10, -25, 15, -5, 20];
  const signalPacket: Packet = {
    type: "signal",
    value: {
      times,
      values,
      unit: "Pa",
      name: "pressure",
    },
  };

  // max: max(10, -25, 15, -5, 20) = 20
  assert.equal(reduceOutcome(signalPacket, "max"), 20);

  // min: min(10, -25, 15, -5, 20) = -25
  assert.equal(reduceOutcome(signalPacket, "min"), -25);

  // maxAbs: max(|10|, |-25|, |15|, |-5|, |20|) = 25
  assert.equal(reduceOutcome(signalPacket, "maxAbs"), 25);

  // mean: (10 - 25 + 15 - 5 + 20) / 5 = 15 / 5 = 3
  assert.equal(reduceOutcome(signalPacket, "mean"), 3);

  // rms: sqrt((100 + 625 + 225 + 25 + 400) / 5) = sqrt(1375 / 5) = sqrt(275)
  assert.ok(Math.abs(reduceOutcome(signalPacket, "rms") - Math.sqrt(275)) < 1e-10);

  // final: values[4] = 20
  assert.equal(reduceOutcome(signalPacket, "final"), 20);

  // crossed: threshold = 18 -> true (20 >= 18) -> 1; threshold = 25 -> false (max is 20) -> 0
  assert.equal(reduceOutcome(signalPacket, "crossed", 18), 1);
  assert.equal(reduceOutcome(signalPacket, "crossed", 25), 0);

  // timeAbove: threshold = 12
  // times: [0, 0.5, 1.0, 1.5, 2.0]
  // values: [10 (<12), -25 (<12), 15 (>=12), -5 (<12), 20 (>=12)]
  // interval i=0: [0, 0.5], v[0]=10 < 12
  // interval i=1: [0.5, 1.0], v[1]=-25 < 12
  // interval i=2: [1.0, 1.5], v[2]=15 >= 12 -> +0.5
  // interval i=3: [1.5, 2.0], v[3]=-5 < 12
  // sum duration above = 0.5 seconds
  assert.equal(reduceOutcome(signalPacket, "timeAbove", 12), 0.5);

  // value reducer on number packet
  const numPacket: Packet = { type: "number", value: 42.5, unit: "m" };
  assert.equal(reduceOutcome(numPacket, "value"), 42.5);

  // value reducer on boolean packet
  const boolPacketTrue: Packet = { type: "boolean", value: true };
  const boolPacketFalse: Packet = { type: "boolean", value: false };
  assert.equal(reduceOutcome(boolPacketTrue, "value"), 1);
  assert.equal(reduceOutcome(boolPacketFalse, "value"), 0);
});

