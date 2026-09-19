import { describe, expect, it } from "vitest";

import { shuffledOrder, stableShuffle } from "./shuffle";

function expectPermutation(result: string[], input: string[]): void {
  expect(result).toHaveLength(input.length);
  expect([...result].sort()).toEqual([...input].sort());
}

describe("stableShuffle", () => {
  it("is deterministic for a given seed", () => {
    const input = ["a", "b", "c", "d", "e"];
    expect(stableShuffle(input, "seed")).toEqual(stableShuffle(input, "seed"));
  });

  it("preserves the multiset", () => {
    expectPermutation(stableShuffle(["a", "b", "c", "d"], "q1"), [
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("shuffledOrder", () => {
  it("never presents the authored order for multiple items", () => {
    const input = ["a", "b", "c", "d", "e", "f"];
    for (const seed of ["q1", "q2", "q3", "q4", "q5", "q6", "q7"]) {
      const result = shuffledOrder(input, seed);
      expectPermutation(result, input);
      expect(result).not.toEqual(input);
    }
  });

  it("leaves a single item unchanged", () => {
    expect(shuffledOrder(["only"], "q1")).toEqual(["only"]);
  });

  it("leaves an empty list unchanged", () => {
    expect(shuffledOrder([], "q1")).toEqual([]);
  });
});
