import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimMissionCelebration,
  resetMissionCelebrations,
} from "./celebration";

beforeEach(() => {
  resetMissionCelebrations();
});

describe("mission celebration guard", () => {
  it("claims each mission exactly once", () => {
    expect(claimMissionCelebration("mission-1")).toBe(true);
    expect(claimMissionCelebration("mission-1")).toBe(false);
    expect(claimMissionCelebration("mission-1")).toBe(false);
  });

  it("celebrates a different mission independently", () => {
    expect(claimMissionCelebration("mission-1")).toBe(true);
    expect(claimMissionCelebration("mission-2")).toBe(true);
  });

  it("ignores an empty mission id", () => {
    expect(claimMissionCelebration("")).toBe(false);
  });

  it("does not replay after a page reload", async () => {
    expect(claimMissionCelebration("mission-reload")).toBe(true);

    vi.resetModules();
    const reloaded = await import("./celebration");
    expect(reloaded.claimMissionCelebration("mission-reload")).toBe(false);
  });
});
