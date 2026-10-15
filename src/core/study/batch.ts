import { execute } from "../runtime.ts";
import { validateBindings, applyRowBindings } from "./bindings.ts";
import { reduceOutcome } from "./outcomes.ts";
import type {
  BatchHeader,
  BatchRowInput,
  BatchRowResult,
} from "./types.ts";

/**
 * Headless batch evaluator that executes a Flow graph across candidate parameter rows.
 * Pure TypeScript — uses structuredClone, contains no Node or DOM dependencies.
 *
 * @param header Project definition, parameter bindings, and outcome bindings.
 * @param rows Candidate rows with parameter values.
 * @param onResult Optional streaming callback invoked as each row completes.
 * @returns Array of row evaluation results with scalar outcomes or error messages.
 */
export function evaluateRows(
  header: BatchHeader,
  rows: Iterable<BatchRowInput>,
  onResult?: (result: BatchRowResult) => void,
): BatchRowResult[] {
  // 1. Validate header references (throws HeaderError on invalid references)
  validateBindings(header);

  const results: BatchRowResult[] = [];

  // 2. Process each row
  for (const row of rows) {
    try {
      // Deep clone project per row to maintain execution purity
      const clonedProject = structuredClone(header.project);

      // Apply row parameter values with range/type checks
      applyRowBindings(clonedProject, header.parameterBindings, row.values);

      // Execute simulation graph
      const run = execute(clonedProject);

      // Collect node errors if any occurred
      const nodeErrors: Record<string, string> = {};
      for (const [nodeId, nodeRes] of Object.entries(run.results)) {
        if (nodeRes.status === "error") {
          nodeErrors[nodeId] = nodeRes.message;
        }
      }

      // Check if any bound outcome node experienced an error
      for (const ob of header.outcomeBindings) {
        if (nodeErrors[ob.nodeId]) {
          throw new Error(
            `Node '${ob.nodeId}' failed: ${nodeErrors[ob.nodeId]}`,
          );
        }
      }

      // Compute outcomes via reducers
      const outcomes: Record<string, number> = {};
      for (const ob of header.outcomeBindings) {
        const nodeRes = run.results[ob.nodeId];
        if (!nodeRes) {
          throw new Error(`Node '${ob.nodeId}' produced no execution results`);
        }
        const packet = nodeRes.outputs[ob.port];
        if (!packet) {
          throw new Error(
            `Output port '${ob.port}' on node '${ob.nodeId}' produced no packet`,
          );
        }
        outcomes[ob.outcomeKey] = reduceOutcome(
          packet,
          ob.reducer,
          ob.threshold ?? 0,
        );
      }

      const rowResult: BatchRowResult = {
        id: row.id,
        status: "ok",
        outcomes,
        ...(Object.keys(nodeErrors).length > 0 ? { nodeErrors } : {}),
      };

      onResult?.(rowResult);
      results.push(rowResult);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      const rowResult: BatchRowResult = {
        id: row.id,
        status: "error",
        outcomes: {},
        message,
      };
      onResult?.(rowResult);
      results.push(rowResult);
    }
  }

  return results;
}

