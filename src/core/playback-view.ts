import type { Project, Run, Packet } from "./types.ts";
import { inputPacket } from "./runtime.ts";
import { nodeDefinition } from "./registry.ts";
import { visibleSampleIndex } from "./tunnel-demo.ts";

// Project a cached run onto the shared simulation clock without exposing future samples.
export function runAtTime(
  project: Project,
  run: Run | null,
  time: number,
): Run | null {
  if (!run || time >= project.duration) return run;
  const deferred = new Set<string>();
  for (const node of project.nodes) {
    const outputs = Object.values(run.results[node.id]?.outputs ?? {});
    const hasHistoryInput = nodeDefinition(node, project)?.inputs.some(
      (p) => inputPacket(project, run, node.id, p.id)?.type === "signal",
    );
    if (
      hasHistoryInput &&
      outputs.some((p) =>
        ["number", "table", "boolean", "text", "vector3"].includes(p.type),
      )
    )
      deferred.add(node.id);
  }
  // A scalar summary of a whole signal becomes available only when acquisition ends.
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of project.edges)
      if (deferred.has(edge.source) && !deferred.has(edge.target)) {
        deferred.add(edge.target);
        changed = true;
      }
  }
  const packetAtTime = (packet: Packet): Packet => {
    if (packet.type === "signal") {
      const count = visibleSampleIndex(packet.value.times, time) + 1;
      return {
        ...packet,
        value: {
          ...packet.value,
          times: packet.value.times.slice(0, count),
          values: packet.value.values.slice(0, count),
        },
      };
    }
    if (packet.type === "event")
      return { ...packet, value: packet.value.filter((t) => t <= time) };
    return packet;
  };
  return {
    ...run,
    results: Object.fromEntries(
      Object.entries(run.results).map(([id, result]) => [
        id,
        deferred.has(id) && result.status === "ok"
          ? {
              ...result,
              outputs: {},
              status: "waiting",
              message: "ელოდება მონაცემების შეგროვების დასრულებას",
            }
          : {
              ...result,
              outputs: Object.fromEntries(
                Object.entries(result.outputs).map(([port, packet]) => [
                  port,
                  packetAtTime(packet),
                ]),
              ),
            },
      ]),
    ),
  };
}
