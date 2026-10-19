import { applySceneEvents, type Measurement } from "./scene-events.ts";
import type { EvalContext, Packet } from "./types.ts";
export const sensorUnits: Record<string, string> = {
  pressure: "Pa",
  temperature: "°C",
  accelerometer: "m/s²",
  microphone: "Pa",
  light: "lx",
  gasSensor: "ppm",
  heatFluxSensor: "kW/m²",
  blastImpulseSensor: "Pa·s",
};
const n = (c: EvalContext, k: string) => Number(c.params[k]);
const signal = (
  values: number[],
  times: number[],
  unit: string,
  name: string,
): Packet => ({ type: "signal", value: { values, times, unit, name } });
export function sampleSensor(c: EvalContext): Packet {
  const spec = { id: c.node.kind, unit: sensorUnits[c.node.kind] };
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
  const explicit = !!env.events?.length;
  const sources = (explicit ? [] : env.objects).filter(
    (o) => o.shape === "source",
  );
  if (
    !explicit &&
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
        value = explicit
          ? env.temperature
          : env.temperature +
            0.05 * pos.x +
            0.5 * Math.sin(2 * Math.PI * 0.2 * tt);
      else if (spec.id === "light")
        value = explicit ? env.light : env.light / (1 + 0.03 * pos.x * pos.x);
      else if (spec.id === "accelerometer" && !explicit)
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
    if (t >= start && env.events?.length) {
      const channels: Record<string, Measurement> = {
        pressure: "pressure",
        microphone: "pressure",
        temperature: "temperature",
        light: "light",
        accelerometer: "acceleration",
        gasSensor: "gasConcentration",
        heatFluxSensor: "heatFlux",
        blastImpulseSensor: "pressure",
      };
      value = applySceneEvents(
        value,
        env.events,
        channels[spec.id],
        pos,
        t,
        env.dimension,
      );
    }
    value = value * n(c, "sensitivity") + n(c, "bias");
    const alpha =
      n(c, "tau") <= 0 ? 1 : 1 - Math.exp(-1 / c.sampleRate / n(c, "tau"));
    previous =
      previous === undefined ? value : previous + alpha * (value - previous);
    return previous;
  });
  if (spec.id === "blastImpulseSensor") {
    const integrated = new Array<number>(values.length).fill(0);
    for (let i = 1; i < values.length; i++) {
      const dt = Math.max(0, c.times[i] - c.times[i - 1]);
      const p0 = Math.max(0, values[i - 1]);
      const p1 = Math.max(0, values[i]);
      integrated[i] = integrated[i - 1] + 0.5 * (p0 + p1) * dt;
    }
    return signal(integrated, c.times, spec.unit, c.node.label);
  }
  return signal(values, c.times, spec.unit, c.node.label);
}
