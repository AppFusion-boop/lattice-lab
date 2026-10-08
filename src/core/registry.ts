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
];
const formulaEval = (c: EvalContext) => {
  const fn = compileExpression(s(c, "expression"));
  const a = c.inputs.a,
    b = c.inputs.b;
  const aa = a?.type === "signal" ? a.value : null,
    bb = b?.type === "signal" ? b.value : null;
  if (aa && bb) aligned(aa, bb);
  const times = aa?.times || bb?.times;
  if (times)
    return {
      result: signal(
        times.map((t, i) =>
          fn({
            a: aa ? aa.values[i] : a?.type === "number" ? a.value : n(c, "a"),
            b: bb ? bb.values[i] : b?.type === "number" ? b.value : n(c, "b"),
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
        a: a?.type === "number" ? a.value : n(c, "a"),
        b: b?.type === "number" ? b.value : n(c, "b"),
        t: 0,
      }),
      unit: s(c, "unit"),
    } as Packet,
  };
};
export const definitions: NodeDefinition[] = [
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
    inputs: [],
    outputs: [port("scene", "Environment", ["scene"])],
    fields: [
      num("width", "Width", 20, 2, 100, "m"),
      num("depth", "Depth", 12, 2, 100, "m"),
      num("height", "Height", 8, 2, 50, "m"),
      num("temperature", "Ambient temperature", 22, -100, 500, "°C"),
      num("light", "Illuminance", 500, 0, 100000, "lx"),
      num("amplitude", "Source amplitude", 1000, 0, 100000, "Pa"),
      num("frequency", "Source frequency", 8, 0.1, 500, "Hz"),
    ],
    help: "Scene geometry and analytical sensor fields are separate. Meshes are visual geometry; no collision, fluid, combustion or heat solver is implied.",
    evaluate: (c: EvalContext) => ({
      scene: {
        type: "scene",
        value: { ...sceneDefaults(d as 2 | 3), ...c.params, dimension: d },
      } as Packet,
    }),
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
  ].map((spec) => ({
    id: spec.id,
    title: spec.title,
    description: spec.description,
    category: "Sensors",
    icon: spec.icon,
    inputs: [
      port("scene", "Scene", ["scene"]),
      port("position", "Position", ["vector3"], true),
      port("trigger", "Start", ["event"], true),
    ],
    outputs: [port("signal", "Reading", ["signal"])],
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
    help: "Ideal synthetic sensor, not a hardware driver. Position samples an analytical field. Sensitivity, bias and first-order response are applied. Visual obstacles do not alter this field.",
    evaluate: (c: EvalContext) => {
      const p = c.inputs.scene;
      if (p?.type !== "scene") throw Error("Connect a scene");
      const env = p.value;
      const vec = c.inputs.position;
      if (vec?.type === "vector3" && vec.unit !== "m")
        throw Error("Position vector must use meters");
      const pos =
        vec?.type === "vector3"
          ? vec.value
          : { x: n(c, "x"), y: n(c, "y"), z: n(c, "z") };
      if (
        pos.x < 0 ||
        pos.x > env.width ||
        pos.z < 0 ||
        pos.z > env.depth ||
        pos.y < 0 ||
        pos.y > env.height
      )
        throw Error("Sensor position is outside the scene");
      const start =
        c.inputs.trigger?.type === "event"
          ? (c.inputs.trigger.value[0] ?? Infinity)
          : 0;
      const sources = env.objects.filter((o) => o.shape === "source");
      if (
        ["pressure", "microphone", "accelerometer"].includes(spec.id) &&
        Math.max(
          env.frequency,
          spec.id === "accelerometer" ? n(c, "frequency") : 0,
        ) >=
          c.sampleRate / 2
      )
        throw Error("Source frequency exceeds the sample-rate limit");
      let previous: number | undefined;
      const values = c.times.map((t, i) => {
        let value = 0;
        if (t >= start) {
          const tt = t - start;
          if (spec.id === "temperature")
            value =
              env.temperature +
              0.05 * pos.x +
              0.5 * Math.sin(2 * Math.PI * 0.2 * tt);
          else if (spec.id === "light")
            value = env.light / (1 + 0.03 * pos.x * pos.x);
          else if (spec.id === "accelerometer")
            value =
              n(c, "amplitude") *
              Math.exp(-tt) *
              Math.sin(2 * Math.PI * n(c, "frequency") * tt);
          else
            for (const source of sources) {
              const distance = Math.hypot(
                pos.x - source.position.x,
                env.dimension === 3 ? pos.y - source.position.y : 0,
                pos.z - source.position.z,
              );
              const delay = tt - distance / 343;
              if (delay >= 0)
                value +=
                  (env.amplitude / (1 + distance)) *
                  (spec.id === "microphone"
                    ? Math.sin(2 * Math.PI * env.frequency * delay)
                    : Math.exp(-Math.pow((delay - 0.05) / 0.015, 2)) -
                      0.2 * Math.exp(-Math.pow((delay - 0.1) / 0.035, 2)));
            }
        }
        value = value * n(c, "sensitivity") + n(c, "bias");
        const alpha =
          n(c, "tau") <= 0 ? 1 : 1 - Math.exp(-1 / c.sampleRate / n(c, "tau"));
        previous =
          previous === undefined
            ? value
            : previous + alpha * (value - previous);
        return previous;
      });
      return { signal: signal(values, c.times, spec.unit, c.node.label) };
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
    help: "Variables a, b and t (seconds); pi and e. Scalar inputs broadcast over signals. Supports arithmetic, comparisons, logical operators, trigonometry, min/max, clamp and if. Output units are explicitly declared, not inferred.",
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
];
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
        description: "Reusable formula · " + custom.expression,
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
