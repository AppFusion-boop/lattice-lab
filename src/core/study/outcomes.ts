import type { Packet } from "../types.ts";
import type { OutcomeReducer } from "./types.ts";

/**
 * Reduces a node output Packet to a scalar outcome value using the specified reducer.
 */
export function reduceOutcome(
  packet: Packet | undefined,
  reducer: OutcomeReducer,
  threshold: number = 0,
): number {
  if (!packet) {
    throw new Error("No output packet produced on bound port");
  }

  if (reducer === "value") {
    if (packet.type === "number") {
      return packet.value;
    }
    if (packet.type === "boolean") {
      return packet.value ? 1 : 0;
    }
    throw new Error(
      `Reducer 'value' expects a number or boolean packet, got '${packet.type}'`,
    );
  }

  // All other reducers require a signal packet
  if (packet.type !== "signal") {
    throw new Error(
      `Reducer '${reducer}' expects a signal packet, got '${packet.type}'`,
    );
  }

  const signal = packet.value;
  const vals = signal.values;
  if (!vals || vals.length === 0) {
    throw new Error("Signal contains no samples to reduce");
  }

  switch (reducer) {
    case "max":
      return Math.max(...vals);

    case "min":
      return Math.min(...vals);

    case "maxAbs":
      return Math.max(...vals.map(Math.abs));

    case "mean":
      return vals.reduce((sum, v) => sum + v, 0) / vals.length;

    case "rms":
      return Math.sqrt(
        vals.reduce((sum, v) => sum + v * v, 0) / vals.length,
      );

    case "final":
      return vals[vals.length - 1];

    case "crossed":
      return vals.some((v) => v >= threshold) ? 1 : 0;

    case "timeAbove": {
      const times = signal.times;
      if (!times || times.length <= 1) {
        return 0;
      }
      let durationAbove = 0;
      for (let i = 0; i < times.length - 1; i++) {
        if (vals[i] >= threshold) {
          durationAbove += times[i + 1] - times[i];
        }
      }
      return durationAbove;
    }

    default:
      throw new Error(`Unknown outcome reducer '${reducer}'`);
  }
}

