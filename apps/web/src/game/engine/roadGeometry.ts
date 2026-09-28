import type { MissionMap } from "../models/map";
import type { MapLayout, NodePosition } from "./layout";

/**
 * Graph-aware road geometry.
 *
 * The simulation is coordinate-free: an enemy's route is `enemy.path`, a list of
 * node ids. This module turns that graph into render geometry so the board can
 * draw *every* edge of a branching map and place each enemy on its own route.
 *
 * It is intentionally pure: no React, no simulation state, no DOM. The same
 * edge/path helpers position enemies, towers, pads, heroes, effects and beams,
 * and the simulation uses the equivalent logic (`pathEdgeIndex` /
 * `edgePositionOnPath` / `defensePositionOnPath`), so the two share one branch
 * model for the current branching maps. This is a shared-helper invariant, not
 * a blanket guarantee that every future effect is branch-scoped: some controls
 * (detection, system-wide damage reduction, recovery) are intentionally global.
 */

export interface Point {
  x: number;
  y: number;
}

/** Render geometry for one directed graph edge. */
export interface RoadEdgeGeometry {
  from: string;
  to: string;
  /** Stable key `from->to`. */
  key: string;
  /** Polyline points, including the endpoints. */
  points: Point[];
  length: number;
}

export interface MapRoadGeometry {
  /** Edge geometry keyed by `from->to`, in map declaration order. */
  edges: Record<string, RoadEdgeGeometry>;
  /** Deterministic edge key order. */
  edgeOrder: string[];
  /** Node id -> rendered position. */
  positions: Record<string, NodePosition>;
  width: number;
  height: number;
}

/** A position on a specific edge, used to anchor heroes to a branch. */
export interface EdgeAnchor {
  from: string;
  to: string;
  /** 0..1 along the edge. */
  fraction: number;
}

/**
 * A build pad identified purely by map structure, independent of x/y layout.
 *
 * Pad identity must never depend on rendered edge length: the desktop
 * (horizontal) and mobile (vertical) layouts draw the same edge at different
 * pixel lengths, so a pixel-derived pad count would change the number of pads
 * and shift every globally-sequential id. A logical pad is therefore keyed by
 * its edge, slot, and side, and carries a fixed `fraction` along that edge; only
 * the rendered position is orientation-dependent.
 */
export interface LogicalRoadPad {
  /** Stable id, for example `edge--edge--app--0-left`. */
  id: string;
  edgeFrom: string;
  edgeTo: string;
  slot: number;
  side: "left" | "right";
  /** Fixed 0..1 position along the edge. */
  fraction: number;
  /** Node the pad is nearest along the edge. */
  nodeId: string;
  /** Pad on the opposite side of the edge. */
  partnerId: string;
}

/** A logical pad mapped onto the current rendered edge geometry. */
export interface RoadPad {
  id: string;
  /** Node the pad is associated with (nearest endpoint). */
  nodeId: string;
  position: Point;
  /** Facing angle toward the edge center (for art). */
  angle: number;
  /** Pad on the opposite side of the edge. */
  partnerId: string;
  /** Global node-depth position, retained for legacy gates only. */
  roadPosition: number;
  /** Edge this pad belongs to. */
  edgeKey: string;
  edgeFrom: string;
  edgeTo: string;
  /** 0..1 along the edge. */
  fraction: number;
}

const PAD_OFFSET = 62;
/** Keep pads clear of the node rings at each end of an edge. */
const PAD_INSET = 0.16;

/**
 * Fixed number of pad groups per edge.
 *
 * Pad count is a map-structure decision, not a rendering decision, so every
 * orientation of the same map produces identical pad ids. Two groups (four pads)
 * per edge gives every branch a buildable position without crowding short edges.
 */
const PAD_GROUPS_PER_EDGE = 2;

/** Optional per-edge group overrides, keyed by `from->to`. */
const PAD_GROUP_OVERRIDES: Record<string, number> = {};

function padGroupsForEdge(from: string, to: string): number {
  return PAD_GROUP_OVERRIDES[edgeKey(from, to)] ?? PAD_GROUPS_PER_EDGE;
}

/** Builds the stable logical pads for one edge, in slot/side order. */
function logicalPadsForEdge(from: string, to: string): LogicalRoadPad[] {
  const groups = Math.max(1, padGroupsForEdge(from, to));
  const pads: LogicalRoadPad[] = [];
  for (let slot = 0; slot < groups; slot += 1) {
    const rawFraction = (slot + 0.5) / groups;
    const fraction = Math.max(PAD_INSET, Math.min(1 - PAD_INSET, rawFraction));
    const nodeId = fraction < 0.5 ? from : to;
    const leftId = `edge--${from}--${to}--${slot}-left`;
    const rightId = `edge--${from}--${to}--${slot}-right`;
    pads.push(
      { id: leftId, edgeFrom: from, edgeTo: to, slot, side: "left", fraction, nodeId, partnerId: rightId },
      { id: rightId, edgeFrom: from, edgeTo: to, slot, side: "right", fraction, nodeId, partnerId: leftId },
    );
  }
  return pads;
}

