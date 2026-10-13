import { L } from "./ka.ts";
import type {
  Config,
  Field,
  SceneData,
  SceneEventConfig,
  Vec3,
  LabNode,
} from "./types.ts";
export type Measurement = "pressure" | "temperature" | "light" | "acceleration";
type EffectContext = {
  params: Config;
  age: number;
  distance: number;
  channel: Measurement;
};
export type SceneEventDefinition = {
  id: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  fields: Field[];
  channels: Measurement[];
  mode: "add" | "multiply";
  visual?: "wave" | "fire" | "mist" | "heat" | "light" | "vibration" | "zone";
  channelModes?: Partial<Record<Measurement, "add" | "multiply">>;
  tailTime?: (params: Config) => number;
  front?: (params: Config, age: number) => number;
  validate?: (params: Config, sampleRate: number) => void;
  effect: (context: EffectContext) => number;
  help: string;
};
const num = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  unit: string,
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
export const spatialFields: Field[] = [
  num("x", "Position X", 5, 0, 100, "m"),
  num("y", "Position Y", 1, 0, 50, "m"),
  num("z", "Position Z", 6, 0, 100, "m"),
  num("radius", "Effect radius", 12, 0.1, 150, "m"),
  {
    key: "falloff",
    label: "Spatial falloff",
    kind: "select",
    default: "Linear",
    options: ["Uniform", "Linear", "Inverse square"],
  },
];
export const scheduleFields: Field[] = [
  {
    key: "enabled",
    label: "Enabled",
    kind: "select",
    default: "On",
    options: ["On", "Off"],
  },
  num("start", "Start / trigger offset", 0.2, 0, 60, "s", 0.01),
  num("duration", "Duration", 0.6, 0.01, 60, "s", 0.01),
];
export const sceneEvents: SceneEventDefinition[] = [
  {
    id: "methaneExplosion",
    title: "მეთანის აფეთქება",
    description: "წნევის იმპულსი, აალება და კვამლი",
    color: "#f28b46",
    icon: "Zap",
    visual: "fire",
    channels: ["pressure"],
    mode: "add",
    tailTime: (p) => Number(p.radius) / Number(p.speed),
    front: (p, t) => Math.min(Number(p.radius), t * Number(p.speed)),
    fields: [
      num("amplitude", "ჭარბი წნევის პიკი", 18000, 0, 100000, "Pa", 100),
      num("speed", "ტალღის სიჩქარე", 343, 1, 2000, "m/s", 1),
      num("width", "იმპულსის სიგანე", 0.035, 0.001, 2, "s", 0.001),
      num("fireSize", "აალების ზომა", 2.5, 0.2, 8, "m"),
      num("smoke", "კვამლის ინტენსივობა", 0.7, 0, 1, "", 0.05),
    ],
    help: "საილუსტრაციო აფეთქება: წნევა წინასწარ განსაზღვრული იმპულსია. მეთანის წვა, გაზის კონცენტრაცია და კედლებიდან არეკვლა არ გამოითვლება.",
    effect: ({ params: p, age, distance }) => {
      const t = age - distance / Number(p.speed),
        w = Number(p.width);
      if (t < 0 || t > Number(p.duration)) return 0;
      return (
        Number(p.amplitude) *
        (Math.exp(-(((t - 3 * w) / w) ** 2)) -
          0.18 * Math.exp(-(((t - 6 * w) / (2 * w)) ** 2)))
      );
    },
  },
  {
    id: "waterMist",
    title: "წყლის გაფრქვევა",
    description: "ჭერის საქშენები, წვეთები და ნისლი",
    color: "#65c8e4",
    icon: "CloudRain",
    visual: "mist",
    channels: ["pressure", "temperature"],
    mode: "multiply",
    channelModes: { temperature: "add" },
    fields: [
      {
        key: "mode",
        label: "გაფრქვევის რეჟიმი",
        kind: "select",
        default: "Mist",
        options: ["Mist", "Spray", "Rain"],
      },
      num("flow", "წყლის ხარჯი", 12, 0.1, 150, "L/min", 0.5),
      num("droplet", "წვეთების დიამეტრი", 80, 10, 1000, "µm", 10),
      num("nozzles", "საქშენების რაოდენობა", 8, 1, 24, "", 1),
      num("angle", "გაშლის კუთხე", 65, 10, 150, "°", 1),
      num("fallSpeed", "წვეთების სიჩქარე", 3, 0.2, 15, "m/s"),
      num("reduction", "წნევის სავარაუდო ჩახშობა", 45, 0, 95, "%", 1),
      num("rise", "შევსების დრო", 0.25, 0.01, 10, "s", 0.01),
      num("cooling", "გაგრილების დაშვება", 4, 0, 40, "°C", 0.5),
    ],
    help: "წყლის ხარჯი, წვეთების ზომა და საქშენები მართავს ვიზუალს. წნევის ჩახშობა და გაგრილება მომხმარებლის დაშვებებია; ეს არ არის ნისლის ან წვის ვალიდირებული მოდელი.",
    effect: ({ params: p, age, channel }) => {
      const fill = Math.min(1, age / Number(p.rise));
      return channel === "temperature"
        ? -Number(p.cooling) * fill
        : (Number(p.reduction) / 100) * fill;
    },
  },
  {
    id: "wavePulse",
    visual: "wave",
    tailTime: (p) => Number(p.radius) / Number(p.speed),
    front: (p, t) => Math.min(Number(p.radius), t * Number(p.speed)),
    title: "Wave pulse",
    description: "A traveling pressure disturbance",
    color: "#ce885a",
    icon: "Waves",
    channels: ["pressure"],
    mode: "add",
    fields: [
      num("amplitude", "Peak amplitude", 1000, 0, 100000, "Pa", 10),
      num("speed", "Propagation speed", 343, 1, 2000, "m/s", 1),
      num("width", "Pulse width", 0.04, 0.001, 10, "s", 0.001),
      num("rarefaction", "Negative tail", 0.2, 0, 1, "ratio", 0.01),
    ],
    help: "An analytical traveling pulse with a negative tail. Radius and falloff control its spatial reach. Geometry does not reflect or block it.",
    effect: ({ params: p, age, distance }) => {
      const t = age - distance / Number(p.speed);
      const w = Number(p.width);
      return t < 0 || t > Number(p.duration)
        ? 0
        : Number(p.amplitude) *
            (Math.exp(-(((t - 3 * w) / w) ** 2)) -
              Number(p.rarefaction) *
                Math.exp(-(((t - 6 * w) / (2 * w)) ** 2)));
    },
  },
  {
    id: "temperatureChange",
    visual: "heat",
    title: "Temperature change",
    description: "Heat or cool a configurable region",
    color: "#c46d79",
    icon: "Thermometer",
    channels: ["temperature"],
    mode: "add",
    fields: [
      num("delta", "Temperature change", 30, -200, 500, "°C", 1),
      num("rise", "Rise time", 0.15, 0.001, 60, "s", 0.01),
      {
        key: "profile",
        label: "Profile",
        kind: "select",
        default: "Ramp",
        options: ["Step", "Ramp", "Smooth pulse"],
      },
    ],
    help: "Adds a prescribed temperature field to ambient temperature. This is not a heat-diffusion solver.",
    effect: ({ params: p, age }) =>
      Number(p.delta) *
      (p.profile === "Step"
        ? 1
        : p.profile === "Smooth pulse"
          ? Math.sin((Math.PI * age) / Number(p.duration)) ** 2
          : Math.min(1, age / Number(p.rise))),
  },
  {
    id: "lightPulse",
    visual: "light",
    title: "Light pulse",
    description: "Illuminate a region for a set time",
    color: "#b29847",
    icon: "Sun",
    channels: ["light"],
    mode: "add",
    fields: [
      num("intensity", "Illuminance", 1500, 0, 100000, "lx", 10),
      {
        key: "profile",
        label: "Envelope",
        kind: "select",
        default: "Smooth pulse",
        options: ["Step", "Smooth pulse"],
      },
    ],
    help: "Adds an ideal illuminance field. Spatial falloff is configurable; objects do not cast shadows.",
    effect: ({ params: p, age }) =>
      Number(p.intensity) *
      (p.profile === "Step"
        ? 1
        : Math.sin((Math.PI * age) / Number(p.duration)) ** 2),
  },
  {
    id: "vibration",
    visual: "vibration",
    validate: (p, rate) => {
      if (Number(p.frequency) >= rate / 2)
        throw Error("Vibration frequency must be below half the sample rate");
    },
    title: "Vibration burst",
    description: "A damped sinusoidal acceleration",
    color: "#8f80b5",
    icon: "Activity",
    channels: ["acceleration"],
    mode: "add",
    fields: [
      num("amplitude", "Acceleration", 4, 0, 100, "m/s²"),
      num("frequency", "Frequency", 12, 0.1, 500, "Hz"),
      num("damping", "Decay rate", 3, 0, 100, "1/s"),
      num("phase", "Phase", 0, -360, 360, "°", 1),
    ],
    help: "A prescribed acceleration burst. Frequency must be below half the workflow sample rate.",
    effect: ({ params: p, age }) =>
      Number(p.amplitude) *
      Math.exp(-Number(p.damping) * age) *
      Math.sin(
        2 * Math.PI * Number(p.frequency) * age +
          (Number(p.phase) * Math.PI) / 180,
      ),
  },
  {
    id: "dampingZone",
    visual: "zone",
    title: "Damping zone",
    description: "Attenuate pressure inside a region",
    color: "#5e9faf",
    icon: "CloudRain",
    channels: ["pressure"],
    mode: "multiply",
    fields: [
      num("reduction", "Local attenuation", 60, 0, 100, "%", 1),
      num("rise", "Activation ramp", 0.1, 0.001, 60, "s", 0.01),
    ],
    help: "A phenomenological local pressure multiplier, useful for comparing assumptions. It does not model water droplets, mist transport or shock-wave mitigation.",
    effect: ({ params: p, age }) =>
      (Number(p.reduction) / 100) * Math.min(1, age / Number(p.rise)),
  },
];
for (const d of sceneEvents) {
  d.title = L(d.title);
  d.description = L(d.description);
  d.help = L(d.help);
  for (const f of d.fields) f.label = L(f.label);
}
for (const f of [...spatialFields, ...scheduleFields]) f.label = L(f.label);
export function eventDefinition(kind: string) {
  return sceneEvents.find((d) => d.id === kind);
}
export function eventStarts(params: Config, trigger?: number[]) {
  return params.enabled === "Off"
    ? []
    : (trigger ?? [0]).map((t) => t + Number(params.start));
}
export function eventEnd(event: SceneEventConfig, start: number) {
  return (
    start +
    Number(event.params.duration) +
    (eventDefinition(event.kind)?.tailTime?.(event.params) ?? 0)
  );
}
export function spatialWeight(params: Config, distance: number) {
  const radius = Number(params.radius);
  if (distance > radius) return 0;
  return params.falloff === "Uniform"
    ? 1
    : params.falloff === "Inverse square"
      ? 1 / (1 + distance * distance)
      : Math.max(0, 1 - distance / radius);
}
export function applySceneEvents(
  base: number,
  events: SceneEventConfig[],
  channel: Measurement,
  pos: Vec3,
  t: number,
  dimension: number,
) {
  let added = 0,
    multiplier = 1;
  for (const event of events) {
    const d = eventDefinition(event.kind);
    if (!d || !d.channels.includes(channel)) continue;
    const p = event.params;
    const distance = Math.hypot(
      pos.x - Number(p.x),
      dimension === 3 ? pos.y - Number(p.y) : 0,
      pos.z - Number(p.z),
    );
    const weight = spatialWeight(p, distance);
    if (!weight) continue;
    for (const start of event.starts) {
      const age = t - start;
      if (age < 0 || t > eventEnd(event, start)) continue;
      const v = d.effect({ params: p, age, distance, channel });
      if ((d.channelModes?.[channel] ?? d.mode) === "multiply")
        multiplier *= Math.max(0, 1 - weight * v);
      else added += v * weight;
    }
  }
  return (base + added) * multiplier;
}
/** Preview schedule matches evaluated triggers; caller supplies the most recent valid run packet. */
export function eventConfig(
  node: LabNode,
  trigger?: number[],
): SceneEventConfig {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    params: node.params,
    starts: eventStarts(node.params, trigger),
  };
}
