/**
 * Geometry shared by directed-connection interactions.
 *
 * Both `node_connection` and graph `reconstruction` draw directed edges between
 * positioned nodes. Keeping the math here avoids two subtly different
 * implementations.
 */

export const FALLBACK_RADIUS_PX = 34;
export const EDGE_PADDING_PX = 8;

export interface Point {
  x: number;
  y: number;
}

export interface NodeSize {
  width: number;
  height: number;
}

/** Distance from a node's centre to its boundary along `(ux, uy)`. */
export function boundaryOffset(
  size: NodeSize | undefined,
  ux: number,
  uy: number,
): number {
  if (!size || size.width === 0 || size.height === 0) {
    return FALLBACK_RADIUS_PX;
  }
  const radiusX = size.width / 2 + EDGE_PADDING_PX;
  const radiusY = size.height / 2 + EDGE_PADDING_PX;
  const denominator = Math.hypot(ux / radiusX, uy / radiusY);
  return denominator > 0 ? 1 / denominator : FALLBACK_RADIUS_PX;
}

/**
 * Keeps a node's centre inside `0..extent` so a centred pill is never clipped
 * by the canvas edge.
 *
 * Authored positions run `0..=1`, so a node centered exactly on an edge would
 * otherwise have half of its label cut off. `half` is the node's half-size
 * along the axis. When the node is wider than the canvas it is centered, since
 * no position can fully contain it.
 */
export function clampNodeCenter(
  value: number,
  half: number,
  extent: number,
): number {
  if (extent <= 0) {
    return value;
  }
  const center = extent / 2;
  const min = Math.min(half, center);
  const max = Math.max(extent - half, center);
  return Math.min(max, Math.max(min, value));
}

/** Line between two node boundaries, so arrowheads are not hidden under a pill. */
export function edgeGeometry(
  start: Point,
  end: Point,
  startSize?: NodeSize,
  endSize?: NodeSize,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const startOffset = Math.min(boundaryOffset(startSize, ux, uy), distance / 2);
  const endOffset = Math.min(
    boundaryOffset(endSize, ux, uy),
    distance / 2,
  );

  return {
    x1: start.x + ux * startOffset,
    y1: start.y + uy * startOffset,
    x2: end.x - ux * endOffset,
    y2: end.y - uy * endOffset,
  };
}
