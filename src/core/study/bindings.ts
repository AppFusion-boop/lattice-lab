import { nodeDefinition } from "../registry.ts";
import type { Project } from "../types.ts";
import type { BatchHeader, ParameterBinding, OutcomeBinding } from "./types.ts";

export class HeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeaderError";
  }
}

export class RowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RowError";
  }
}

const VALID_REDUCERS = new Set([
  "value",
  "max",
  "min",
  "maxAbs",
  "mean",
  "rms",
  "final",
  "crossed",
  "timeAbove",
]);

/**
 * Validates that parameter and outcome bindings reference valid nodes, fields, and ports in the project.
 * Throws HeaderError on any invalid reference.
 */
export function validateBindings(header: BatchHeader): void {
  const { project, parameterBindings, outcomeBindings } = header;
  if (!project || !Array.isArray(project.nodes)) {
    throw new HeaderError("Header must contain a valid Project with nodes.");
  }

  // Validate parameter bindings
  for (const pb of parameterBindings) {
    if (!pb.parameterKey || typeof pb.parameterKey !== "string") {
      throw new HeaderError("Parameter binding missing 'parameterKey'");
    }
    const node = project.nodes.find((n) => n.id === pb.nodeId);
    if (!node) {
      throw new HeaderError(
        `Parameter binding '${pb.parameterKey}' references missing node '${pb.nodeId}'`,
      );
    }
    const def = nodeDefinition(node, project);
    if (!def) {
      throw new HeaderError(
        `Node definition for node '${pb.nodeId}' (${node.kind}) not found`,
      );
    }
    const field = def.fields.find((f) => f.key === pb.paramKey);
    if (!field) {
      throw new HeaderError(
        `Field '${pb.paramKey}' not found on node '${pb.nodeId}' (${node.kind})`,
      );
    }
  }

  // Validate outcome bindings
  for (const ob of outcomeBindings) {
    if (!ob.outcomeKey || typeof ob.outcomeKey !== "string") {
      throw new HeaderError("Outcome binding missing 'outcomeKey'");
    }
    if (!VALID_REDUCERS.has(ob.reducer)) {
      throw new HeaderError(
        `Outcome binding '${ob.outcomeKey}' has unsupported reducer '${ob.reducer}'`,
      );
    }
    const node = project.nodes.find((n) => n.id === ob.nodeId);
    if (!node) {
      throw new HeaderError(
        `Outcome binding '${ob.outcomeKey}' references missing node '${ob.nodeId}'`,
      );
    }
    const def = nodeDefinition(node, project);
    if (!def) {
      throw new HeaderError(
        `Node definition for node '${ob.nodeId}' (${node.kind}) not found`,
      );
    }
    const port = def.outputs.find((p) => p.id === ob.port);
    if (!port) {
      throw new HeaderError(
        `Output port '${ob.port}' not found on node '${ob.nodeId}' (${node.kind})`,
      );
    }
    if (ob.reducer === "crossed" || ob.reducer === "timeAbove") {
      if (ob.threshold !== undefined && !Number.isFinite(ob.threshold)) {
        throw new HeaderError(
          `Outcome binding '${ob.outcomeKey}' threshold must be finite, got ${ob.threshold}`,
        );
      }
    }
  }
}

/**
 * Applies parameter bindings from row values to a cloned Project.
 * Validates range and options, throwing RowError on invalid values.
 */
export function applyRowBindings(
  project: Project,
  bindings: ParameterBinding[],
  values: Record<string, unknown>,
): void {
  for (const pb of bindings) {
    const raw = values[pb.parameterKey];
    if (raw === undefined || raw === null) {
      throw new RowError(`Missing value for parameter '${pb.parameterKey}'`);
    }

    const node = project.nodes.find((n) => n.id === pb.nodeId);
    if (!node) {
      throw new RowError(`Node '${pb.nodeId}' missing during binding`);
    }
    const def = nodeDefinition(node, project);
    const field = def?.fields.find((f) => f.key === pb.paramKey);
    if (!field) {
      throw new RowError(
        `Field '${pb.paramKey}' not found on node '${pb.nodeId}'`,
      );
    }

    if (field.kind === "number") {
      let numVal: number;
      if (typeof raw === "number") {
        numVal = raw;
      } else if (typeof raw === "string" && raw.trim() !== "") {
        numVal = Number(raw);
      } else {
        throw new RowError(
          `Parameter '${pb.parameterKey}' must be numeric, got ${typeof raw}`,
        );
      }

      if (!Number.isFinite(numVal)) {
        throw new RowError(
          `Parameter '${pb.parameterKey}' value is not a finite number: ${raw}`,
        );
      }

      if (field.min !== undefined && numVal < field.min) {
        throw new RowError(
          `Parameter '${pb.parameterKey}' value ${numVal} is below minimum ${field.min}`,
        );
      }
      if (field.max !== undefined && numVal > field.max) {
        throw new RowError(
          `Parameter '${pb.parameterKey}' value ${numVal} is above maximum ${field.max}`,
        );
      }

      node.params[pb.paramKey] = numVal;
    } else if (field.kind === "select") {
      const strVal = String(raw);
      if (field.options && !field.options.includes(strVal)) {
        throw new RowError(
          `Parameter '${pb.parameterKey}' value '${strVal}' is not in options: [${field.options.join(", ")}]`,
        );
      }
      node.params[pb.paramKey] = strVal;
    } else {
      node.params[pb.paramKey] = raw;
    }
  }
}

