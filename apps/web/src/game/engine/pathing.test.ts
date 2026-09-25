import { describe, expect, it } from "vitest";

import { MISSIONS_BY_ID } from "../data/missions";
import { computePath } from "./pathing";

const mission = MISSIONS_BY_ID["sql-injection"];

describe("computePath", () => {
  it("returns the full route from entry to target", () => {
    const { path, reachable } = computePath(mission.map, "db");
    expect(reachable).toBe(true);
    expect(path).toEqual(["internet", "api", "app", "db"]);
  });

  it("returns a shorter route for earlier targets", () => {
    expect(computePath(mission.map, "app").path).toEqual([
      "internet",
      "api",
      "app",
    ]);
  });

  it("reports an unreachable target instead of throwing", () => {
    const result = computePath(mission.map, "does-not-exist");
    expect(result.reachable).toBe(false);
    expect(result.path).toEqual([]);
  });

  it("is deterministic across calls", () => {
    expect(computePath(mission.map, "db").path).toEqual(
      computePath(mission.map, "db").path,
    );
  });
});
