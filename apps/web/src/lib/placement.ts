/**
 * Placement math for the two-dimensional map.
 *
 * Canonical answers are tolerant regions in `0..=1`; the map only needs to keep
 * a marker fully inside its bounds, which the caller handles here.
 */

export interface PlacementPosition {
  x: number;
  y: number;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Clamps a marker centre so the whole marker stays inside the plane.
 *
 * `markerWidth`/`markerHeight` are pixels; `planeWidth`/`planeHeight` are
 * pixels. When the plane has not been measured yet the value is only clamped to
 * `0..=1`.
 */
export function clampPlacement(
  x: number,
  y: number,
  planeWidth: number,
  planeHeight: number,
  markerWidth: number,
  markerHeight: number,
): PlacementPosition {
  if (planeWidth <= 0 || planeHeight <= 0) {
    return { x: clamp01(x), y: clamp01(y) };
  }
  const minX = markerWidth / 2 / planeWidth;
  const minY = markerHeight / 2 / planeHeight;
  return {
    x: Math.min(Math.max(x, minX), 1 - minX),
    y: Math.min(Math.max(y, minY), 1 - minY),
  };
}
