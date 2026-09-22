import { describe, expect, it } from "vitest";

import { clampNodeCenter } from "./connection";

describe("clampNodeCenter", () => {
  it("leaves an interior node untouched", () => {
    expect(clampNodeCenter(100, 20, 400)).toBe(100);
  });

  it("pulls a node at the left edge inward by its half-size", () => {
    expect(clampNodeCenter(0, 30, 400)).toBe(30);
  });

  it("pulls a node at the right edge inward by its half-size", () => {
    expect(clampNodeCenter(400, 30, 400)).toBe(370);
  });

  it("clamps out-of-range authored points", () => {
    expect(clampNodeCenter(-25, 20, 400)).toBe(20);
    expect(clampNodeCenter(500, 20, 400)).toBe(380);
  });

  it("centers a node wider than the canvas", () => {
    expect(clampNodeCenter(0, 300, 400)).toBe(200);
    expect(clampNodeCenter(400, 300, 400)).toBe(200);
  });

  it("returns the value before the canvas has been measured", () => {
    expect(clampNodeCenter(12, 10, 0)).toBe(12);
  });
});
