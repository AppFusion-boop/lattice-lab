import { L } from "./ka.ts";
import type {
  Config,
  Field,
  SceneData,
  SceneEventConfig,
  Vec3,
  LabNode,
} from "./types.ts";
export type Measurement =
  | "pressure"
  | "temperature"
  | "light"
  | "acceleration"
  | "gasConcentration"
  | "heatFlux";
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
      const flowRatio = (Math.max(0, Number(p.flow ?? 12)) * Math.max(1, Number(p.nozzles ?? 8))) / (12 * 8);
      const angleDeg = Math.min(150, Math.max(10, Number(p.angle ?? 65)));
      const angleRatio = Math.sin((angleDeg * Math.PI) / 180) / Math.sin((65 * Math.PI) / 180);
      const fallRatio = Math.pow(3 / Math.max(0.2, Number(p.fallSpeed ?? 3)), 0.35);
      const droplet = Math.max(5, Number(p.droplet ?? 80));
      const logRatio = Math.log(droplet / 80);
      const dropletFactor = Math.exp(-0.35 * logRatio * logRatio) * Math.pow(80 / droplet, 0.25);
      const effectiveLoad = Math.max(0, flowRatio * angleRatio * fallRatio * dropletFactor);

      if (channel === "temperature") {
        return -Number(p.cooling) * effectiveLoad * fill;
      }
      const r0 = Math.min(0.98, Math.max(0, Number(p.reduction) / 100));
      if (r0 <= 0 || effectiveLoad <= 0) return 0;
      const effectiveReduction = Math.abs(effectiveLoad - 1) < 1e-12 ? r0 : 1 - Math.pow(1 - r0, effectiveLoad);
      return effectiveReduction * fill;
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
  {
    id: "gasExplosion",
    visual: "fire",
    title: "აირის/გაზის აფეთქება (Gas Explosion & Blast Wave)",
    description: "საწვავის წვა, დარტყმითი ტალღა (Shockwave), ალი და ტოქსიკური აირი",
    color: "#ea580c",
    icon: "Flame",
    channels: ["pressure", "temperature", "gasConcentration", "light"],
    mode: "add",
    tailTime: (p) => Number(p.radius) / Number(p.speed),
    front: (p, t) => Math.min(Number(p.radius), t * Number(p.speed)),
    fields: [
      {
        key: "fuel",
        label: "საწვავი აირი (Fuel Gas)",
        kind: "select",
        default: "Methane (CH4)",
        options: [
          "Methane (CH4)",
          "Hydrogen (H2)",
          "Propane (C3H8)",
          "Acetylene (C2H2)",
          "Vapor Cloud (TNT Eq)",
        ],
      },
      num("phi", "ექვივალენტური ფარდობა (Equivalence Ratio phi)", 1.0, 0.4, 2.5, "", 0.05),
      num("fuelMass", "საწვავის მასა (Fuel Mass)", 25, 0.1, 5000, "kg", 1),
      num("overpressure", "პიკური დარტყმითი წნევა (Peak Overpressure)", 35000, 100, 500000, "Pa", 500),
      num("speed", "დარტყმითი ტალღის სიჩქარე (Shock Speed)", 420, 100, 3000, "m/s", 10),
      num("width", "იმპულსის ხანგრძლივობა (Positive Phase td)", 0.045, 0.001, 2, "s", 0.002),
      num("flameTemp", "ალის ტემპერატურა (Flame Temp)", 1850, 400, 3200, "°C", 25),
      num("toxicYield", "ტოქსიკური აირის გამოსავალი (CO / Toxic ppm)", 480, 0, 5000, "ppm", 10),
    ],
    help: "დარტყმითი ტალღა გამოითვლება ფრიდლანდერის (Friedlander) განტოლებით. წვის პროდუქტები და ტოქსიკური გაზის (CO) გამოსავალი იზრდება საწვავის სიჭარბისას (phi > 1.0).",
    effect: ({ params: p, age, distance, channel }) => {
      const t = age - distance / Number(p.speed);
      const w = Number(p.width);
      if (t < 0 || t > Number(p.duration)) return 0;
      const fuel = String(p.fuel ?? "Methane (CH4)");
      const fuelFactor = fuel.includes("Hydrogen")
        ? 1.35
        : fuel.includes("Acetylene")
          ? 1.25
          : fuel.includes("Vapor Cloud")
            ? 1.15
            : fuel.includes("Propane")
              ? 1.05
              : 1.0;
      const massScale = Math.cbrt(Math.max(0.1, Number(p.fuelMass ?? 25)) / 25);
      const phi = Number(p.phi ?? 1.0);
      const stoichScale =
        Math.exp(-Math.pow((phi - 1.05) / 0.65, 2)) /
        Math.exp(-Math.pow((1.0 - 1.05) / 0.65, 2));
      const energyMult = fuelFactor * massScale * stoichScale;

      if (channel === "pressure") {
        const tau = t / w;
        if (tau > 1.8) return 0;
        return Number(p.overpressure) * energyMult * (1 - tau) * Math.exp(-1.5 * tau);
      }
      if (channel === "temperature") {
        const tempMult = Math.pow(fuelFactor * stoichScale, 0.35);
        return Number(p.flameTemp) * tempMult * Math.exp(-Math.pow((t - 0.5 * w) / (2 * w), 2));
      }
      if (channel === "gasConcentration") {
        const richFactor = phi > 1.0 ? 1.0 + 1.8 * (phi - 1.0) : Math.max(0.2, phi);
        return Number(p.toxicYield) * massScale * richFactor * (1 / (1 + 0.3 * distance)) * Math.exp(-0.4 * t);
      }
      if (channel === "light") {
        return 12000 * energyMult * Math.exp(-Math.pow(t / w, 2));
      }
      return 0;
    },
  },
  {
    id: "fluidSprayer",
    visual: "mist",
    title: "სითხის/ნისლის გამფრქვევი (Universal Fluid Sprayer & Scrubber)",
    description: "სხვადასხვა სითხე (წყალი, ქიმიური ნეიტრალიზატორი, ქაფი), წვეთების ზომა და რეაქცია",
    color: "#0ea5e9",
    icon: "Droplets",
    channels: ["pressure", "temperature", "gasConcentration"],
    mode: "multiply",
    channelModes: { temperature: "add", gasConcentration: "multiply" },
    fields: [
      {
        key: "fluid",
        label: "გამფრქვევი სითხე (Fluid Agent)",
        kind: "select",
        default: "Water (H2O)",
        options: [
          "Water (H2O)",
          "Chemical Neutralizer (Scrubber/Alkaline)",
          "Firefighting Foam (AFFF)",
          "Potassium Salt Slurry (Purple-K)",
          "Liquid Nitrogen (LN2)",
        ],
      },
      num("flow", "სითხის ხარჯი (Mass Flow Rate)", 25, 0.5, 300, "L/min", 1),
      num("droplet", "წვეთების ზომა D32 (Sauter Mean Diameter)", 75, 5, 1200, "µm", 5),
      num("nozzles", "საქშენების რაოდენობა (Nozzles Count)", 12, 1, 48, "", 1),
      num("fallSpeed", "გამოფრქვევის სიჩქარე (Discharge Velocity)", 6, 0.5, 25, "m/s", 0.5),
      num("pressureMitigation", "დარტყმითი ტალღის ჩახშობა (Shock Mitigation)", 60, 0, 98, "%", 1),
      num("coolingRate", "აორთქლებით გაგრილება (Evaporative Cooling)", 22, 0, 65, "°C", 0.5),
      num("scavengingEfficiency", "ქიმიური შთანთქმა/ნეიტრალიზაცია (Scavenging)", 80, 0, 99, "%", 1),
      num("rise", "სისტემის ამოქმედების დრო (Activation Ramp)", 0.2, 0.01, 10, "s", 0.01),
    ],
    help: "უნივერსალური გამფრქვევი: წყალი აგრილებს აორთქლებით და ახშობს ტალღას. ქიმიური ნეიტრალიზატორი და ქაფი დამატებით რეაქციაში შედის წვის გაზებთან და ანეიტრალებს ტოქსიკურობას (Scavenging).",
    effect: ({ params: p, age, channel }) => {
      const fill = Math.min(1, age / Number(p.rise));
      const flowRatio = (Math.max(0, Number(p.flow ?? 25)) * Math.max(1, Number(p.nozzles ?? 12))) / (25 * 12);
      const d32 = Math.max(5, Number(p.droplet ?? 75));
      const dFactor = Math.pow(75 / d32, 0.35);
      const vFactor = Math.pow(6 / Math.max(0.5, Number(p.fallSpeed ?? 6)), 0.25);
      const loadFactor = Math.max(0, flowRatio * dFactor * vFactor);

      if (channel === "temperature") {
        const fluid = String(p.fluid);
        const latentFactor = fluid.includes("Nitrogen") ? 2.5 : fluid.includes("Water") ? 1.0 : 0.8;
        return -Number(p.coolingRate) * latentFactor * loadFactor * fill;
      }
      if (channel === "pressure") {
        const r0 = Math.min(0.98, Math.max(0, Number(p.pressureMitigation) / 100));
        if (r0 <= 0 || loadFactor <= 0) return 0;
        const effP = Math.abs(loadFactor - 1) < 1e-12 ? r0 : 1 - Math.pow(1 - r0, loadFactor);
        return effP * fill;
      }
      if (channel === "gasConcentration") {
        const fluid = String(p.fluid);
        const areaBoost = Math.min(2.0, 100 / Math.max(10, d32));
        const reacts = fluid.includes("Neutralizer") || fluid.includes("Foam") || fluid.includes("Purple");
        const eff = (Number(p.scavengingEfficiency) / 100) * (reacts ? 1.0 : 0.25) * areaBoost * Math.pow(flowRatio, 0.5);
        return Math.min(0.98, eff) * fill;
      }
      return 0;
    },
  },
  {
    id: "gasCloud",
    visual: "zone",
    title: "გაზის გაჟონვა / ღრუბელი (Gas Leak Dispersion Cloud)",
    description: "საშიში ან აალებადი აირის კონცენტრაციის გავრცელება",
    color: "#84cc16",
    icon: "Cloud",
    channels: ["gasConcentration"],
    mode: "add",
    fields: [
      {
        key: "gas",
        label: "აირის სახეობა (Gas Species)",
        kind: "select",
        default: "Methane (CH4)",
        options: [
          "Methane (CH4)",
          "Carbon Monoxide (CO)",
          "Hydrogen Sulfide (H2S)",
          "Ammonia (NH3)",
          "Hydrogen (H2)",
        ],
      },
      num("concentration", "საწყისი კონცენტრაცია (Concentration)", 1200, 10, 50000, "ppm", 50),
      num("decayRate", "გაფანტვის კოეფიციენტი (Dispersion Decay)", 0.25, 0.01, 2, "1/s", 0.02),
    ],
    help: "სცენაში აირის გაჟონვის 3D ღრუბელი. კონცენტრაცია მცირდება მანძილთან და დროთან ერთად.",
    effect: ({ params: p, age, distance }) => {
      const gas = String(p.gas ?? "Methane (CH4)");
      const diffFactor = gas.includes("Hydrogen (H2)")
        ? 1.8
        : gas.includes("Ammonia")
          ? 0.95
          : gas.includes("Carbon Monoxide")
            ? 0.85
            : gas.includes("Hydrogen Sulfide")
              ? 0.75
              : 1.0;
      return (
        Number(p.concentration) *
        Math.exp(-Number(p.decayRate) * diffFactor * age) *
        (1 / (1 + 0.2 * distance))
      );
    },
  },
  {
    id: "thermalRadiation",
    visual: "heat",
    title: "სითბური გამოსხივება (Radiant Heat Flux)",
    description: "ალის ან გახურებული ზედაპირის გამოსხივება (Stefan-Boltzmann)",
    color: "#f43f5e",
    icon: "SunMedium",
    channels: ["heatFlux", "temperature"],
    mode: "add",
    fields: [
      num("flux", "სითბური ნაკადის სიმკვრივე (Radiant Heat Flux)", 45, 1, 200, "kW/m²", 1),
      num("emissivity", "გამოსხივების კოეფიციენტი (Emissivity epsilon)", 0.85, 0.1, 1.0, "", 0.05),
    ],
    help: "სტეფან-ბოლცმანის კანონით გამოთვლილი რადიაციული სითბური ნაკადი.",
    effect: ({ params: p, distance, channel }) => {
      const atten = 1 / (1 + 0.15 * distance * distance);
      return channel === "heatFlux"
        ? Number(p.flux) * Number(p.emissivity) * atten
        : (Number(p.flux) * 4.2) * atten;
    },
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
