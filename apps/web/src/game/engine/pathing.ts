import type { MissionMap } from "../models/map";

/**
 * Logical pathing.
 *
 * Paths are computed from the map graph, never from screen coordinates, so the
 * same simulation works for the desktop and mobile layouts (spec sections 15 and
 * 35.2). Neighbours are visited in map-declaration order, which keeps paths
 * deterministic.
 */

export interface PathResult {
  /** Node ids from the entry point to the target, inclusive. */
  path: string[];
  /** Whether a route to the target exists. */
  reachable: boolean;
}

/** Adjacency list in map-declaration order. */
function buildAdjacency(map: MissionMap): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of map.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of map.edges) {
    const list = adjacency.get(edge.from);
    if (list && adjacency.has(edge.to)) {
      list.push(edge.to);
    }
  }
  return adjacency;
}

/**
 * Shortest path from the map entry point to a target node.
 *
 * Breadth-first search with declaration-order neighbours produces stable,
 * deterministic paths for a given map.
 */
export function computePath(map: MissionMap, targetNodeId: string): PathResult {
  const adjacency = buildAdjacency(map);
  const start = map.entryNodeId;
  if (!adjacency.has(start) || !adjacency.has(targetNodeId)) {
    return { path: [], reachable: false };
  }

  const previous = new Map<string, string | null>([[start, null]]);
  const queue: string[] = [start];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === targetNodeId) {
      break;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }

  if (!previous.has(targetNodeId)) {
    return { path: [], reachable: false };
  }

  const path: string[] = [];
  let cursor: string | null = targetNodeId;
  while (cursor !== null) {
    path.unshift(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return { path, reachable: true };
}
