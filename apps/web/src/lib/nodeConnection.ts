/**
 * Directed-edge helpers shared by the desktop and mobile `node_connection`
 * renderers.
 *
 * The learner answer is always `string[][]` in `[from, to]` order: the exact
 * shape the existing scorer and `/v1/sync` expect. Keeping the manipulation
 * here means both responsive layouts mutate one representation and cannot
 * drift apart.
 */

import type { CanonicalAnswer, GraphNode } from "../api/types";

/** A directed connection as submitted: `[from, to]`. */
export type ConnectionEdge = [string, string];

/** Stable identity for a directed edge, used for membership checks. */
export function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * Whether an edge may be added.
 *
 * Mirrors the scorer's `invalid_edge` rule: empty endpoints and self-links are
 * rejected. `node_connection` has no schema support for self-edges, so the UI
 * must never offer the selected source as its own destination.
 */
export function canConnect(from: string, to: string): boolean {
  return from !== "" && to !== "" && from !== to;
}

/** Whether `edges` already contains the directed edge `from -> to`. */
export function hasEdge(
  edges: readonly string[][],
  from: string,
  to: string,
): boolean {
  return edges.some((edge) => edge[0] === from && edge[1] === to);
}

/**
 * Appends `from -> to`, returning the original array when the edge is invalid
 * or already present so duplicate identical edges are never inserted.
 */
export function addEdge(
  edges: readonly string[][],
  from: string,
  to: string,
): string[][] {
  if (!canConnect(from, to) || hasEdge(edges, from, to)) {
    return edges as string[][];
  }
  return [...edges, [from, to]];
}

/** Removes `from -> to`, returning a new array (or the original if absent). */
export function removeEdge(
  edges: readonly string[][],
  from: string,
  to: string,
): string[][] {
  if (!hasEdge(edges, from, to)) {
    return edges as string[][];
  }
  return edges.filter((edge) => !(edge[0] === from && edge[1] === to));
}

/** Adds the edge if absent, otherwise removes it. Used by the desktop graph. */
export function toggleEdge(
  edges: readonly string[][],
  from: string,
  to: string,
): string[][] {
  return hasEdge(edges, from, to)
    ? removeEdge(edges, from, to)
    : addEdge(edges, from, to);
}

/** Builds an id → label lookup for rendering connection summaries. */
export function nodeLabelMap(
  nodes: readonly GraphNode[],
): Map<string, string> {
  return new Map(nodes.map((node) => [node.id, node.label]));
}

/**
 * Filters an arbitrary `string[][]` answer down to well-formed directed edges.
 *
 * Defensive: the answer normally comes from our own UI, but a restored or
 * externally-supplied value must never break rendering.
 */
export function wellFormedEdges(edges: readonly string[][]): ConnectionEdge[] {
  return edges.filter(
    (edge): edge is ConnectionEdge =>
      edge.length === 2 && canConnect(edge[0], edge[1]),
  );
}

/**
 * The source node of the first well-formed canonical edge, if any.
 *
 * Used only to seed the *mobile* builder's starting "Connect FROM" choice. It
 * deliberately returns a single node id rather than an edge, so the target and
 * the rest of the relationship are never placed in pre-submit UI state. Desktop
 * ignores it entirely.
 */
export function firstSourceNodeId(
  canonical: CanonicalAnswer | undefined,
): string | undefined {
  if (!canonical || canonical.type !== "node_connection") {
    return undefined;
  }
  for (const edge of canonical.edges) {
    if (edge.length === 2 && canConnect(edge[0], edge[1])) {
      return edge[0];
    }
  }
  return undefined;
}