/**
 * Builds the stable logical pads for a whole map.
 *
 * Identity is derived from the map's edge declaration order only, so it is the
 * same for desktop, mobile, and any window width or orientation.
 */
export function buildLogicalRoadPads(map: MissionMap): LogicalRoadPad[] {
  return map.edges.flatMap((edge) => logicalPadsForEdge(edge.from, edge.to));
}

/** Maps logical pads onto the current rendered geometry, preserving identity. */
export function renderRoadPads(
  geometry: MapRoadGeometry,
  logical: LogicalRoadPad[],
): RoadPad[] {
  const pads: RoadPad[] = [];
  for (const pad of logical) {
    const edge = geometry.edges[edgeKey(pad.edgeFrom, pad.edgeTo)];
    const depthFrom = geometry.positions[pad.edgeFrom]?.depth ?? 0;
    const roadPosition = depthFrom + pad.fraction;
    if (!edge) {
      const a = geometry.positions[pad.edgeFrom];
      const b = geometry.positions[pad.edgeTo];
      if (!a || !b) {
        continue;
      }
      const center = {
        x: a.x + (b.x - a.x) * pad.fraction,
        y: a.y + (b.y - a.y) * pad.fraction,
      };
      pads.push({
        ...pad,
        edgeKey: edgeKey(pad.edgeFrom, pad.edgeTo),
        position: center,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        roadPosition,
      });
      continue;
    }
    const center = pointOnEdgeGeometry(edge, pad.fraction);
    const ahead = pointOnEdgeGeometry(edge, Math.min(1, pad.fraction + 0.02));
    const behind = pointOnEdgeGeometry(edge, Math.max(0, pad.fraction - 0.02));
    const tangent = normalize({ x: ahead.x - behind.x, y: ahead.y - behind.y });
    const perpendicular = { x: -tangent.y, y: tangent.x };
    const sign = pad.side === "left" ? 1 : -1;
    const position = {
      x: center.x + perpendicular.x * PAD_OFFSET * sign,
      y: center.y + perpendicular.y * PAD_OFFSET * sign,
    };
    pads.push({
      ...pad,
      edgeKey: edgeKey(pad.edgeFrom, pad.edgeTo),
      position,
      angle: Math.atan2(center.y - position.y, center.x - position.x),
      roadPosition,
    });
  }
  return pads;
}

export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function normalize(v: Point): Point {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
}

/**
 * Bends an edge so long runs read as architecture rather than a straight wire.
 * The bend alternates by declaration index, matching the previous single-road
 * look for linear maps.
 */
function bendPoints(a: Point, b: Point, index: number): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const px = -dy / length;
  const py = dx / length;
  const bend = 30 * (index % 2 === 0 ? 1 : -1);
  return [
    a,
    { x: a.x + dx * 0.34 + px * bend, y: a.y + dy * 0.34 + py * bend },
    { x: a.x + dx * 0.66 - px * bend, y: a.y + dy * 0.66 - py * bend },
    b,
  ];
}

function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y,
    );
  }
  return total;
}

/** Point at fraction `t` (0..1) along a polyline. */
export function pointOnPoints(points: Point[], t: number): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }
  const edge = { points, length: polylineLength(points) };
  return pointOnEdgeGeometry(edge, t);
}

function pointOnEdgeGeometry(
  edge: { points: Point[]; length: number },
  t: number,
): Point {
  const clamped = Math.max(0, Math.min(1, t));
  const target = clamped * edge.length;
  let travelled = 0;
  for (let i = 0; i < edge.points.length - 1; i += 1) {
    const a = edge.points[i];
    const b = edge.points[i + 1];
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (travelled + segment >= target || i === edge.points.length - 2) {
      const local = segment === 0 ? 0 : (target - travelled) / segment;
      const c = Math.max(0, Math.min(1, local));
      return { x: a.x + (b.x - a.x) * c, y: a.y + (b.y - a.y) * c };
    }
    travelled += segment;
  }
  return edge.points[edge.points.length - 1];
}

