import type { Node } from "@xyflow/react";
import type { LabNode, Project } from "./types.ts";
export type CanvasNode = Node<{ node: LabNode }, "lab">;
// Measured dimensions belong to the canvas, not serialized experiment data.
// Keep React Flow's measured/dragging state when reconciling edits or undo.
export function reconcileCanvasNodes(
  previous: CanvasNode[],
  model: LabNode[],
  selected: string,
): CanvasNode[] {
  const lookup = new Map(previous.map((n) => [n.id, n]));
  const next = model.map((node) => {
    const old = lookup.get(node.id),
      isSelected = node.id === selected;
    const sameData =
      old &&
      old.data.node.id === node.id &&
      old.data.node.kind === node.kind &&
      old.data.node.label === node.label &&
      old.data.node.params === node.params;
    if (
      old &&
      sameData &&
      old.position.x === node.position.x &&
      old.position.y === node.position.y &&
      old.selected === isSelected
    )
      return old;
    return {
      ...old,
      id: node.id,
      type: "lab" as const,
      position: node.position,
      data: sameData ? old!.data : { node },
      selected: isSelected,
      dragHandle: ".drag-handle",
    };
  });
  return next.length === previous.length &&
    next.every((n, i) => n === previous[i])
    ? previous
    : next;
}
// Layout movement must not invalidate computed signals or broadcast new context
// to all node renderers.
export function retainExecutionProject(
  previous: Project,
  current: Project,
): Project {
  if (
    previous.duration !== current.duration ||
    previous.sampleRate !== current.sampleRate ||
    previous.edges !== current.edges ||
    previous.tools !== current.tools ||
    previous.nodes.length !== current.nodes.length
  )
    return current;
  return current.nodes.every((n, i) => {
    const old = previous.nodes[i];
    return (
      old.id === n.id &&
      old.kind === n.kind &&
      old.label === n.label &&
      old.params === n.params
    );
  })
    ? previous
    : current;
}
