export type DataType =
  | "event"
  | "number"
  | "boolean"
  | "text"
  | "vector3"
  | "signal"
  | "table"
  | "scene";
export type Vec3 = { x: number; y: number; z: number };
export type Object3D = {
  id: string;
  name: string;
  shape: "box" | "sphere" | "source" | "mesh";
  position: Vec3;
  size: Vec3;
  rotation: number;
  color: string;
  vertices?: number[];
};
export type SceneData = {
  dimension: 2 | 3;
  width: number;
  depth: number;
  height: number;
  temperature: number;
  light: number;
  amplitude: number;
  frequency: number;
  objects: Object3D[];
};
export type Signal = {
  times: number[];
  values: number[];
  unit: string;
  name: string;
};
export type Table = { columns: string[]; rows: (number | string)[][] };
export type Packet =
  | { type: "event"; value: number[] }
  | { type: "number"; value: number; unit: string }
  | { type: "boolean"; value: boolean }
  | { type: "text"; value: string }
  | { type: "vector3"; value: Vec3; unit: string }
  | { type: "signal"; value: Signal }
  | { type: "table"; value: Table }
  | { type: "scene"; value: SceneData };
export type Port = {
  id: string;
  label: string;
  types: DataType[];
  optional?: boolean;
};
export type Field = {
  key: string;
  label: string;
  kind: "number" | "text" | "select" | "expression" | "csv";
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  help?: string;
};
export type Config = Record<string, unknown>;
export type LabNode = {
  id: string;
  kind: string;
  label: string;
  position: { x: number; y: number };
  params: Config;
};
export type Wire = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};
export type CustomTool = {
  id: string;
  label: string;
  expression: string;
  unit: string;
};
export type Project = {
  version: 2;
  name: string;
  duration: number;
  sampleRate: number;
  nodes: LabNode[];
  edges: Wire[];
  tools: CustomTool[];
};
export type NodeResult = {
  outputs: Record<string, Packet>;
  status: "ok" | "error" | "waiting";
  message: string;
  ms: number;
};
export type Run = {
  id: string;
  at: string;
  durationMs: number;
  results: Record<string, NodeResult>;
  signature: string;
};
export type EvalContext = {
  duration: number;
  sampleRate: number;
  times: number[];
  params: Config;
  inputs: Record<string, Packet | undefined>;
  node: LabNode;
};
export type NodeDefinition = {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  inputs: Port[];
  outputs: Port[];
  fields: Field[];
  help: string;
  evaluate: (context: EvalContext) => Record<string, Packet>;
};
export const typeColors: Record<DataType, string> = {
  event: "#db9741",
  number: "#7a69c4",
  boolean: "#c173ac",
  text: "#73956b",
  vector3: "#4682a5",
  signal: "#2b968d",
  table: "#619066",
  scene: "#5e89c6",
};
export const categories = [
  { id: "Triggers", ka: "ტრიგერები", color: "#c38e41" },
  { id: "Scenes", ka: "სცენები", color: "#6c88b8" },
  { id: "Data", ka: "მონაცემები", color: "#77966c" },
  { id: "Sensors", ka: "სენსორები", color: "#589f9b" },
  { id: "Processing", ka: "დამუშავება", color: "#9380bd" },
  { id: "Logic & events", ka: "ლოგიკა და მოვლენები", color: "#bd83a6" },
  { id: "Outputs", ka: "გამომავალი", color: "#7f90a5" },
];
export const signature = (p: Project) =>
  JSON.stringify({
    duration: p.duration,
    sampleRate: p.sampleRate,
    nodes: p.nodes.map(({ position, ...n }) => n),
    edges: p.edges,
    tools: p.tools,
  });
export const blankProject = (): Project => ({
  version: 2,
  name: "Untitled workflow",
  duration: 2,
  sampleRate: 200,
  nodes: [],
  edges: [],
  tools: [],
});
export const sceneDefaults = (dimension: 2 | 3): SceneData => ({
  dimension,
  width: 20,
  depth: 12,
  height: 8,
  temperature: 22,
  light: 500,
  amplitude: 1000,
  frequency: 8,
  objects: [
    {
      id: "source",
      name: "Wave source",
      shape: "source",
      position: { x: 3, y: 1, z: 6 },
      size: { x: 0.5, y: 0.5, z: 0.5 },
      rotation: 0,
      color: "#db9b55",
    },
    {
      id: "box",
      name: "Test object",
      shape: "box",
      position: { x: 10, y: 1, z: 3 },
      size: { x: 3, y: 2, z: 2 },
      rotation: 0,
      color: "#87aaa5",
    },
  ],
});
