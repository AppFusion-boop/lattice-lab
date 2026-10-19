import { L } from "./ka.ts";
import {
  sceneEvents,
  spatialFields,
  scheduleFields,
  eventConfig,
} from "./scene-events.ts";
import { sampleSensor, sensorUnits } from "./sensor-model.ts";
import type { Project, LabNode, SceneData } from "./types.ts";
import {
  sceneDefaults,
  type NodeDefinition,
  type Port,
  type Field,
  type Packet,
  type Signal,
  type EvalContext,
  type CustomTool,
  type DataType,
} from "./types.ts";
import { compileExpression } from "./expression.ts";
const port = (
  id: string,
  label: string,
  types: DataType[],
  optional = false,
): Port => ({ id, label, types, optional });
const num = (
  key: string,
  label: string,
  value: number,
  min = -1e6,
  max = 1e6,
  unit = "",
  step = 0.1,
): Field => ({
  key,
  label,
  kind: "number",
  default: value,
  min,
  max,
  unit,
  step,
});
const txt = (key: string, label: string, value: string): Field => ({
  key,
  label,
  kind: "text",
  default: value,
});
const sel = (
  key: string,
  label: string,
  value: string,
  options: string[],
): Field => ({ key, label, kind: "select", default: value, options });
const signal = (
  values: number[],
  times: number[],
  unit: string,
  name: string,
): Packet => ({ type: "signal", value: { values, times, unit, name } });
const n = (c: EvalContext, k: string) => Number(c.params[k]);
const s = (c: EvalContext, k: string) => String(c.params[k]);
function series(p: Packet | undefined): Signal {
  if (p?.type !== "signal") throw Error("Connect a sampled signal");
  return p.value;
}
function aligned(a: Signal, b: Signal) {
  if (
    a.times.length !== b.times.length ||
    a.times.some((t, i) => Math.abs(t - b.times[i]) > 1e-8)
  )
    throw Error(
      "Time grids differ. Resample both signals to the workflow clock.",
    );
}
function unpack(
  c: EvalContext,
  portName: string,
  fallbackVal: number,
  fallbackUnit = "",
): { isSignal: boolean; times: number[]; values: number[]; unit: string } {
  const p = c.inputs[portName];
  if (p?.type === "signal") {
    return {
      isSignal: true,
      times: p.value.times,
      values: p.value.values,
      unit: p.value.unit,
    };
  }
  if (p?.type === "number") {
    return {
      isSignal: false,
      times: c.times,
      values: c.times.map(() => p.value),
      unit: p.unit || fallbackUnit,
    };
  }
  return {
    isSignal: false,
    times: c.times,
    values: c.times.map(() => fallbackVal),
    unit: fallbackUnit,
  };
}
export function parseCSV(source: string) {
  if (source.length > 500000) throw Error("CSV limit is 500 KB");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw Error("Unclosed CSV quote");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2 || rows.length > 10001)
    throw Error("CSV needs headers and 1–10,000 data rows");
  const columns = rows.shift()!;
  if (
    columns.length > 20 ||
    new Set(columns).size !== columns.length ||
    columns.some((x) => !x)
  )
    throw Error("Use up to 20 unique, nonempty column headers");
  if (rows.some((r) => r.length !== columns.length))
    throw Error("CSV row lengths must match the header");
  return {
    columns,
    rows: rows.map((r) =>
      r.map((x) => (x !== "" && Number.isFinite(Number(x)) ? Number(x) : x)),
    ),
  };
}
const all: DataType[] = [
  "event",
  "number",
  "boolean",
  "text",
  "vector3",
  "signal",
  "table",
  "scene",
  "sensor",
  "sceneEvent",
];
const formulaEval = (c: EvalContext) => {
  const fn = compileExpression(s(c, "expression"));
  const a = c.inputs.a,
    b = c.inputs.b,
    inC = c.inputs.c,
    inD = c.inputs.d;
  const aa = a?.type === "signal" ? a.value : null,
    bb = b?.type === "signal" ? b.value : null,
    cc = inC?.type === "signal" ? inC.value : null,
    dd = inD?.type === "signal" ? inD.value : null;
  const sigs = [aa, bb, cc, dd].filter((x): x is NonNullable<typeof aa> => x !== null);
  for (let i = 1; i < sigs.length; i++) aligned(sigs[0], sigs[i]);
  const times = sigs[0]?.times;
  const numVal = (pkt: Packet | undefined, fallbackKey?: string) =>
    pkt?.type === "number"
      ? pkt.value
      : pkt?.type === "boolean"
        ? pkt.value
          ? 1
          : 0
        : fallbackKey
          ? n(c, fallbackKey)
          : 0;
  if (times)
    return {
      result: signal(
        times.map((t, i) =>
          fn({
            a: aa ? aa.values[i] : numVal(a, "a"),
            b: bb ? bb.values[i] : numVal(b, "b"),
            c: cc ? cc.values[i] : numVal(inC),
            d: dd ? dd.values[i] : numVal(inD),
            t,
          }),
        ),
        times,
        s(c, "unit"),
        c.node.label,
      ),
    };
  return {
    result: {
      type: "number",
      value: fn({
        a: numVal(a, "a"),
        b: numVal(b, "b"),
        c: numVal(inC),
        d: numVal(inD),
        t: 0,
      }),
      unit: s(c, "unit"),
    } as Packet,
  };
};
export const definitions: NodeDefinition[] = [
  ...sceneEvents.map((event): NodeDefinition => ({
    id: event.id,
    title: event.title,
    description: event.description,
    category: "Scene events",
    icon: event.icon,
    inputs: [port("trigger", "Schedule", ["event"], true)],
    outputs: [port("effect", "Scene event", ["sceneEvent"])],
    fields: [...scheduleFields, ...spatialFields, ...event.fields],
    help:
      event.help +
      " შეაერთეთ სცენის მოვლენების პორტთან. ტრიგერის ყოველი ნიშნული გეგმავს ახალ ამოქმედებას მითითებული წანაცვლებით.",
    evaluate: (c) => {
      const trigger =
        c.inputs.trigger?.type === "event" ? c.inputs.trigger.value : undefined;
      const config = eventConfig(c.node, trigger);
      if (config.starts.length > 256)
        throw Error(
          "Scene events support up to 256 trigger timestamps per run",
        );
      event.validate?.(c.params, c.sampleRate);
      return { effect: { type: "sceneEvent", value: config } };
    },
  })),
  {
    id: "manual",
    title: "Manual trigger",
    description: "Start a workflow on demand",
    category: "Triggers",
    icon: "MousePointer2",
    inputs: [],
    outputs: [port("event", "On run", ["event"])],
    fields: [],
    help: "Emits one event at t = 0 each time Run is pressed. Trigger streams are finite events in simulation time, not background jobs.",
    evaluate: () => ({ event: { type: "event", value: [0] } }),
  },
  {
    id: "interval",
    title: "Interval trigger",
    description: "Emit events at a fixed cadence",
    category: "Triggers",
    icon: "Timer",
    inputs: [],
    outputs: [port("event", "Tick", ["event"])],
    fields: [
      num("interval", "Interval", 0.25, 0.001, 60, "s"),
      num("start", "Start time", 0, 0, 60, "s"),
    ],
    help: "Generates timestamped events inside the workflow duration, up to 10,000 events.",
    evaluate: (c) => {
      const count = Math.max(
        0,
        Math.floor((c.duration - n(c, "start")) / n(c, "interval")) + 1,
      );
      if (count > 10000) throw Error("Too many events; increase interval");
      return {
        event: {
          type: "event",
          value: Array.from(
            { length: count },
            (_, i) => n(c, "start") + i * n(c, "interval"),
          ),
        },
      };
    },
  },
  ...[2, 3].map((d) => ({
    id: "scene" + d + "d",
    title: d + "D scene",
    description:
      d === 2
        ? "Arrange sources and sensors on a plane"
        : "Build a scene or import an OBJ model",
    category: "Scenes",
    icon: d === 2 ? "LayoutTemplate" : "Box",
    inputs: [
      { ...port("sensors", "Sensors", ["sensor"], true), multiple: true },
      { ...port("events", "Events", ["sceneEvent"], true), multiple: true },
      port("trigger", "Start", ["event"], true),
    ],
    outputs: [port("scene", "Environment", ["scene"])],
    fields: [
      sel("environment", "გარემო", "Open space", ["Open space", "Tunnel", "Molecular"]),
      num("width", "Width", 20, 2, 100, "m"),
      num("depth", "Depth", 12, 2, 100, "m"),
      num("height", "Height", 8, 2, 50, "m"),
      num("temperature", "Ambient temperature", 22, -100, 500, "°C"),
      num("light", "Illuminance", 500, 0, 100000, "lx"),
      num("amplitude", "Source amplitude", 1000, 0, 100000, "Pa"),
      num("frequency", "Source frequency", 8, 0.1, 500, "Hz"),
    ],
    help: "Scene geometry and analytical sensor fields are separate. Meshes are visual geometry; no collision, fluid, combustion or heat solver is implied.",
    evaluate: (c: EvalContext) => {
      const env = {
        ...sceneDefaults(d as 2 | 3),
        ...c.params,
        dimension: d,
        events: (c.inputLists.events || []).flatMap((p) =>
          p.type === "sceneEvent" ? [p.value] : [],
        ),
      } as SceneData;
      const out: Record<string, Packet> = {
        scene: { type: "scene", value: env },
      };
      for (const packet of c.inputLists.sensors || []) {
        if (packet.type !== "sensor") continue;
        const config = packet.value;
        out[sensorOutputId(config.id)] = sampleSensor({
          ...c,
          params: config.params,
          node: {
            ...c.node,
            id: config.id,
            label: config.label,
            kind: config.kind,
          },
          inputs: {
            scene: { type: "scene", value: env },
            position: { type: "vector3", value: config.position, unit: "m" },
            trigger: config.events
              ? { type: "event", value: config.events }
              : c.inputs.trigger,
          },
        });
      }
      return out;
    },
  })),
  {
    id: "constant",
    title: "Number",
    description: "A scalar value with an explicit unit",
    category: "Data",
    icon: "Hash",
    inputs: [],
    outputs: [port("value", "Value", ["number"])],
    fields: [num("value", "Value", 2), txt("unit", "Unit", "1")],
    help: "Scalar data source. Use 1 for dimensionless numbers. Units are metadata; no hidden conversion is applied.",
    evaluate: (c) => ({
      value: { type: "number", value: n(c, "value"), unit: s(c, "unit") },
    }),
  },
  {
    id: "boolean",
    title: "Boolean",
    description: "A true or false value",
    category: "Data",
    icon: "ToggleLeft",
    inputs: [],
    outputs: [port("value", "Value", ["boolean"])],
    fields: [sel("value", "Value", "true", ["true", "false"])],
    help: "Strongly typed boolean source.",
    evaluate: (c) => ({
      value: { type: "boolean", value: s(c, "value") === "true" },
    }),
  },
  {
    id: "text",
    title: "Text",
    description: "A label or string value",
    category: "Data",
    icon: "Type",
    inputs: [],
    outputs: [port("value", "Text", ["text"])],
    fields: [txt("value", "Text", "Experiment A")],
    help: "String data, suitable for inspection or logging.",
    evaluate: (c) => ({ value: { type: "text", value: s(c, "value") } }),
  },
  {
    id: "vector",
    title: "Vector 3",
    description: "Position or three-component value",
    category: "Data",
    icon: "Move3D",
    inputs: [],
    outputs: [port("value", "Vector", ["vector3"])],
    fields: [
      num("x", "X", 1),
      num("y", "Y", 1),
      num("z", "Z", 1),
      txt("unit", "Unit", "m"),
    ],
    help: "Typed 3D vector. Connect to a sensor position input; positions require meters.",
    evaluate: (c) => ({
      value: {
        type: "vector3",
        value: { x: n(c, "x"), y: n(c, "y"), z: n(c, "z") },
        unit: s(c, "unit"),
      },
    }),
  },
  {
    id: "csv",
    title: "CSV file",
    description: "Import a local tabular dataset",
    category: "Data",
    icon: "FileSpreadsheet",
    inputs: [],
    outputs: [port("table", "Rows", ["table"])],
    fields: [
      {
        key: "csv",
        label: "CSV contents",
        kind: "csv",
        default: "time,value\n0,0\n0.25,1\n0.5,0\n0.75,-1\n1,0",
      },
    ],
    help: "Local-only file parsing: comma-separated data, quoted cells, up to 500 KB and 10,000 rows. Files stay in this project.",
    evaluate: (c) => ({
      table: { type: "table", value: parseCSV(s(c, "csv")) },
    }),
  },
  {
    id: "column",
    title: "Table → signal",
    description: "Map time and value columns",
    category: "Data",
    icon: "Columns3",
    inputs: [port("table", "Table", ["table"])],
    outputs: [port("signal", "Signal", ["signal"])],
    fields: [
      txt("time", "Time column", "time"),
      txt("value", "Value column", "value"),
      txt("unit", "Value unit", "V"),
    ],
    help: "Time must be numeric, nonnegative seconds and strictly increasing. Use Resample before combining it with another time grid.",
    evaluate: (c) => {
      const p = c.inputs.table;
      if (p?.type !== "table") throw Error("Connect a table");
      const t = p.value.columns.indexOf(s(c, "time")),
        v = p.value.columns.indexOf(s(c, "value"));
      if (t < 0 || v < 0) throw Error("Column name not found");
      const times = p.value.rows.map((r) => r[t]),
        values = p.value.rows.map((r) => r[v]);
      if (
        times.some(
          (x, i) =>
            typeof x !== "number" ||
            x < 0 ||
            (i > 0 && x <= Number(times[i - 1])),
        ) ||
        values.some((x) => typeof x !== "number")
      )
        throw Error(
          "Expected numeric values and strictly increasing time in seconds",
        );
      return {
        signal: signal(
          values as number[],
          times as number[],
          s(c, "unit"),
          c.node.label,
        ),
      };
    },
  },
  {
    id: "generator",
    title: "Signal generator",
    description: "Sine, square or triangle waveform",
    category: "Data",
    icon: "Activity",
    inputs: [port("trigger", "Start", ["event"], true)],
    outputs: [port("signal", "Signal", ["signal"])],
    fields: [
      sel("wave", "Waveform", "sine", ["sine", "square", "triangle"]),
      num("frequency", "Frequency", 5, 0.1, 500, "Hz"),
      num("amplitude", "Amplitude", 2, 0, 10000, "unit"),
      num("offset", "Offset", 0),
      num("phase", "Phase", 0, -360, 360, "°"),
      txt("unit", "Unit", "V"),
    ],
    help: "Uses the workflow sample rate. If connected, the first event starts the generator; no event means a zero signal. Frequencies at or above Nyquist are rejected.",
    evaluate: (c) => {
      if (n(c, "frequency") >= c.sampleRate / 2)
        throw Error("Frequency must be below half the sample rate");
      const start =
        c.inputs.trigger?.type === "event"
          ? (c.inputs.trigger.value[0] ?? Infinity)
          : 0;
      return {
        signal: signal(
          c.times.map((t) => {
            if (t < start) return 0;
            const phase = (t - start) * n(c, "frequency") + n(c, "phase") / 360,
              u = ((phase % 1) + 1) % 1;
            return (
              n(c, "offset") +
              n(c, "amplitude") *
                (s(c, "wave") === "square"
                  ? u < 0.5
                    ? 1
                    : -1
                  : s(c, "wave") === "triangle"
                    ? 1 - 4 * Math.abs(u - 0.5)
                    : Math.sin(2 * Math.PI * phase))
            );
          }),
          c.times,
          s(c, "unit"),
          c.node.label,
        ),
      };
    },
  },
  ...[
    {
      id: "pressure",
      title: "Pressure sensor",
      description: "Ideal pressure transducer · Pa",
      unit: "Pa",
      icon: "Gauge",
    },
    {
      id: "temperature",
      title: "Temperature sensor",
      description: "Ideal temperature probe · °C",
      unit: "°C",
      icon: "Thermometer",
    },
    {
      id: "accelerometer",
      title: "Accelerometer",
      description: "Single-axis acceleration · m/s²",
      unit: "m/s²",
      icon: "Move3D",
    },
    {
      id: "microphone",
      title: "Microphone",
      description: "Ideal acoustic pressure · Pa",
      unit: "Pa",
      icon: "Mic",
    },
    {
      id: "light",
      title: "Light sensor",
      description: "Ideal illuminance probe · lx",
      unit: "lx",
      icon: "Sun",
    },
    {
      id: "gasSensor",
      title: "Gas & toxic sensor",
      description: "Multi-gas concentration detector · ppm",
      unit: "ppm",
      icon: "Wind",
    },
    {
      id: "heatFluxSensor",
      title: "Heat flux sensor",
      description: "Radiant & convective heat flux · kW/m²",
      unit: "kW/m²",
      icon: "Flame",
    },
    {
      id: "blastImpulseSensor",
      title: "Blast impulse sensor",
      description: "Integrated shockwave impulse · Pa·s",
      unit: "Pa·s",
      icon: "Zap",
    },
  ].map((spec) => ({
    id: spec.id,
    title: spec.title,
    description: spec.description,
    category: "Sensors",
    icon: spec.icon,
    inputs: [
      port("position", "Position", ["vector3"], true),
      port("trigger", "Start", ["event"], true),
    ],
    outputs: [port("sensor", "Attach to scene", ["sensor"])],
    fields: [
      num("x", "Position X", 12, 0, 100, "m"),
      num("y", "Position Y", 1, 0, 50, "m"),
      num("z", "Position Z", 6, 0, 100, "m"),
      num("sensitivity", "Sensitivity", 1, 0.0001, 100, "×"),
      num("bias", "Bias", 0, -100000, 100000, spec.unit),
      num("tau", "Response time", 0.01, 0, 10, "s"),
      ...(spec.id === "accelerometer"
        ? [
            num("frequency", "Oscillation", 5, 0.1, 500, "Hz"),
            num("amplitude", "Acceleration", 2, 0, 1000, "m/s²"),
          ]
        : []),
    ],
    help: "Connect this sensor output to a scene. It appears in the scene and creates a dedicated signal output there. Sensitivity, bias and response configure an ideal analytical model.",
    evaluate: (c: EvalContext) => {
      const vector = c.inputs.position;
      if (vector?.type === "vector3" && vector.unit !== "m")
        throw Error("Position vector must use meters");
      return {
        sensor: {
          type: "sensor",
          value: {
            id: c.node.id,
            label: c.node.label,
            kind: spec.id,
            unit: spec.unit,
            params: c.params,
            position:
              vector?.type === "vector3"
                ? vector.value
                : { x: n(c, "x"), y: n(c, "y"), z: n(c, "z") },
            ...(c.inputs.trigger?.type === "event"
              ? { events: c.inputs.trigger.value }
              : {}),
          },
        } as Packet,
      };
    },
  })),
  {
    id: "formula",
    title: "Formula",
    description: "Expressions with scalar & signal inputs",
    category: "Processing",
    icon: "Sigma",
    inputs: [
      port("a", "a", ["number", "signal"], true),
      port("b", "b", ["number", "signal"], true),
      port("c", "c", ["number", "signal"], true),
      port("d", "d", ["number", "signal"], true),
    ],
    outputs: [port("result", "Result", ["number", "signal"])],
    fields: [
      {
        key: "expression",
        label: "Expression",
        kind: "expression",
        default: "a * 0.01 + b",
      },
      num("a", "Fallback a", 0),
      num("b", "Fallback b", 0),
      txt("unit", "Output unit", "V"),
    ],
    help: "Variables a, b, c, d and t (seconds); pi and e. Scalar inputs broadcast over signals. Supports arithmetic, comparisons, logical operators, trigonometry, min/max, clamp and if. Output units are explicitly declared, not inferred.",
    evaluate: formulaEval,
  },
  {
    id: "filter",
    title: "Low-pass filter",
    description: "Smooth a signal with a causal filter",
    category: "Processing",
    icon: "Waves",
    inputs: [port("signal", "Signal", ["signal"])],
    outputs: [port("signal", "Filtered", ["signal"])],
    fields: [num("cutoff", "Cutoff frequency", 10, 0.01, 500, "Hz")],
    help: "First-order low-pass on the input time grid. Preserves the input unit. This is not an anti-aliasing substitute for a higher sample rate.",
    evaluate: (c) => {
      const input = series(c.inputs.signal);
      let y = input.values[0];
      return {
        signal: signal(
          input.values.map((v, i) => {
            y +=
              (i
                ? 1 -
                  Math.exp(
                    -2 *
                      Math.PI *
                      n(c, "cutoff") *
                      (input.times[i] - input.times[i - 1]),
                  )
                : 0) *
              (v - y);
            return y;
          }),
          input.times,
          input.unit,
          c.node.label,
        ),
      };
    },
  },
  {
    id: "resample",
    title: "Resample",
    description: "Align data to the workflow clock",
    category: "Processing",
    icon: "Spline",
    inputs: [port("signal", "Signal", ["signal"])],
    outputs: [port("signal", "Aligned", ["signal"])],
    fields: [sel("outside", "Outside input range", "hold", ["hold", "zero"])],
    help: "Linear interpolation onto the workflow time grid. Choose hold or zero outside the input range.",
    evaluate: (c) => {
      const a = series(c.inputs.signal);
      let j = 0;
      return {
        signal: signal(
          c.times.map((t) => {
            if (t < a.times[0])
              return s(c, "outside") === "zero" ? 0 : a.values[0];
            if (t > a.times.at(-1)!)
              return s(c, "outside") === "zero" ? 0 : a.values.at(-1)!;
            while (j < a.times.length - 2 && a.times[j + 1] < t) j++;
            if (a.times.length === 1) return a.values[0];
            const f = (t - a.times[j]) / (a.times[j + 1] - a.times[j]);
            return a.values[j] + f * (a.values[j + 1] - a.values[j]);
          }),
          c.times,
          a.unit,
          c.node.label,
        ),
      };
    },
  },
  {
    id: "statistics",
    title: "Statistics",
    description: "Peak, mean and RMS of a signal",
    category: "Processing",
    icon: "ChartNoAxesCombined",
    inputs: [port("signal", "Signal", ["signal"])],
    outputs: [
      port("peak", "Peak", ["number"]),
      port("rms", "RMS", ["number"]),
      port("mean", "Mean", ["number"]),
    ],
    fields: [],
    help: "Sample-weighted statistics over the entire input. Peak is maximum absolute magnitude.",
    evaluate: (c) => {
      const v = series(c.inputs.signal),
        a = v.values;
      return {
        peak: {
          type: "number",
          value: Math.max(...a.map(Math.abs)),
          unit: v.unit,
        },
        rms: {
          type: "number",
          value: Math.sqrt(a.reduce((r, x) => r + x * x, 0) / a.length),
          unit: v.unit,
        },
        mean: {
          type: "number",
          value: a.reduce((r, x) => r + x, 0) / a.length,
          unit: v.unit,
        },
      };
    },
  },
  {
    id: "threshold",
    title: "Threshold event",
    description: "Emit an event when a signal crosses",
    category: "Logic & events",
    icon: "Zap",
    inputs: [port("signal", "Signal", ["signal"])],
    outputs: [
      port("event", "Crossings", ["event"]),
      port("active", "Any crossing", ["boolean"]),
    ],
    fields: [
      num("level", "Threshold", 0.2),
      sel("edge", "Crossing direction", "rising", [
        "rising",
        "falling",
        "either",
      ]),
    ],
    help: "Detects crossings between adjacent samples and interpolates the event timestamp. The threshold uses the input signal unit.",
    evaluate: (c) => {
      const a = series(c.inputs.signal),
        events: number[] = [];
      for (let i = 1; i < a.values.length; i++) {
        const x = a.values[i - 1],
          y = a.values[i],
          l = n(c, "level"),
          up = x < l && y >= l,
          down = x > l && y <= l;
        if (
          (s(c, "edge") !== "falling" && up) ||
          (s(c, "edge") !== "rising" && down)
        )
          events.push(
            a.times[i - 1] +
              ((l - x) / (y - x)) * (a.times[i] - a.times[i - 1]),
          );
      }
      return {
        event: { type: "event", value: events },
        active: { type: "boolean", value: events.length > 0 },
      };
    },
  },
  {
    id: "delay",
    title: "Event delay",
    description: "Shift event timestamps",
    category: "Logic & events",
    icon: "Clock3",
    inputs: [port("event", "Events", ["event"])],
    outputs: [port("event", "Delayed", ["event"])],
    fields: [num("delay", "Delay", 0.1, 0, 60, "s")],
    help: "Shifts every timestamp and drops events outside the workflow duration. No wall-clock timer is created.",
    evaluate: (c) => ({
      event: {
        type: "event",
        value:
          c.inputs.event?.type === "event"
            ? c.inputs.event.value
                .map((t) => t + n(c, "delay"))
                .filter((t) => t <= c.duration)
            : [],
      },
    }),
  },
  {
    id: "compare",
    title: "Compare",
    description: "Compare a scalar against a value",
    category: "Logic & events",
    icon: "GitBranch",
    inputs: [port("value", "Value", ["number"])],
    outputs: [
      port("result", "Result", ["boolean"]),
      port("event", "When true", ["event"]),
    ],
    fields: [
      sel("operator", "Operator", ">", [">", ">=", "<", "<=", "=="]),
      num("threshold", "Compare with", 1),
    ],
    help: "Evaluates once per run. Emits t=0 if true. For signal crossings use Threshold event.",
    evaluate: (c) => {
      const a = c.inputs.value;
      if (a?.type !== "number") throw Error("Connect a scalar");
      const b = n(c, "threshold");
      const pass =
        s(c, "operator") === ">"
          ? a.value > b
          : s(c, "operator") === ">="
            ? a.value >= b
            : s(c, "operator") === "<"
              ? a.value < b
              : s(c, "operator") === "<="
                ? a.value <= b
                : a.value === b;
      return {
        result: { type: "boolean", value: pass },
        event: { type: "event", value: pass ? [0] : [] },
      };
    },
  },
  {
    id: "gate",
    title: "Event gate",
    description: "Pass a signal after the first event",
    category: "Logic & events",
    icon: "Split",
    inputs: [
      port("signal", "Signal", ["signal"]),
      port("event", "Open", ["event"]),
    ],
    outputs: [port("signal", "Output", ["signal"])],
    fields: [],
    help: "Zeroes samples before the first event. An empty event stream produces zeros for the entire run.",
    evaluate: (c) => {
      const a = series(c.inputs.signal),
        ev = c.inputs.event;
      const start = ev?.type === "event" ? (ev.value[0] ?? Infinity) : Infinity;
      return {
        signal: signal(
          a.values.map((v, i) => (a.times[i] >= start ? v : 0)),
          a.times,
          a.unit,
          c.node.label,
        ),
      };
    },
  },
  {
    id: "scope",
    title: "Oscilloscope",
    description: "Compare two time-domain signals",
    category: "Outputs",
    icon: "Activity",
    inputs: [
      port("ch1", "Channel 1", ["signal"], true),
      port("ch2", "Channel 2", ["signal"], true),
    ],
    outputs: [],
    fields: [],
    help: "Displays the actual time coordinates and units of both inputs. Different units use separate axes. Connect at least one channel.",
    evaluate: (c) => {
      if (!c.inputs.ch1 && !c.inputs.ch2)
        throw Error("Connect at least one channel");
      return {};
    },
  },
  {
    id: "inspect",
    title: "Value display",
    description: "Inspect any typed output",
    category: "Outputs",
    icon: "PanelTop",
    inputs: [port("value", "Value", all)],
    outputs: [],
    fields: [],
    help: "Shows the incoming scalar, vector, text, event stream, table, scene or sampled signal.",
    evaluate: () => ({}),
  },
  {
    id: "tableview",
    title: "Data table",
    description: "Inspect imported table rows",
    category: "Outputs",
    icon: "Table2",
    inputs: [port("table", "Table", ["table"])],
    outputs: [],
    fields: [],
    help: "Displays table data. Export current results as CSV from the results panel.",
    evaluate: () => ({}),
  },
  {
    id: "eventlog",
    title: "Event monitor",
    description: "View emitted events and timestamps",
    category: "Outputs",
    icon: "ListOrdered",
    inputs: [port("event", "Events", ["event"])],
    outputs: [],
    fields: [],
    help: "A sink for timestamped events in simulation time. It does not send notifications to external services.",
    evaluate: () => ({}),
  },
  {
    id: "chemicalReactor",
    title: "Chemical reactor",
    description: "CSTR & PFR reaction kinetics, conversion & heat release",
    category: "Chemistry & Reactions",
    icon: "Atom",
    inputs: [
      port("temp", "Temperature", ["number", "signal"], true),
      port("concentration", "Inlet conc. (C0)", ["number", "signal"], true),
    ],
    outputs: [
      port("conversion", "Conversion X", ["number", "signal"]),
      port("productConc", "Product conc.", ["number", "signal"]),
      port("heatRelease", "Heat release", ["number", "signal"]),
    ],
    fields: [
      sel("reactorType", "Reactor model", "PFR / Batch", ["PFR / Batch", "CSTR"]),
      sel("order", "Reaction order", "1st order", ["1st order", "2nd order"]),
      num("A", "Arrhenius pre-exponential A", 1e7, 1, 1e16, "1/s", 1e5),
      num("Ea", "Activation energy Ea", 55, 1, 300, "kJ/mol", 1),
      num("tau", "Residence time tau", 2.0, 0.001, 3600, "s", 0.1),
      num("deltaH", "Heat of reaction deltaH", -120, -1000, 1000, "kJ/mol", 5),
      num("flowRate", "Volumetric flow rate", 100, 0.1, 10000, "L/min", 5),
      num("fallbackT", "Fallback temp", 25, -50, 2000, "°C", 1),
      num("fallbackC0", "Fallback C0", 100, 0.001, 10000, "mol/m³", 5),
    ],
    help: "Calculates Arrhenius rate k = A * exp(-Ea / (R*T)), conversion fraction X, outlet concentrations, and exothermic or endothermic heat release rate in kW.",
    evaluate: (c) => {
      const temp = unpack(c, "temp", n(c, "fallbackT"), "°C");
      const conc = unpack(c, "concentration", n(c, "fallbackC0"), "mol/m³");
      const isSig = temp.isSignal || conc.isSignal;
      const times = temp.isSignal ? temp.times : conc.times;
      const R_kJ = 8.3144626e-3;
      const tau = Math.max(0.001, n(c, "tau"));
      const isCSTR = s(c, "reactorType") === "CSTR";
      const is1st = s(c, "order") === "1st order";
      const qFlowM3s = n(c, "flowRate") / 60000;
      const convVals: number[] = [];
      const prodVals: number[] = [];
      const heatVals: number[] = [];
      for (let i = 0; i < times.length; i++) {
        const TK = Math.max(1, temp.values[i] + 273.15);
        const C0 = Math.max(0, conc.values[i]);
        const k = n(c, "A") * Math.exp(-n(c, "Ea") / (R_kJ * TK));
        let X = 0;
        if (is1st) {
          X = isCSTR ? (k * tau) / (1 + k * tau) : 1 - Math.exp(-k * tau);
        } else {
          const kCtau = k * C0 * tau;
          X = isCSTR
            ? (Math.sqrt(1 + 4 * kCtau) - 1) / (2 * Math.max(1e-9, kCtau))
            : kCtau / (1 + kCtau);
        }
        X = Math.max(0, Math.min(0.9999, X));
        convVals.push(X);
        prodVals.push(C0 * X);
        const heatKW = C0 * X * qFlowM3s * -n(c, "deltaH");
        heatVals.push(heatKW);
      }
      if (isSig) {
        return {
          conversion: signal(convVals, times, "fraction", c.node.label),
          productConc: signal(prodVals, times, "mol/m³", c.node.label),
          heatRelease: signal(heatVals, times, "kW", c.node.label),
        };
      }
      return {
        conversion: { type: "number", value: convVals[0], unit: "fraction" },
        productConc: { type: "number", value: prodVals[0], unit: "mol/m³" },
        heatRelease: { type: "number", value: heatVals[0], unit: "kW" },
      };
    },
  },
  {
    id: "gasMixture",
    title: "Gas mixture & flammability",
    description: "Mixture density, sound speed, and LFL flammability hazard",
    category: "Chemistry & Reactions",
    icon: "Flame",
    inputs: [
      port("pressure", "Pressure", ["number", "signal"], true),
      port("temperature", "Temperature", ["number", "signal"], true),
      port("fuelPercent", "Fuel vol %", ["number", "signal"], true),
    ],
    outputs: [
      port("density", "Density", ["number", "signal"]),
      port("speedOfSound", "Speed of sound", ["number", "signal"]),
      port("lfl", "Lower flammability limit", ["number"]),
      port("flammable", "Flammable hazard", ["boolean", "signal"]),
    ],
    fields: [
      sel("fuelGas", "Fuel species", "Methane (CH4)", [
        "Methane (CH4)",
        "Hydrogen (H2)",
        "Propane (C3H8)",
        "Carbon Monoxide (CO)",
        "Acetylene (C2H2)",
      ]),
      num("fallbackFuelPct", "Fuel vol %", 5.0, 0, 100, "%", 0.5),
      num("fallbackP", "Ambient pressure", 101325, 1000, 10000000, "Pa", 500),
      num("fallbackT", "Ambient temp", 20, -50, 1500, "°C", 1),
    ],
    help: "Computes mixture density rho = P*M/(R*T), acoustic wave speed, and safety flammability limits based on fuel concentration in air.",
    evaluate: (c) => {
      const pIn = unpack(c, "pressure", n(c, "fallbackP"), "Pa");
      const tIn = unpack(c, "temperature", n(c, "fallbackT"), "°C");
      const fIn = unpack(c, "fuelPercent", n(c, "fallbackFuelPct"), "%");
      const isSig = pIn.isSignal || tIn.isSignal || fIn.isSignal;
      const times = pIn.isSignal ? pIn.times : tIn.isSignal ? tIn.times : fIn.times;
      const gas = s(c, "fuelGas");
      const specs: Record<string, { M: number; gamma: number; lfl: number; ufl: number }> = {
        "Methane (CH4)": { M: 16.04, gamma: 1.31, lfl: 5.0, ufl: 15.0 },
        "Hydrogen (H2)": { M: 2.016, gamma: 1.41, lfl: 4.0, ufl: 75.0 },
        "Propane (C3H8)": { M: 44.1, gamma: 1.13, lfl: 2.1, ufl: 9.5 },
        "Carbon Monoxide (CO)": { M: 28.01, gamma: 1.4, lfl: 12.5, ufl: 74.0 },
        "Acetylene (C2H2)": { M: 26.04, gamma: 1.26, lfl: 2.5, ufl: 100.0 },
      };
      const spec = specs[gas] || specs["Methane (CH4)"];
      const rhoVals: number[] = [];
      const soundVals: number[] = [];
      const flamVals: number[] = [];
      const Ru = 8.3144626;
      for (let i = 0; i < times.length; i++) {
        const pct = Math.max(0, Math.min(100, fIn.values[i]));
        const yFuel = pct / 100;
        const yAir = 1 - yFuel;
        const M_mix_kg = (yFuel * spec.M + yAir * 28.97) / 1000;
        const gamma_mix = yFuel * spec.gamma + yAir * 1.4;
        const TK = Math.max(1, tIn.values[i] + 273.15);
        const P = Math.max(10, pIn.values[i]);
        const rho = (P * M_mix_kg) / (Ru * TK);
        const sound = Math.sqrt((gamma_mix * Ru * TK) / M_mix_kg);
        const isFlam = pct >= spec.lfl && pct <= spec.ufl ? 1 : 0;
        rhoVals.push(rho);
        soundVals.push(sound);
        flamVals.push(isFlam);
      }
      if (isSig) {
        return {
          density: signal(rhoVals, times, "kg/m³", c.node.label),
          speedOfSound: signal(soundVals, times, "m/s", c.node.label),
          lfl: { type: "number", value: spec.lfl, unit: "%" },
          flammable: signal(flamVals, times, "flag", c.node.label),
        };
      }
      return {
        density: { type: "number", value: rhoVals[0], unit: "kg/m³" },
        speedOfSound: { type: "number", value: soundVals[0], unit: "m/s" },
        lfl: { type: "number", value: spec.lfl, unit: "%" },
        flammable: { type: "boolean", value: flamVals[0] === 1 },
      };
    },
  },
  {
    id: "toxicScrubber",
    title: "Gas scrubber & mass transfer",
    description: "Two-film mass transfer absorption and toxic gas neutralization",
    category: "Chemistry & Reactions",
    icon: "Droplets",
    inputs: [
      port("inletGas", "Inlet toxic gas", ["number", "signal"], true),
      port("liquidFlow", "Scrubber liquid flow", ["number", "signal"], true),
    ],
    outputs: [
      port("outletGas", "Outlet toxic gas", ["number", "signal"]),
      port("efficiency", "Scrubbing efficiency", ["number", "signal"]),
      port("reagentRate", "Reagent reaction rate", ["number", "signal"]),
    ],
    fields: [
      sel("agent", "Scrubber reagent", "Alkaline / Scrubber (NaOH)", [
        "Alkaline / Scrubber (NaOH)",
        "Water Mist Curtain",
        "Oxidizing Bleach (NaOCl)",
        "Acidic Neutralizer (H2SO4)",
      ]),
      num("d32", "Droplet Sauter diameter D32", 80, 5, 1000, "µm", 5),
      num("height", "Tower / curtain height", 3.0, 0.2, 30, "m", 0.5),
      num("gasVelocity", "Gas superficial velocity", 1.2, 0.1, 15, "m/s", 0.1),
      num("fallbackInlet", "Fallback inlet gas", 500, 0, 50000, "ppm", 20),
      num("fallbackFlow", "Fallback liquid flow", 45, 0.5, 500, "L/min", 5),
    ],
    help: "Models gas-liquid mass transfer in spray droplet contactors. Smaller droplet Sauter diameter D32 increases interfacial contact area and scrubbing efficiency.",
    evaluate: (c) => {
      const gIn = unpack(c, "inletGas", n(c, "fallbackInlet"), "ppm");
      const qIn = unpack(c, "liquidFlow", n(c, "fallbackFlow"), "L/min");
      const isSig = gIn.isSignal || qIn.isSignal;
      const times = gIn.isSignal ? gIn.times : qIn.times;
      const agent = s(c, "agent");
      const E = agent.includes("Water") ? 1.0 : 3.8;
      const d32 = Math.max(5, n(c, "d32"));
      const H = Math.max(0.1, n(c, "height"));
      const vg = Math.max(0.1, n(c, "gasVelocity"));
      const outGasVals: number[] = [];
      const effVals: number[] = [];
      const rxnVals: number[] = [];
      for (let i = 0; i < times.length; i++) {
        const QL = Math.max(0.1, qIn.values[i]);
        const Cin = Math.max(0, gIn.values[i]);
        const Nog = E * ((0.0075 * Math.pow(QL, 0.65) * H) / (vg * Math.sqrt(d32 / 80)));
        const eff = Math.max(0, Math.min(0.999, 1 - Math.exp(-Nog)));
        const Cout = Cin * (1 - eff);
        const rateGps = Cin * eff * vg * 0.045;
        outGasVals.push(Cout);
        effVals.push(eff * 100);
        rxnVals.push(rateGps);
      }
      if (isSig) {
        return {
          outletGas: signal(outGasVals, times, "ppm", c.node.label),
          efficiency: signal(effVals, times, "%", c.node.label),
          reagentRate: signal(rxnVals, times, "g/s", c.node.label),
        };
      }
      return {
        outletGas: { type: "number", value: outGasVals[0], unit: "ppm" },
        efficiency: { type: "number", value: effVals[0], unit: "%" },
        reagentRate: { type: "number", value: rxnVals[0], unit: "g/s" },
      };
    },
  },
  {
    id: "bernoulliOrifice",
    title: "Bernoulli orifice discharge",
    description: "Nozzle & orifice flow rate from differential pressure",
    category: "Physics & Fluids",
    icon: "Gauge",
    inputs: [
      port("deltaP", "Pressure drop (deltaP)", ["number", "signal"], true),
    ],
    outputs: [
      port("flowRate", "Discharge flow rate", ["number", "signal"]),
      port("massFlow", "Mass flow rate", ["number", "signal"]),
      port("jetVelocity", "Jet velocity", ["number", "signal"]),
    ],
    fields: [
      num("diameter", "Orifice diameter", 15, 0.5, 500, "mm", 1),
      num("cd", "Discharge coefficient Cd", 0.62, 0.1, 1.0, "", 0.01),
      num("density", "Fluid density rho", 1000, 0.5, 20000, "kg/m³", 10),
      num("fallbackDeltaP", "Fallback deltaP", 50000, 0, 10000000, "Pa", 1000),
    ],
    help: "Computes Torricelli-Bernoulli discharge Q = Cd * A * sqrt(2 * deltaP / rho), mass flow rate, and exit jet velocity.",
    evaluate: (c) => {
      const dpIn = unpack(c, "deltaP", n(c, "fallbackDeltaP"), "Pa");
      const dM = n(c, "diameter") * 1e-3;
      const area = (Math.PI * dM * dM) / 4;
      const rho = Math.max(0.1, n(c, "density"));
      const cd = n(c, "cd");
      const flowVals: number[] = [];
      const massVals: number[] = [];
      const velVals: number[] = [];
      for (let i = 0; i < dpIn.times.length; i++) {
        const dP = Math.max(0, dpIn.values[i]);
        const vj = Math.sqrt((2 * dP) / rho);
        const Q_m3s = cd * area * vj;
        flowVals.push(Q_m3s * 60000);
        massVals.push(rho * Q_m3s);
        velVals.push(vj);
      }
      if (dpIn.isSignal) {
        return {
          flowRate: signal(flowVals, dpIn.times, "L/min", c.node.label),
          massFlow: signal(massVals, dpIn.times, "kg/s", c.node.label),
          jetVelocity: signal(velVals, dpIn.times, "m/s", c.node.label),
        };
      }
      return {
        flowRate: { type: "number", value: flowVals[0], unit: "L/min" },
        massFlow: { type: "number", value: massVals[0], unit: "kg/s" },
        jetVelocity: { type: "number", value: velVals[0], unit: "m/s" },
      };
    },
  },
  {
    id: "darcyFriction",
    title: "Darcy pipe friction loss",
    description: "Darcy-Weisbach hydraulic head loss & Colebrook friction",
    category: "Physics & Fluids",
    icon: "Waves",
    inputs: [
      port("flowRate", "Flow rate", ["number", "signal"], true),
    ],
    outputs: [
      port("pressureDrop", "Friction loss deltaP", ["number", "signal"]),
      port("reynolds", "Reynolds number", ["number", "signal"]),
      port("frictionFactor", "Darcy friction factor f", ["number", "signal"]),
    ],
    fields: [
      num("diameter", "Internal pipe diameter", 50, 2, 2000, "mm", 2),
      num("length", "Pipe length", 25, 0.1, 10000, "m", 1),
      num("roughness", "Roughness epsilon", 0.045, 0.001, 10, "mm", 0.005),
      num("density", "Fluid density rho", 1000, 0.5, 20000, "kg/m³", 10),
      num("viscosity", "Dynamic viscosity mu", 0.001, 1e-6, 100, "Pa·s", 0.0001),
      num("fallbackFlow", "Fallback flow", 60, 0.1, 10000, "L/min", 5),
    ],
    help: "Computes pipe Reynolds number Re = rho*v*D / mu, Darcy friction factor f via Swamee-Jain, and total friction pressure drop deltaP = f * (L/D) * (rho*v^2 / 2).",
    evaluate: (c) => {
      const qIn = unpack(c, "flowRate", n(c, "fallbackFlow"), "L/min");
      const D = Math.max(1e-4, n(c, "diameter") * 1e-3);
      const A = (Math.PI * D * D) / 4;
      const L = Math.max(0.01, n(c, "length"));
      const rho = Math.max(0.1, n(c, "density"));
      const mu = Math.max(1e-6, n(c, "viscosity"));
      const dpVals: number[] = [];
      const reVals: number[] = [];
      const fVals: number[] = [];
      for (let i = 0; i < qIn.times.length; i++) {
        const Q_m3s = Math.max(0, qIn.values[i]) / 60000;
        const v = Q_m3s / A;
        const Re = (rho * v * D) / mu;
        let f = 0.02;
        if (Re < 2300) {
          f = 64 / Math.max(1, Re);
        } else {
          const eps = (n(c, "roughness") * 1e-3) / (3.7 * D);
          f = 0.25 / Math.pow(Math.log10(eps + 5.74 / Math.pow(Math.max(10, Re), 0.9)), 2);
        }
        const dP = f * (L / D) * 0.5 * rho * v * v;
        dpVals.push(dP);
        reVals.push(Re);
        fVals.push(f);
      }
      if (qIn.isSignal) {
        return {
          pressureDrop: signal(dpVals, qIn.times, "Pa", c.node.label),
          reynolds: signal(reVals, qIn.times, "", c.node.label),
          frictionFactor: signal(fVals, qIn.times, "", c.node.label),
        };
      }
      return {
        pressureDrop: { type: "number", value: dpVals[0], unit: "Pa" },
        reynolds: { type: "number", value: reVals[0], unit: "" },
        frictionFactor: { type: "number", value: fVals[0], unit: "" },
      };
    },
  },
  {
    id: "shockwaveJump",
    title: "Rankine-Hugoniot shock relations",
    description: "Supersonic shock jump relations and reflected wall pressure",
    category: "Physics & Fluids",
    icon: "Zap",
    inputs: [
      port("overpressure", "Peak overpressure", ["number", "signal"], true),
    ],
    outputs: [
      port("reflectedPressure", "Reflected overpressure", ["number", "signal"]),
      port("mach", "Shock Mach number", ["number", "signal"]),
      port("shockSpeed", "Shock wave speed", ["number", "signal"]),
      port("tempBehind", "Post-shock temp", ["number", "signal"]),
    ],
    fields: [
      num("ambientP", "Ambient pressure P1", 101325, 1000, 2000000, "Pa", 500),
      num("ambientT", "Ambient temp T1", 20, -50, 500, "°C", 1),
      num("gamma", "Adiabatic index gamma", 1.4, 1.1, 1.67, "", 0.01),
      num("fallbackOverpressure", "Fallback overpressure", 35000, 0, 5000000, "Pa", 1000),
    ],
    help: "Computes Rankine-Hugoniot normal shock relations: Mach number, shock speed, post-shock temperature, and normal reflection overpressure on rigid walls.",
    evaluate: (c) => {
      const pIn = unpack(c, "overpressure", n(c, "fallbackOverpressure"), "Pa");
      const P1 = Math.max(100, n(c, "ambientP"));
      const T1 = n(c, "ambientT") + 273.15;
      const gamma = n(c, "gamma");
      const c1 = Math.sqrt(gamma * (8314.46 / 28.97) * T1);
      const prVals: number[] = [];
      const machVals: number[] = [];
      const speedVals: number[] = [];
      const tempVals: number[] = [];
      for (let i = 0; i < pIn.times.length; i++) {
        const dP = Math.max(0, pIn.values[i]);
        const P2 = P1 + dP;
        const Pi = P2 / P1;
        const Mach = Math.sqrt(1 + ((gamma + 1) / (2 * gamma)) * (Pi - 1));
        const Ws = Mach * c1;
        const tempRatio = Pi * ((gamma + 1) / (gamma - 1) + Pi) / (1 + ((gamma + 1) / (gamma - 1)) * Pi);
        const T2 = T1 * tempRatio - 273.15;
        const Pr = 2 * dP + ((gamma + 1) * dP * dP) / (2 * gamma * P1 + (gamma - 1) * dP);
        prVals.push(Pr);
        machVals.push(Mach);
        speedVals.push(Ws);
        tempVals.push(T2);
      }
      if (pIn.isSignal) {
        return {
          reflectedPressure: signal(prVals, pIn.times, "Pa", c.node.label),
          mach: signal(machVals, pIn.times, "", c.node.label),
          shockSpeed: signal(speedVals, pIn.times, "m/s", c.node.label),
          tempBehind: signal(tempVals, pIn.times, "°C", c.node.label),
        };
      }
      return {
        reflectedPressure: { type: "number", value: prVals[0], unit: "Pa" },
        mach: { type: "number", value: machVals[0], unit: "" },
        shockSpeed: { type: "number", value: speedVals[0], unit: "m/s" },
        tempBehind: { type: "number", value: tempVals[0], unit: "°C" },
      };
    },
  },
  {
    id: "heatConduction",
    title: "1D Fourier heat conduction",
    description: "Thermal conduction rate Q, heat flux q'', and thermal resistance",
    category: "Thermodynamics",
    icon: "Thermometer",
    inputs: [
      port("tHot", "Hot temp (T1)", ["number", "signal"], true),
      port("tCold", "Cold temp (T2)", ["number", "signal"], true),
    ],
    outputs: [
      port("heatFlow", "Heat rate Q", ["number", "signal"]),
      port("heatFlux", "Heat flux q''", ["number", "signal"]),
      port("resistance", "Thermal resistance Rth", ["number"]),
    ],
    fields: [
      num("k", "Thermal conductivity k", 1.4, 0.001, 2000, "W/(m·K)", 0.1),
      num("thickness", "Wall thickness L", 0.2, 0.001, 10, "m", 0.01),
      num("area", "Conduction area A", 10, 0.01, 10000, "m²", 1),
      num("fallbackHot", "Fallback T1", 200, -100, 3000, "°C", 5),
      num("fallbackCold", "Fallback T2", 20, -100, 3000, "°C", 5),
    ],
    help: "Fourier 1D thermal conduction: Q = (k * A / L) * (T1 - T2), heat flux q'' = Q / A, and conduction resistance Rth = L / (k * A).",
    evaluate: (c) => {
      const hIn = unpack(c, "tHot", n(c, "fallbackHot"), "°C");
      const cIn = unpack(c, "tCold", n(c, "fallbackCold"), "°C");
      const isSig = hIn.isSignal || cIn.isSignal;
      const times = hIn.isSignal ? hIn.times : cIn.times;
      const k = Math.max(1e-4, n(c, "k"));
      const L = Math.max(1e-4, n(c, "thickness"));
      const A = Math.max(1e-4, n(c, "area"));
      const Rth = L / (k * A);
      const qVals: number[] = [];
      const fluxVals: number[] = [];
      for (let i = 0; i < times.length; i++) {
        const dT = hIn.values[i] - cIn.values[i];
        const Q_kW = (dT / Rth) / 1000;
        const flux = Q_kW / A;
        qVals.push(Q_kW);
        fluxVals.push(flux);
      }
      if (isSig) {
        return {
          heatFlow: signal(qVals, times, "kW", c.node.label),
          heatFlux: signal(fluxVals, times, "kW/m²", c.node.label),
          resistance: { type: "number", value: Rth, unit: "K/W" },
        };
      }
      return {
        heatFlow: { type: "number", value: qVals[0], unit: "kW" },
        heatFlux: { type: "number", value: fluxVals[0], unit: "kW/m²" },
        resistance: { type: "number", value: Rth, unit: "K/W" },
      };
    },
  },
  {
    id: "heatConvection",
    title: "Newton convective cooling",
    description: "Convective heat transfer Q = h * A * (Ts - Tinf)",
    category: "Thermodynamics",
    icon: "Wind",
    inputs: [
      port("tSurface", "Surface temp Ts", ["number", "signal"], true),
      port("tFluid", "Fluid temp Tinf", ["number", "signal"], true),
    ],
    outputs: [
      port("heatFlow", "Convective heat Q", ["number", "signal"]),
      port("heatFlux", "Heat flux q''", ["number", "signal"]),
      port("htc", "Heat transfer coeff h", ["number"]),
    ],
    fields: [
      sel("regime", "Convection regime", "Specified h", [
        "Specified h",
        "Forced air flow",
        "Forced water flow",
      ]),
      num("h", "Convective coeff h", 25, 0.1, 50000, "W/(m²·K)", 5),
      num("velocity", "Flow velocity", 5.0, 0.1, 100, "m/s", 0.5),
      num("area", "Wetted area A", 5.0, 0.01, 10000, "m²", 0.5),
      num("fallbackSurface", "Fallback Ts", 85, -100, 3000, "°C", 5),
      num("fallbackFluid", "Fallback Tinf", 20, -100, 3000, "°C", 5),
    ],
    help: "Computes convective heat transfer dissipation from surface to surrounding fluid using Newton's cooling law.",
    evaluate: (c) => {
      const sIn = unpack(c, "tSurface", n(c, "fallbackSurface"), "°C");
      const fIn = unpack(c, "tFluid", n(c, "fallbackFluid"), "°C");
      const isSig = sIn.isSignal || fIn.isSignal;
      const times = sIn.isSignal ? sIn.times : fIn.times;
      let h = n(c, "h");
      const v = Math.max(0.1, n(c, "velocity"));
      if (s(c, "regime") === "Forced air flow") {
        h = 10.45 - v + 10 * Math.sqrt(v);
      } else if (s(c, "regime") === "Forced water flow") {
        h = 1200 * Math.pow(v, 0.8);
      }
      const A = Math.max(0.01, n(c, "area"));
      const qVals: number[] = [];
      const fluxVals: number[] = [];
      for (let i = 0; i < times.length; i++) {
        const dT = sIn.values[i] - fIn.values[i];
        const Q_kW = (h * A * dT) / 1000;
        const flux = (h * dT) / 1000;
        qVals.push(Q_kW);
        fluxVals.push(flux);
      }
      if (isSig) {
        return {
          heatFlow: signal(qVals, times, "kW", c.node.label),
          heatFlux: signal(fluxVals, times, "kW/m²", c.node.label),
          htc: { type: "number", value: h, unit: "W/(m²·K)" },
        };
      }
      return {
        heatFlow: { type: "number", value: qVals[0], unit: "kW" },
        heatFlux: { type: "number", value: fluxVals[0], unit: "kW/m²" },
        htc: { type: "number", value: h, unit: "W/(m²·K)" },
      };
    },
  },
  {
    id: "dropletEvaporation",
    title: "Droplet evaporative cooling",
    description: "d²-law spray droplet evaporation and latent heat absorption",
    category: "Thermodynamics",
    icon: "Droplets",
    inputs: [
      port("gasTemp", "Surrounding gas temp", ["number", "signal"], true),
      port("sprayFlow", "Liquid spray flow", ["number", "signal"], true),
    ],
    outputs: [
      port("coolingPower", "Evaporative cooling power", ["number", "signal"]),
      port("evapRate", "Evaporation mass rate", ["number", "signal"]),
      port("lifetime", "Droplet lifetime tau", ["number", "signal"]),
    ],
    fields: [
      num("d0", "Initial droplet diameter D0", 80, 5, 2000, "µm", 5),
      num("hfg", "Latent heat of vaporization", 2260, 100, 5000, "kJ/kg", 20),
      num("evapConstant", "Base evap constant K", 0.15, 0.001, 5, "mm²/s", 0.01),
      num("fallbackGasT", "Fallback gas temp", 250, 0, 3000, "°C", 10),
      num("fallbackFlow", "Fallback spray flow", 20, 0.1, 500, "L/min", 1),
    ],
    help: "Computes droplet evaporation via the classical d^2 law: D(t)^2 = D0^2 - K*t, total droplet lifetime, and latent heat cooling sink power in kW.",
    evaluate: (c) => {
      const gIn = unpack(c, "gasTemp", n(c, "fallbackGasT"), "°C");
      const qIn = unpack(c, "sprayFlow", n(c, "fallbackFlow"), "L/min");
      const isSig = gIn.isSignal || qIn.isSignal;
      const times = gIn.isSignal ? gIn.times : qIn.times;
      const D0_mm = n(c, "d0") * 1e-3;
      const hfg = n(c, "hfg");
      const coolVals: number[] = [];
      const evapVals: number[] = [];
      const lifeVals: number[] = [];
      for (let i = 0; i < times.length; i++) {
        const Tg = gIn.values[i];
        const theta = 1 + Math.max(0, Tg - 100) / 150;
        const K = n(c, "evapConstant") * theta;
        const tau = (D0_mm * D0_mm) / Math.max(1e-6, K);
        const mSpray = Math.max(0, qIn.values[i]) / 60;
        const fEvap = Math.min(0.98, 0.8 / Math.max(0.01, tau));
        const mEvap = mSpray * fEvap;
        const cooling = mEvap * hfg;
        coolVals.push(cooling);
        evapVals.push(mEvap);
        lifeVals.push(tau);
      }
      if (isSig) {
        return {
          coolingPower: signal(coolVals, times, "kW", c.node.label),
          evapRate: signal(evapVals, times, "kg/s", c.node.label),
          lifetime: signal(lifeVals, times, "s", c.node.label),
        };
      }
      return {
        coolingPower: { type: "number", value: coolVals[0], unit: "kW" },
        evapRate: { type: "number", value: evapVals[0], unit: "kg/s" },
        lifetime: { type: "number", value: lifeVals[0], unit: "s" },
      };
    },
  },
  {
    id: "beamDeflection",
    title: "Euler-Bernoulli beam mechanics",
    description: "Flexural deflection, bending stress, and yield safety factor",
    category: "Structural Dynamics",
    icon: "Move3D",
    inputs: [
      port("load", "Applied load F", ["number", "signal"], true),
    ],
    outputs: [
      port("deflection", "Max deflection delta", ["number", "signal"]),
      port("stress", "Max bending stress sigma", ["number", "signal"]),
      port("safetyFactor", "Safety factor SF", ["number", "signal"]),
    ],
    fields: [
      sel("support", "Support boundary", "Cantilever (Fixed-Free)", [
        "Cantilever (Fixed-Free)",
        "Simply Supported",
        "Fixed-Fixed",
      ]),
      num("length", "Span length L", 6.0, 0.1, 100, "m", 0.5),
      num("width", "Beam width b", 0.3, 0.01, 10, "m", 0.05),
      num("height", "Beam depth h", 0.5, 0.01, 10, "m", 0.05),
      num("eModulus", "Elastic modulus E", 30, 0.1, 1000, "GPa", 1),
      num("yieldStrength", "Yield strength sigma_y", 35, 1, 3000, "MPa", 5),
      num("fallbackLoad", "Fallback load F", 25, 0, 100000, "kN", 5),
    ],
    help: "Calculates elastic flexural deflection, maximum bending stress sigma = M / S, and structural yield safety factor.",
    evaluate: (c) => {
      const fIn = unpack(c, "load", n(c, "fallbackLoad"), "kN");
      const L = Math.max(0.1, n(c, "length"));
      const b = Math.max(0.01, n(c, "width"));
      const h = Math.max(0.01, n(c, "height"));
      const I = (b * h * h * h) / 12;
      const S = (b * h * h) / 6;
      const E = n(c, "eModulus") * 1e9;
      const sigY = n(c, "yieldStrength");
      const support = s(c, "support");
      const defVals: number[] = [];
      const strVals: number[] = [];
      const sfVals: number[] = [];
      for (let i = 0; i < fIn.times.length; i++) {
        const F = Math.abs(fIn.values[i]) * 1000;
        let delta = 0;
        let M = 0;
        if (support === "Cantilever (Fixed-Free)") {
          delta = (F * L * L * L) / (3 * E * I);
          M = F * L;
        } else if (support === "Simply Supported") {
          delta = (F * L * L * L) / (48 * E * I);
          M = (F * L) / 4;
        } else {
          delta = (F * L * L * L) / (192 * E * I);
          M = (F * L) / 8;
        }
        const stress = (M / S) / 1e6;
        const sf = sigY / Math.max(0.001, stress);
        defVals.push(delta * 1000);
        strVals.push(stress);
        sfVals.push(sf);
      }
      if (fIn.isSignal) {
        return {
          deflection: signal(defVals, fIn.times, "mm", c.node.label),
          stress: signal(strVals, fIn.times, "MPa", c.node.label),
          safetyFactor: signal(sfVals, fIn.times, "", c.node.label),
        };
      }
      return {
        deflection: { type: "number", value: defVals[0], unit: "mm" },
        stress: { type: "number", value: strVals[0], unit: "MPa" },
        safetyFactor: { type: "number", value: sfVals[0], unit: "" },
      };
    },
  },
  {
    id: "sdofVibration",
    title: "SDOF structural oscillator",
    description: "Numerical dynamic response: displacement, velocity & acceleration",
    category: "Structural Dynamics",
    icon: "Activity",
    inputs: [
      port("force", "Excitation force F(t)", ["signal"]),
    ],
    outputs: [
      port("displacement", "Displacement x(t)", ["signal"]),
      port("velocity", "Velocity v(t)", ["signal"]),
      port("acceleration", "Acceleration a(t)", ["signal"]),
    ],
    fields: [
      num("mass", "Oscillator mass m", 2500, 1, 10000000, "kg", 100),
      num("stiffness", "Stiffness k", 400, 0.1, 1000000, "kN/m", 10),
      num("dampingRatio", "Damping ratio zeta", 5.0, 0, 100, "%", 0.5),
      num("x0", "Initial displacement x0", 0, -1000, 1000, "mm", 1),
      num("v0", "Initial velocity v0", 0, -100, 100, "m/s", 0.1),
    ],
    help: "Solves m * x'' + c * x' + k * x = F(t) using time-marching numerical integration for arbitrary dynamic force inputs.",
    evaluate: (c) => {
      const fIn = series(c.inputs.force);
      const m = Math.max(1, n(c, "mass"));
      const k = Math.max(1, n(c, "stiffness") * 1000);
      const c_crit = 2 * Math.sqrt(k * m);
      const cd = (n(c, "dampingRatio") / 100) * c_crit;
      const scale = fIn.unit === "kN" ? 1000 : 1;
      let x = n(c, "x0") * 1e-3;
      let v = n(c, "v0");
      let a = fIn.times.length > 0 ? (fIn.values[0] * scale - cd * v - k * x) / m : 0;
      const xVals: number[] = [];
      const vVals: number[] = [];
      const aVals: number[] = [];
      for (let i = 0; i < fIn.times.length; i++) {
        xVals.push(x * 1000);
        vVals.push(v);
        aVals.push(a);
        if (i < fIn.times.length - 1) {
          const dt = Math.max(1e-9, fIn.times[i + 1] - fIn.times[i]);
          const a0 = 1 / (0.25 * dt * dt);
          const a1 = 0.5 / (0.25 * dt);
          const a2 = 1 / (0.25 * dt);
          const keff = k + a0 * m + a1 * cd;
          const Fnext = fIn.values[i + 1] * scale;
          const feff = Fnext + m * (a0 * x + a2 * v + a) + cd * (a1 * x + v);
          const xNext = feff / keff;
          const aNext = a0 * (xNext - x) - a2 * v - a;
          const vNext = v + 0.5 * dt * (a + aNext);
          x = xNext;
          v = vNext;
          a = aNext;
        }
      }
      return {
        displacement: signal(xVals, fIn.times, "mm", c.node.label),
        velocity: signal(vVals, fIn.times, "m/s", c.node.label),
        acceleration: signal(aVals, fIn.times, "m/s²", c.node.label),
      };
    },
  },
  {
    id: "viscoelasticDamper",
    title: "Viscoelastic damper & TMD",
    description: "Dashpot force Fd(t) and energy dissipation Ed(t)",
    category: "Structural Dynamics",
    icon: "Sliders",
    inputs: [
      port("displacement", "Displacement x(t)", ["signal"]),
    ],
    outputs: [
      port("dampingForce", "Damper force Fd(t)", ["signal"]),
      port("energyDissipated", "Dissipated energy Ed(t)", ["signal"]),
      port("effectiveC", "Effective damping ceq", ["number"]),
    ],
    fields: [
      sel("model", "Damper constitutive law", "Viscous dashpot (Linear)", [
        "Viscous dashpot (Linear)",
        "Viscoelastic (Kelvin-Voigt)",
        "Nonlinear fluid (alpha=0.3)",
      ]),
      num("c", "Damping coefficient c", 15.0, 0.01, 10000, "kN·s/m", 1),
      num("k", "Stiffness k", 50.0, 0, 100000, "kN/m", 5),
    ],
    help: "Computes damper reaction force and cumulative energy dissipation Ed = integral(Fd * dx) across dynamic vibration cycles.",
    evaluate: (c) => {
      const dIn = series(c.inputs.displacement);
      const cCoeff = n(c, "c");
      const kCoeff = n(c, "k");
      const scale = dIn.unit === "mm" ? 1e-3 : 1;
      const model = s(c, "model");
      const fVals: number[] = [];
      const edVals: number[] = [];
      let totalEd = 0;
      for (let i = 0; i < dIn.times.length; i++) {
        const x_m = dIn.values[i] * scale;
        let v_ms = 0;
        if (i === 0 && dIn.times.length > 1) {
          v_ms = ((dIn.values[1] - dIn.values[0]) * scale) / (dIn.times[1] - dIn.times[0]);
        } else if (i === dIn.times.length - 1 && dIn.times.length > 1) {
          v_ms = ((dIn.values[i] - dIn.values[i - 1]) * scale) / (dIn.times[i] - dIn.times[i - 1]);
        } else if (dIn.times.length > 2) {
          v_ms = ((dIn.values[i + 1] - dIn.values[i - 1]) * scale) / (dIn.times[i + 1] - dIn.times[i - 1]);
        }
        let Fd = 0;
        if (model === "Viscous dashpot (Linear)") {
          Fd = cCoeff * v_ms;
        } else if (model === "Viscoelastic (Kelvin-Voigt)") {
          Fd = cCoeff * v_ms + kCoeff * x_m;
        } else {
          Fd = cCoeff * Math.pow(Math.abs(v_ms), 0.3) * Math.sign(v_ms);
        }
        if (i > 0) {
          const dx = (dIn.values[i] - dIn.values[i - 1]) * scale;
          totalEd += Math.max(0, Fd * dx);
        }
        fVals.push(Fd);
        edVals.push(totalEd);
      }
      return {
        dampingForce: signal(fVals, dIn.times, "kN", c.node.label),
        energyDissipated: signal(edVals, dIn.times, "kJ", c.node.label),
        effectiveC: { type: "number", value: cCoeff, unit: "kN·s/m" },
      };
    },
  },
  {
    id: "fftSpectrum",
    title: "FFT frequency spectrum",
    description: "Discrete Fourier Transform, modal peaks & spectral power",
    category: "Signal & Math",
    icon: "ChartNoAxesCombined",
    inputs: [
      port("signal", "Time signal", ["signal"]),
    ],
    outputs: [
      port("spectrum", "Magnitude spectrum", ["signal"]),
      port("dominantFreq", "Peak resonance freq", ["number"]),
      port("peakAmp", "Peak amplitude", ["number"]),
    ],
    fields: [
      sel("window", "Window function", "Hann", ["Hann", "Hamming", "Rectangular (None)"]),
      num("maxFreq", "Max frequency display", 100, 1, 10000, "Hz", 5),
    ],
    help: "Computes single-sided DFT magnitude spectrum |X(f)|, peak resonance frequency, and spectral distribution.",
    evaluate: (c) => {
      const sIn = series(c.inputs.signal);
      const N = sIn.values.length;
      if (N < 2) throw Error("Need at least 2 samples for FFT");
      const totalT = sIn.times[N - 1] - sIn.times[0];
      const fs = (N - 1) / Math.max(1e-6, totalT);
      const windowType = s(c, "window");
      const w: number[] = [];
      for (let nIdx = 0; nIdx < N; nIdx++) {
        if (windowType === "Hann") {
          w.push(0.5 * (1 - Math.cos((2 * Math.PI * nIdx) / (N - 1))));
        } else if (windowType === "Hamming") {
          w.push(0.54 - 0.46 * Math.cos((2 * Math.PI * nIdx) / (N - 1)));
        } else {
          w.push(1);
        }
      }
      const maxK = Math.min(Math.floor(N / 2), Math.floor((n(c, "maxFreq") * N) / fs));
      const freqs: number[] = [];
      const mags: number[] = [];
      let maxMag = -1;
      let domF = 0;
      for (let k = 0; k <= maxK; k++) {
        const freq = (k * fs) / N;
        let real = 0;
        let imag = 0;
        for (let nIdx = 0; nIdx < N; nIdx++) {
          const angle = (2 * Math.PI * k * nIdx) / N;
          const val = sIn.values[nIdx] * w[nIdx];
          real += val * Math.cos(angle);
          imag -= val * Math.sin(angle);
        }
        const mag = (2 * Math.sqrt(real * real + imag * imag)) / N;
        freqs.push(freq);
        mags.push(mag);
        if (k > 0 && mag > maxMag) {
          maxMag = mag;
          domF = freq;
        }
      }
      return {
        spectrum: signal(mags, freqs, sIn.unit, c.node.label),
        dominantFreq: { type: "number", value: domF, unit: "Hz" },
        peakAmp: { type: "number", value: Math.max(0, maxMag), unit: sIn.unit },
      };
    },
  },
  {
    id: "integrator",
    title: "Cumulative integrator",
    description: "Trapezoidal time integration (e.g. pressure → blast impulse)",
    category: "Signal & Math",
    icon: "Sigma",
    inputs: [
      port("signal", "Input signal", ["signal"]),
    ],
    outputs: [
      port("integrated", "Integrated signal", ["signal"]),
      port("totalIntegral", "Total integral", ["number"]),
    ],
    fields: [
      num("initialValue", "Initial condition y0", 0),
      txt("unit", "Output unit", "Pa·s"),
    ],
    help: "Performs cumulative trapezoidal time integration: y(t) = y0 + integral(x(tau) dtau). Useful for calculating blast impulse or velocity from acceleration.",
    evaluate: (c) => {
      const sIn = series(c.inputs.signal);
      const outUnit = s(c, "unit");
      const yVals: number[] = [n(c, "initialValue")];
      for (let i = 1; i < sIn.times.length; i++) {
        const dt = sIn.times[i] - sIn.times[i - 1];
        const step = 0.5 * (sIn.values[i] + sIn.values[i - 1]) * dt;
        yVals.push(yVals[i - 1] + step);
      }
      const total = yVals[yVals.length - 1];
      return {
        integrated: signal(yVals, sIn.times, outUnit, c.node.label),
        totalIntegral: { type: "number", value: total, unit: outUnit },
      };
    },
  },
  {
    id: "differentiator",
    title: "Numerical differentiator",
    description: "Central difference rate of change dy/dt (e.g. dP/dt rate)",
    category: "Signal & Math",
    icon: "Activity",
    inputs: [
      port("signal", "Input signal", ["signal"]),
    ],
    outputs: [
      port("derivative", "Derivative dy/dt", ["signal"]),
      port("maxRate", "Max absolute rate", ["number"]),
    ],
    fields: [
      sel("smoothing", "Smoothing window", "None", ["None", "3-point average", "5-point average"]),
      txt("unit", "Output unit", "Pa/s"),
    ],
    help: "Computes the numerical derivative dy/dt. In explosion studies, max dP/dt defines the deflagration explosion severity index.",
    evaluate: (c) => {
      const sIn = series(c.inputs.signal);
      const N = sIn.times.length;
      if (N < 2) throw Error("Need at least 2 samples to differentiate");
      const raw: number[] = [];
      for (let i = 0; i < N; i++) {
        if (i === 0) {
          raw.push((sIn.values[1] - sIn.values[0]) / Math.max(1e-9, sIn.times[1] - sIn.times[0]));
        } else if (i === N - 1) {
          raw.push((sIn.values[N - 1] - sIn.values[N - 2]) / Math.max(1e-9, sIn.times[N - 1] - sIn.times[N - 2]));
        } else {
          raw.push((sIn.values[i + 1] - sIn.values[i - 1]) / Math.max(1e-9, sIn.times[i + 1] - sIn.times[i - 1]));
        }
      }
      const smooth = s(c, "smoothing");
      const dVals: number[] = [];
      const win = smooth === "5-point average" ? 2 : smooth === "3-point average" ? 1 : 0;
      for (let i = 0; i < N; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - win); j <= Math.min(N - 1, i + win); j++) {
          sum += raw[j];
          count++;
        }
        dVals.push(sum / count);
      }
      const maxR = Math.max(...dVals.map(Math.abs));
      return {
        derivative: signal(dVals, sIn.times, s(c, "unit"), c.node.label),
        maxRate: { type: "number", value: maxR, unit: s(c, "unit") },
      };
    },
  },
  {
    id: "pidController",
    title: "Discrete PID controller",
    description: "Closed-loop feedback controller with anti-windup clamping",
    category: "Signal & Math",
    icon: "Sliders",
    inputs: [
      port("measurement", "Measurement y(t)", ["signal"]),
      port("setpoint", "Setpoint r(t)", ["number", "signal"], true),
    ],
    outputs: [
      port("control", "Control signal u(t)", ["signal"]),
      port("error", "Tracking error e(t)", ["signal"]),
    ],
    fields: [
      num("kp", "Proportional gain Kp", 1.2, 0, 1000, "", 0.1),
      num("ki", "Integral gain Ki", 0.5, 0, 1000, "1/s", 0.05),
      num("kd", "Derivative gain Kd", 0.05, 0, 1000, "s", 0.01),
      num("fallbackSetpoint", "Fallback setpoint", 50.0),
      num("outMin", "Output clamp min", 0),
      num("outMax", "Output clamp max", 100),
      txt("unit", "Output unit", "%"),
    ],
    help: "Computes discrete PID control u(t) = Kp*e + Ki*integral(e) + Kd*de/dt with output saturation clamping and integrator anti-windup.",
    evaluate: (c) => {
      const yIn = series(c.inputs.measurement);
      const rIn = unpack(c, "setpoint", n(c, "fallbackSetpoint"));
      const kp = n(c, "kp");
      const ki = n(c, "ki");
      const kd = n(c, "kd");
      const uMin = n(c, "outMin");
      const uMax = n(c, "outMax");
      const uVals: number[] = [];
      const eVals: number[] = [];
      let integral = 0;
      let prevE = 0;
      for (let i = 0; i < yIn.times.length; i++) {
        const rVal = rIn.values[i];
        const yVal = yIn.values[i];
        const e = rVal - yVal;
        eVals.push(e);
        let dt = i > 0 ? yIn.times[i] - yIn.times[i - 1] : 0.01;
        if (dt <= 0) dt = 0.01;
        integral += e * dt;
        integral = Math.max(uMin, Math.min(uMax, integral));
        const deriv = i > 0 ? (e - prevE) / dt : 0;
        prevE = e;
        const uRaw = kp * e + ki * integral + kd * deriv;
        const uClamped = Math.max(uMin, Math.min(uMax, uRaw));
        uVals.push(uClamped);
      }
      return {
        control: signal(uVals, yIn.times, s(c, "unit"), c.node.label),
        error: signal(eVals, yIn.times, yIn.unit, c.node.label),
      };
    },
  },
  {
    id: "bandpassFilter",
    title: "Bandpass resonator filter",
    description: "Biquad resonator filter isolating resonance frequency f0",
    category: "Signal & Math",
    icon: "Waves",
    inputs: [
      port("signal", "Input signal", ["signal"]),
    ],
    outputs: [
      port("filtered", "Bandpass filtered", ["signal"]),
    ],
    fields: [
      num("centerFreq", "Center frequency f0", 12.0, 0.1, 500, "Hz", 0.5),
      num("q", "Quality factor Q", 5.0, 0.5, 50, "", 0.5),
    ],
    help: "Second-order digital biquad bandpass filter isolating a specific structural modal frequency or harmonic band around center frequency f0.",
    evaluate: (c) => {
      const sIn = series(c.inputs.signal);
      const N = sIn.times.length;
      if (N < 3) return { filtered: signal(sIn.values, sIn.times, sIn.unit, c.node.label) };
      const fs = (N - 1) / Math.max(1e-6, sIn.times[N - 1] - sIn.times[0]);
      const f0 = Math.min(fs * 0.45, Math.max(0.1, n(c, "centerFreq")));
      const Q = Math.max(0.1, n(c, "q"));
      const w0 = (2 * Math.PI * f0) / fs;
      const alpha = Math.sin(w0) / (2 * Q);
      const b0 = alpha;
      const b1 = 0;
      const b2 = -alpha;
      const a0 = 1 + alpha;
      const a1 = -2 * Math.cos(w0);
      const a2 = 1 - alpha;
      const yVals: number[] = [];
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < N; i++) {
        const x0 = sIn.values[i];
        const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
        yVals.push(y0);
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
      }
      return {
        filtered: signal(yVals, sIn.times, sIn.unit, c.node.label),
      };
    },
  },
];
for (const d of definitions) {
  d.title = L(d.title);
  d.description = L(d.description);
  d.help = L(d.help);
  for (const f of d.fields) {
    f.label = L(f.label);
    if (f.help) f.help = L(f.help);
  }
  for (const p of [...d.inputs, ...d.outputs]) p.label = L(p.label);
}
export const registry: Record<string, NodeDefinition> = Object.fromEntries(
  definitions.map((d) => [d.id, d]),
);
export function getDefinition(
  kind: string,
  tools: CustomTool[] = [],
): NodeDefinition | undefined {
  if (Object.hasOwn(registry, kind)) return registry[kind];
  const custom = tools.find((t) => t.id === kind);
  return custom
    ? {
        ...registry.formula,
        id: custom.id,
        title: custom.label,
        description: "მრავალჯერადი ფორმულა · " + custom.expression,
        fields: registry.formula.fields.map((f) => ({
          ...f,
          default:
            f.key === "expression"
              ? custom.expression
              : f.key === "unit"
                ? custom.unit
                : f.default,
        })),
      }
    : undefined;
}
export function defaultParams(kind: string, tools: CustomTool[] = []) {
  const d = getDefinition(kind, tools);
  if (!d) throw Error("Unknown node type");
  const p = Object.fromEntries(d.fields.map((f) => [f.key, f.default]));
  return kind.startsWith("scene")
    ? { ...sceneDefaults(kind === "scene3d" ? 3 : 2), ...p }
    : p;
}

