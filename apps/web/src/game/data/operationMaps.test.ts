import { describe, expect, it } from "vitest";

import { OPERATION_MAPS } from "./operationMaps";

/**
 * Operation map catalog parity.
 *
 * The Rust catalog in `crates/domain/src/cyber_operation.rs` is authoritative.
 * This list must stay in sync with it, so a server-generated Operation never
 * silently falls back to the default map.
 */
const SERVER_MAP_IDS = [
  "deep-stack",
  "dual-service",
  "edge-basic",
  "full-stack",
  "identity-fork",
  "identity-stack",
  "service-mesh",
  "web-stack",
];

describe("OPERATION_MAPS", () => {
  it("matches the server map catalog exactly", () => {
    expect(Object.keys(OPERATION_MAPS).sort()).toEqual(SERVER_MAP_IDS);
  });

  it("has a reachable entry node and no dangling edges", () => {
    for (const [id, map] of Object.entries(OPERATION_MAPS)) {
      const nodeIds = new Set(map.nodes.map((node) => node.id));
      expect(nodeIds.has(map.entryNodeId), `${id} entry`).toBe(true);
      for (const edge of map.edges) {
        expect(nodeIds.has(edge.from), `${id} edge from ${edge.from}`).toBe(true);
        expect(nodeIds.has(edge.to), `${id} edge to ${edge.to}`).toBe(true);
      }
    }
  });

  it("has no isolated node", () => {
    for (const [id, map] of Object.entries(OPERATION_MAPS)) {
      const adjacency = new Map<string, string[]>();
      for (const node of map.nodes) {
        adjacency.set(node.id, []);
      }
      for (const edge of map.edges) {
        adjacency.get(edge.from)?.push(edge.to);
      }
      const seen = new Set([map.entryNodeId]);
      const queue = [map.entryNodeId];
      while (queue.length > 0) {
        for (const next of adjacency.get(queue.shift() as string) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect(seen.size, `${id} reachability`).toBe(map.nodes.length);
    }
  });
});