/** Builds render geometry for every edge in the map graph. */
export function buildMapRoadGeometry(
  map: MissionMap,
  layout: MapLayout,
): MapRoadGeometry {
  const edges: Record<string, RoadEdgeGeometry> = {};
  const edgeOrder: string[] = [];

  map.edges.forEach((edge, index) => {
    const from = layout.positions[edge.from];
    const to = layout.positions[edge.to];
    if (!from || !to) {
      return;
    }
    const points = bendPoints(from, to, index);
    const key = edgeKey(edge.from, edge.to);
    edges[key] = {
      from: edge.from,
      to: edge.to,
      key,
      points,
      length: polylineLength(points),
    };
    edgeOrder.push(key);
  });

  return {
    edges,
    edgeOrder,
    positions: layout.positions,
    width: layout.width,
    height: layout.height,
  };
}

function resolvePathEdge(
  geometry: MapRoadGeometry,
  path: string[],
  edgeIndex: number,
): RoadEdgeGeometry | null {
  const from = path[edgeIndex];
  const to = path[edgeIndex + 1];
  if (from === undefined || to === undefined) {
    return null;
  }
  return geometry.edges[edgeKey(from, to)] ?? null;
}

/** Point for an exact path position (edge index + fraction) on one route. */
export function pathPointAt(
  geometry: MapRoadGeometry,
  path: string[],
  position: number,
): Point | null {
  if (path.length < 2) {
    return null;
  }
  const maxIndex = path.length - 2;
  const clamped = Math.max(0, position);
  const edgeIndex = Math.min(maxIndex, Math.floor(clamped));
  const fraction = clamped >= path.length - 1 ? 1 : clamped - edgeIndex;
  const edge = resolvePathEdge(geometry, path, edgeIndex);
  if (!edge) {
    // Fallback: interpolate straight between the two node positions.
    const a = geometry.positions[path[edgeIndex]];
    const b = geometry.positions[path[edgeIndex + 1]];
    if (!a || !b) {
      return null;
    }
    return {
      x: a.x + (b.x - a.x) * fraction,
      y: a.y + (b.y - a.y) * fraction,
    };
  }
  return pointOnEdgeGeometry(edge, fraction);
}

/** Point for an enemy on its own path. */
export function pathPoint(
  geometry: MapRoadGeometry,
  path: string[],
  pathIndex: number,
  progress: number,
): Point | null {
  return pathPointAt(geometry, path, pathIndex + progress);
}

/** Point on a single edge at a fraction. */
export function edgePoint(
  geometry: MapRoadGeometry,
  anchor: EdgeAnchor,
): Point | null {
  const edge = geometry.edges[edgeKey(anchor.from, anchor.to)];
  if (!edge) {
    const a = geometry.positions[anchor.from];
    const b = geometry.positions[anchor.to];
    if (!a || !b) {
      return null;
    }
    const t = Math.max(0, Math.min(1, anchor.fraction));
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return pointOnEdgeGeometry(edge, anchor.fraction);
}

/** The edge and fraction nearest a point, used for hero drop/tap. */
export function nearestEdgeAnchor(
  geometry: MapRoadGeometry,
  point: Point,
): { anchor: EdgeAnchor; point: Point; distance: number } | null {
  let best: { anchor: EdgeAnchor; point: Point; distance: number } | null = null;
  for (const key of geometry.edgeOrder) {
    const edge = geometry.edges[key];
    for (let i = 0; i < edge.points.length - 1; i += 1) {
      const a = edge.points[i];
      const b = edge.points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy || 1;
      const local = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq),
      );
      const px = a.x + dx * local;
      const py = a.y + dy * local;
      const distance = Math.hypot(point.x - px, point.y - py);
      if (!best || distance < best.distance) {
        const segmentOffset = edgeSegmentOffset(edge.points, i, local);
        best = {
          anchor: {
            from: edge.from,
            to: edge.to,
            fraction: segmentOffset,
          },
          point: { x: px, y: py },
          distance,
        };
      }
    }
  }
  return best;
}

/** Converts a segment-local fraction into a whole-edge fraction. */
function edgeSegmentOffset(
  points: Point[],
  segmentIndex: number,
  local: number,
): number {
  let travelled = 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const segment = Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y,
    );
    if (i < segmentIndex) {
      travelled += segment;
    }
    total += segment;
  }
  const segment = Math.hypot(
    points[segmentIndex + 1].x - points[segmentIndex].x,
    points[segmentIndex + 1].y - points[segmentIndex].y,
  );
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, (travelled + local * segment) / total));
}

/**
 * Renders deterministic tower pads for the current geometry.
 *
 * Identity comes from {@link buildLogicalRoadPads} (map structure only), then is
 * projected onto the current edge positions. Two orientations of the same map
 * therefore produce the same pad ids, edges, and fractions; only x/y differ.
 */
export function buildRoadPads(geometry: MapRoadGeometry): RoadPad[] {
  const logical = geometry.edgeOrder.flatMap((key) => {
    const edge = geometry.edges[key];
    return logicalPadsForEdge(edge.from, edge.to);
  });
  return renderRoadPads(geometry, logical);
}
