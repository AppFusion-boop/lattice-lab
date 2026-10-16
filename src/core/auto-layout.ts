import type { LabNode, Project, Wire } from "./types.ts";

export interface AutoLayoutOptions {
  columnSpacing?: number;
  rowGap?: number;
  startX?: number;
  startY?: number;
  direction?: "LR" | "TB";
}

/**
 * Estimates the visual height of a node in pixels based on its kind.
 */
function estimateNodeHeight(node: LabNode): number {
  if (node.kind === "scene3d" || node.kind === "scene2d") return 260;
  if (node.kind === "scope" || node.kind === "inspect" || node.kind === "tableview") return 190;
  if (node.kind.startsWith("gas") || node.kind.startsWith("chemical") || node.kind.startsWith("sdof")) return 180;
  return 150;
}

/**
 * Automatically calculates clean, non-overlapping hierarchical DAG coordinates
 * for all nodes in a Lattice Lab workflow.
 *
 * Algorithm:
 * 1. Build adjacency graph from wire connections.
 * 2. Break any feedback cycles via DFS coloring to guarantee a DAG.
 * 3. Assign topological ranks (layers from source inputs to sinks).
 * 4. Sort nodes in each layer by their predecessor barycenters to minimize wire crossings.
 * 5. Position nodes with proper vertical clearance and centered alignment.
 */
export function autoLayoutNodes(
  nodes: LabNode[],
  edges: Wire[],
  options: AutoLayoutOptions = {},
): LabNode[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [{ ...nodes[0], position: { x: options.startX ?? 80, y: options.startY ?? 80 } }];
  }

  const columnSpacing = options.columnSpacing ?? 340;
  const rowGap = options.rowGap ?? 40;
  const startX = options.startX ?? 80;
  const startY = options.startY ?? 80;

  const nodeMap = new Map<string, LabNode>(nodes.map((n) => [n.id, n]));
  const outAdj = new Map<string, string[]>();
  const inAdj = new Map<string, string[]>();

  for (const n of nodes) {
    outAdj.set(n.id, []);
    inAdj.set(n.id, []);
  }

  // Filter valid edges connecting known nodes
  const validEdges = edges.filter(
    (e) => nodeMap.has(e.source) && nodeMap.has(e.target) && e.source !== e.target,
  );

  // Cycle detection via DFS to find forward tree edges
  const color = new Map<string, "white" | "gray" | "black">();
  for (const n of nodes) color.set(n.id, "white");

  const forwardEdges: Array<{ source: string; target: string }> = [];

  function dfs(u: string) {
    color.set(u, "gray");
    for (const edge of validEdges.filter((e) => e.source === u)) {
      const v = edge.target;
      if (color.get(v) === "white") {
        forwardEdges.push({ source: u, target: v });
        dfs(v);
      } else if (color.get(v) === "black") {
        // Cross or forward edge - keep if it doesn't create a cycle
        forwardEdges.push({ source: u, target: v });
      }
      // If color is gray, it's a back-edge (cycle); ignore for ranking
    }
    color.set(u, "black");
  }

  for (const n of nodes) {
    if (color.get(n.id) === "white") {
      dfs(n.id);
    }
  }

  // Populate DAG forward adjacency
  for (const edge of forwardEdges) {
    outAdj.get(edge.source)!.push(edge.target);
    inAdj.get(edge.target)!.push(edge.source);
  }

  // Assign topological ranks (Longest Path in DAG)
  const ranks = new Map<string, number>();

  // In-degrees for topological sort
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    inDegree.set(n.id, inAdj.get(n.id)!.length);
  }

  const queue: string[] = [];
  for (const n of nodes) {
    if (inDegree.get(n.id) === 0) {
      ranks.set(n.id, 0);
      queue.push(n.id);
    }
  }

  // Process topological order
  let visitedCount = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    visitedCount++;
    const currentRank = ranks.get(u) ?? 0;

    for (const v of outAdj.get(u)!) {
      ranks.set(v, Math.max(ranks.get(v) ?? 0, currentRank + 1));
      const newDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) {
        queue.push(v);
      }
    }
  }

  // Handle any nodes remaining due to isolated cycles
  if (visitedCount < nodes.length) {
    for (const n of nodes) {
      if (!ranks.has(n.id)) {
        ranks.set(n.id, 0);
      }
    }
  }

  // Group nodes by rank into layers
  const maxRank = Math.max(0, ...Array.from(ranks.values()));
  const layers: LabNode[][] = Array.from({ length: maxRank + 1 }, () => []);

  for (const n of nodes) {
    const r = ranks.get(n.id) ?? 0;
    layers[r].push(n);
  }

  // Barycenter sorting to minimize edge crossings between successive layers
  for (let r = 1; r <= maxRank; r++) {
    const prevLayer = layers[r - 1];
    const prevIndices = new Map<string, number>(prevLayer.map((n, idx) => [n.id, idx]));

    layers[r].sort((a, b) => {
      const aParents = inAdj.get(a.id)!.filter((id) => prevIndices.has(id));
      const bParents = inAdj.get(b.id)!.filter((id) => prevIndices.has(id));

      const aBary =
        aParents.length > 0
          ? aParents.reduce((sum, id) => sum + (prevIndices.get(id) ?? 0), 0) / aParents.length
          : 999;
      const bBary =
        bParents.length > 0
          ? bParents.reduce((sum, id) => sum + (prevIndices.get(id) ?? 0), 0) / bParents.length
          : 999;

      return aBary - bBary;
    });
  }

  // Compute column heights and assign (X, Y) positions
  const columnHeights = layers.map((layer) => {
    return layer.reduce((sum, node, idx) => {
      const h = estimateNodeHeight(node);
      return sum + h + (idx < layer.length - 1 ? rowGap : 0);
    }, 0);
  });

  const maxHeight = Math.max(...columnHeights, 100);

  const updatedNodes: LabNode[] = [];

  layers.forEach((layer, colIdx) => {
    const colX = startX + colIdx * columnSpacing;
    const colHeight = columnHeights[colIdx];
    // Center column vertically relative to maxHeight
    const startColY = startY + Math.max(0, (maxHeight - colHeight) * 0.4);

    let currentY = startColY;

    for (const node of layer) {
      updatedNodes.push({
        ...node,
        position: {
          x: Math.round(colX),
          y: Math.round(currentY),
        },
      });
      currentY += estimateNodeHeight(node) + rowGap;
    }
  });

  return updatedNodes;
}

/**
 * Applies auto-layout to a Project, returning an updated Project with aligned node positions.
 */
export function autoLayoutProject(project: Project, options?: AutoLayoutOptions): Project {
  const nextNodes = autoLayoutNodes(project.nodes, project.edges, options);
  return {
    ...project,
    nodes: nextNodes,
  };
}