export const sensorOutputId = (id: string) => "sensor:" + id;
export function attachedSensors(project: Project, sceneId: string): LabNode[] {
  return project.edges
    .filter((e) => e.target === sceneId && e.targetHandle === "sensors")
    .map((e) => project.nodes.find((n) => n.id === e.source))
    .filter(
      (n): n is LabNode =>
        !!n && getDefinition(n.kind, project.tools)?.category === "Sensors",
    );
}
export function nodeDefinition(
  node: LabNode,
  project: Project,
): NodeDefinition | undefined {
  const base = getDefinition(node.kind, project.tools);
  if (!base || base.category !== "Scenes") return base;
  return {
    ...base,
    outputs: [
      ...base.outputs,
      ...attachedSensors(project, node.id).map((sensor) => ({
        id: sensorOutputId(sensor.id),
        label: sensor.label + " · " + sensorUnits[sensor.kind],
        types: ["signal"] as DataType[],
      })),
    ],
  };
}
export function pruneSceneConnections(project: Project): Project {
  const edges = project.edges.filter((e) => {
    const source = project.nodes.find((n) => n.id === e.source),
      target = project.nodes.find((n) => n.id === e.target);
    return (
      source &&
      target &&
      nodeDefinition(source, project)?.outputs.some(
        (p) => p.id === e.sourceHandle,
      ) &&
      nodeDefinition(target, project)?.inputs.some(
        (p) => p.id === e.targetHandle,
      )
    );
  });
  return edges.length === project.edges.length
    ? project
    : { ...project, edges };
}

export function attachedEvents(project: Project, sceneId: string): LabNode[] {
  return project.edges
    .filter((e) => e.target === sceneId && e.targetHandle === "events")
    .map((e) => project.nodes.find((n) => n.id === e.source))
    .filter(
      (n): n is LabNode =>
        !!n &&
        getDefinition(n.kind, project.tools)?.category === "Scene events",
    );
}
