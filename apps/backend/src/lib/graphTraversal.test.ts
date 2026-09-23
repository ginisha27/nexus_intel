// apps/backend/src/lib/graphTraversal.test.ts
//
// Run with: npx tsx --test src/lib/graphTraversal.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { bfsSubgraph } from "../lib/graphTraversal.js";

test("root node alone is included at depth 0", () => {
  const { nodeIds, depthById } = bfsSubgraph([{ id: "a" }], [], ["a"], 2);
  assert.deepEqual(Array.from(nodeIds), ["a"]);
  assert.equal(depthById.get("a"), 0);
});

test("traversal respects maxDepth", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const edges = [
    { fromId: "a", toId: "b" },
    { fromId: "b", toId: "c" },
    { fromId: "c", toId: "d" },
  ];
  const depth1 = bfsSubgraph(nodes, edges, ["a"], 1);
  assert.deepEqual(Array.from(depth1.nodeIds).sort(), ["a", "b"]);

  const depth2 = bfsSubgraph(nodes, edges, ["a"], 2);
  assert.deepEqual(Array.from(depth2.nodeIds).sort(), ["a", "b", "c"]);
});

test("edges are treated as undirected", () => {
  const nodes = [{ id: "a" }, { id: "b" }];
  const edges = [{ fromId: "b", toId: "a" }]; // reversed direction from root
  const { nodeIds } = bfsSubgraph(nodes, edges, ["a"], 1);
  assert.deepEqual(Array.from(nodeIds).sort(), ["a", "b"]);
});

test("never invents nodes: a root id absent from the node set is ignored", () => {
  const nodes = [{ id: "a" }];
  const { nodeIds } = bfsSubgraph(nodes, [], ["does-not-exist"], 2);
  assert.deepEqual(Array.from(nodeIds), []);
});

test("dangling edges (endpoint not in node set) are ignored, not crashed on", () => {
  const nodes = [{ id: "a" }];
  const edges = [{ fromId: "a", toId: "ghost" }];
  const { nodeIds } = bfsSubgraph(nodes, edges, ["a"], 2);
  assert.deepEqual(Array.from(nodeIds), ["a"]);
});

test("multiple disconnected roots are each explored", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "x" }, { id: "y" }];
  const edges = [
    { fromId: "a", toId: "b" },
    { fromId: "x", toId: "y" },
  ];
  const { nodeIds } = bfsSubgraph(nodes, edges, ["a", "x"], 1);
  assert.deepEqual(Array.from(nodeIds).sort(), ["a", "b", "x", "y"]);
});