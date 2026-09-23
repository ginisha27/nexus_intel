// apps/backend/src/lib/graphTraversal.ts
//
// Pure, deterministic breadth-first traversal over the EXISTING GraphNode /
// GraphEdge tables. Used to derive an investigation-scoped subgraph without
// creating any new nodes, edges, or relationships, and without a schema
// change — see routes/investigations.ts `GET /:displayId/graph` for how
// this is wired up, and README/audit notes for why traversal (rather than
// an investigationId column) is sufficient for the current graph size and
// data model.
//
// No randomness, no invented edges: this module only ever returns node ids
// that are reachable via real, persisted GraphEdge rows starting from a
// given set of root node ids.

export interface GraphNodeLike {
  id: string;
}

export interface GraphEdgeLike {
  fromId: string;
  toId: string;
}

export interface SubgraphTraversalResult {
  // Every node id reachable from a root within maxDepth (roots included at depth 0).
  nodeIds: Set<string>;
  // Shortest hop-count from any root to each reached node.
  depthById: Map<string, number>;
}

/**
 * Undirected BFS (GraphEdge doesn't encode a meaningful directionality for
 * "is this relevant to the investigation" purposes — e.g. "Transacted With"
 * reads the same both ways) from `rootIds`, bounded to `maxDepth` hops.
 * Root ids not present in `nodes` are silently ignored (defensive — callers
 * are expected to have already filtered to real GraphNode ids).
 */
export function bfsSubgraph(
  nodes: GraphNodeLike[],
  edges: GraphEdgeLike[],
  rootIds: string[],
  maxDepth: number
): SubgraphTraversalResult {
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    if (!adjacency.has(e.fromId) || !adjacency.has(e.toId)) continue; // dangling edge — ignore rather than crash
    adjacency.get(e.fromId)!.push(e.toId);
    adjacency.get(e.toId)!.push(e.fromId);
  }

  const depthById = new Map<string, number>();
  const queue: string[] = [];
  for (const id of rootIds) {
    if (adjacency.has(id) && !depthById.has(id)) {
      depthById.set(id, 0);
      queue.push(id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const depth = depthById.get(current)!;
    if (depth >= maxDepth) continue;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!depthById.has(neighbor)) {
        depthById.set(neighbor, depth + 1);
        queue.push(neighbor);
      }
    }
  }

  return { nodeIds: new Set(depthById.keys()), depthById };
}