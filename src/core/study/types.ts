import type { Project } from "../types.ts";

export type OutcomeReducer =
  | "value"
  | "max"
  | "min"
  | "maxAbs"
  | "mean"
  | "rms"
  | "final"
  | "crossed"
  | "timeAbove";

export interface ParameterBinding {
  parameterKey: string;
  nodeId: string;
  paramKey: string;
}

export interface OutcomeBinding {
  outcomeKey: string;
  nodeId: string;
  port: string;
  reducer: OutcomeReducer;
  threshold?: number;
}

export interface BatchHeader {
  project: Project;
  parameterBindings: ParameterBinding[];
  outcomeBindings: OutcomeBinding[];
}

export interface BatchRowInput {
  id: string;
  values: Record<string, unknown>;
}

export interface BatchRowResult {
  id: string;
  status: "ok" | "error";
  outcomes: Record<string, number>;
  message?: string;
  nodeErrors?: Record<string, string>;
}

