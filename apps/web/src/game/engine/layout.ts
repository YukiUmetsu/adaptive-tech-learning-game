import type { MissionMap } from "../models/map";

/**
 * Renderer layout helper.
 *
 * The simulation never knows about x/y coordinates (spec sections 35.2/35.3).
 * The SVG renderer asks this module where to draw each node, for either a
 * horizontal desktop flow or a vertical mobile flow. Coordinates are in the
 * SVG's own user units and scale through the `viewBox`.
 */

export type MapOrientation = "horizontal" | "vertical";

export interface NodePosition {
  x: number;
  y: number;
  /** Distance from the entry node, used for readability and arrow direction. */
  depth: number;
}

export interface MapLayout {
  orientation: MapOrientation;
  positions: Record<string, NodePosition>;
  width: number;
  height: number;
}

export interface LayoutOptions {
  orientation: MapOrientation;
  /** Distance between successive layers. */
  layerSpacing?: number;
  /** Distance between nodes in the same layer. */
  nodeSpacing?: number;
  margin?: number;
  /**
   * Cross-axis offset alternating per layer, producing a winding road instead
   * of a straight line. Render-only; the simulation stays coordinate-free.
   */
  stagger?: number;
}

const DEFAULTS = {
  layerSpacing: 180,
  nodeSpacing: 110,
  margin: 90,
  stagger: 0,
};

/** Longest-path depth from the entry node, ignoring unreachable nodes. */
function computeDepths(map: MissionMap): Map<string, number> {
  const depths = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of map.nodes) {
    outgoing.set(node.id, []);
  }
  for (const edge of map.edges) {
    outgoing.get(edge.from)?.push(edge.to);
  }

  // Iterative relaxation handles diamonds (api -> auth -> app and api -> app).
  for (const node of map.nodes) {
    depths.set(node.id, node.id === map.entryNodeId ? 0 : -1);
  }
  const pending = [...map.nodes.map((node) => node.id)];
  let guard = 0;
  while (pending.length > 0 && guard < map.nodes.length * map.nodes.length + 1) {
    guard += 1;
    const current = pending.shift() as string;
    const currentDepth = depths.get(current) ?? -1;
    if (currentDepth < 0) {
      continue;
    }
    for (const next of outgoing.get(current) ?? []) {
      if ((depths.get(next) ?? -1) < currentDepth + 1) {
        depths.set(next, currentDepth + 1);
        pending.push(next);
      }
    }
  }

  // Unreachable nodes still need a readable slot.
  let fallback = 0;
  for (const node of map.nodes) {
    if ((depths.get(node.id) ?? -1) < 0) {
      depths.set(node.id, fallback + 1);
    }
    fallback = Math.max(fallback, depths.get(node.id) ?? 0);
  }
  return depths;
}

/** Places nodes in layered columns (desktop) or rows (mobile). */
export function layoutMap(
  map: MissionMap,
  options: LayoutOptions,
): MapLayout {
  const { orientation } = options;
  const layerSpacing = options.layerSpacing ?? DEFAULTS.layerSpacing;
  const nodeSpacing = options.nodeSpacing ?? DEFAULTS.nodeSpacing;
  const margin = options.margin ?? DEFAULTS.margin;
  const stagger = options.stagger ?? DEFAULTS.stagger;

  const depths = computeDepths(map);
  const layers = new Map<number, string[]>();
  for (const node of map.nodes) {
    const depth = depths.get(node.id) ?? 0;
    const list = layers.get(depth) ?? [];
    list.push(node.id);
    layers.set(depth, list);
  }

  const maxDepth = Math.max(0, ...layers.keys());
  const maxLayerSize = Math.max(
    1,
    ...[...layers.values()].map((layer) => layer.length),
  );

  const mainLength = margin * 2 + maxDepth * layerSpacing;
  const crossLength =
    margin * 2 + (maxLayerSize - 1) * nodeSpacing + 2 * stagger;

  const positions: Record<string, NodePosition> = {};
  for (const [depth, nodeIds] of layers) {
    nodeIds.forEach((nodeId, index) => {
      const main = margin + depth * layerSpacing;
      const wobble = depth % 2 === 0 ? -stagger : stagger;
      const cross = margin + index * nodeSpacing + wobble;
      positions[nodeId] =
        orientation === "horizontal"
          ? { x: main, y: cross, depth }
          : { x: cross, y: main, depth };
    });
  }

  return {
    orientation,
    positions,
    width: orientation === "horizontal" ? mainLength : crossLength,
    height: orientation === "horizontal" ? crossLength : mainLength,
  };
}
