import { describe, expect, it } from "vitest";

import { clampPlacement } from "./placement";

describe("clampPlacement", () => {
  it("keeps the marker centre away from the left and bottom edges", () => {
    // Plane 400x300, marker 80x40 -> minX = 0.1, minY = 20/300.
    const result = clampPlacement(0, 0, 400, 300, 80, 40);
    expect(result.x).toBeCloseTo(0.1);
    expect(result.y).toBeCloseTo(20 / 300);
  });

  it("keeps the marker centre away from the right and top edges", () => {
    const result = clampPlacement(1, 1, 400, 300, 80, 40);
    expect(result.x).toBeCloseTo(0.9);
    expect(result.y).toBeCloseTo(1 - 20 / 300);
  });

  it("passes through interior positions", () => {
    expect(clampPlacement(0.4, 0.6, 400, 300, 80, 40)).toEqual({
      x: 0.4,
      y: 0.6,
    });
  });

  it("only clamps to 0..1 when the plane is not measured", () => {
    expect(clampPlacement(1.5, -0.2, 0, 0, 80, 40)).toEqual({ x: 1, y: 0 });
  });
});
