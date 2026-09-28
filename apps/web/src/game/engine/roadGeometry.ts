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
 * helpers position enemies, towers, pads, heroes, effects and beams, so the
 * renderer and the simulation can never disagree about which route an enemy is
 * on.
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

/** A deterministic build pad attached to one edge of the graph. */
export interface RoadPad {
  id: string;
  /** Node the pad is associated with (nearest endpoint). */
  nodeId: string;
  position: Point;
  /** Facing angle toward the edge center (for art). */
  angle: number;
  /** Pad on the opposite side of the edge. */
  partnerId: string;
  /** Path position used by the simulation for gate congestion. */
  roadPosition: number;
  /** Edge this pad belongs to. */
  edgeKey: string;
  edgeFrom: string;
  edgeTo: string;
  /** 0..1 along the edge. */
  fraction: number;
}

const PAD_STEP = 110;
const PAD_OFFSET = 62;
/** Keep pads clear of the node rings at each end of an edge. */
const PAD_INSET = 0.16;
const MAX_PADS_PER_EDGE = 3;

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
 * Builds deterministic tower pads along every edge.
 *
 * Pads are stable for a map (edge order + index), sit on both sides of each
 * edge, and are attached to the nearest endpoint so tower coverage matches the
 * simulation's `enemy.path.indexOf(nodeId)` rule.
 */
export function buildRoadPads(geometry: MapRoadGeometry): RoadPad[] {
  const pads: RoadPad[] = [];
  let group = 0;

  for (const key of geometry.edgeOrder) {
    const edge = geometry.edges[key];
    if (edge.length <= 0) {
      continue;
    }
    const depthFrom = geometry.positions[edge.from]?.depth ?? 0;
    const count = Math.max(
      1,
      Math.min(MAX_PADS_PER_EDGE, Math.round(edge.length / PAD_STEP)),
    );
    for (let i = 0; i < count; i += 1) {
      const rawFraction = (i + 0.5) / count;
      const fraction = Math.max(
        PAD_INSET,
        Math.min(1 - PAD_INSET, rawFraction),
      );
      const center = pointOnEdgeGeometry(edge, fraction);
      const ahead = pointOnEdgeGeometry(edge, Math.min(1, fraction + 0.02));
      const behind = pointOnEdgeGeometry(edge, Math.max(0, fraction - 0.02));
      const tangent = normalize({ x: ahead.x - behind.x, y: ahead.y - behind.y });
      const perpendicular = { x: -tangent.y, y: tangent.x };
      const nodeId = fraction < 0.5 ? edge.from : edge.to;
      const roadPosition = depthFrom + fraction;
      group += 1;
      const leftId = `pad-${group}L`;
      const rightId = `pad-${group}R`;
      const leftPosition = {
        x: center.x + perpendicular.x * PAD_OFFSET,
        y: center.y + perpendicular.y * PAD_OFFSET,
      };
      const rightPosition = {
        x: center.x - perpendicular.x * PAD_OFFSET,
        y: center.y - perpendicular.y * PAD_OFFSET,
      };
      pads.push(
        {
          id: leftId,
          nodeId,
          position: leftPosition,
          angle: Math.atan2(center.y - leftPosition.y, center.x - leftPosition.x),
          partnerId: rightId,
          roadPosition,
          edgeKey: key,
          edgeFrom: edge.from,
          edgeTo: edge.to,
          fraction,
        },
        {
          id: rightId,
          nodeId,
          position: rightPosition,
          angle: Math.atan2(
            center.y - rightPosition.y,
            center.x - rightPosition.x,
          ),
          partnerId: leftId,
          roadPosition,
          edgeKey: key,
          edgeFrom: edge.from,
          edgeTo: edge.to,
          fraction,
        },
      );
    }
  }

  return pads;
}
