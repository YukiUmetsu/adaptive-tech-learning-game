import { beforeEach, describe, expect, it } from "vitest";

import { MISSIONS_BY_ID } from "../data/missions";
import {
  defaultProgress,
  isMissionUnlocked,
  readStoredProgress,
  recordMissionResult,
  resetGameProgress,
} from "./gameProgress";

beforeEach(() => {
  window.localStorage.clear();
  resetGameProgress();
});

describe("game progress", () => {
  it("starts with every control unlocked", () => {
    const progress = defaultProgress();
    expect(progress.unlockDefenses).toContain("mfa");
    expect(progress.unlockHeroes).toContain("security_engineer");
  });

  it("records stars and health, keeping the best result", () => {
    recordMissionResult("ddos-basics", {
      completed: true,
      stars: 2,
      health: 80,
    });
    recordMissionResult("ddos-basics", {
      completed: true,
      stars: 3,
      health: 70,
    });
    const entry = readStoredProgress().missions["ddos-basics"];
    expect(entry).toEqual({
      completed: true,
      stars: 3,
      bestHealth: 80,
      attempts: 2,
    });
  });

  it("keeps completion once a mission is cleared", () => {
    recordMissionResult("ddos-basics", {
      completed: true,
      stars: 3,
      health: 90,
    });
    recordMissionResult("ddos-basics", {
      completed: false,
      stars: 0,
      health: 0,
    });
    expect(readStoredProgress().missions["ddos-basics"].completed).toBe(true);
  });

  it("locks the boss mission until the previous mission is completed", () => {
    const boss = MISSIONS_BY_ID["botnet-boss"];
    expect(isMissionUnlocked(boss)).toBe(false);
    recordMissionResult("mixed-defense", {
      completed: true,
      stars: 1,
      health: 10,
    });
    expect(isMissionUnlocked(boss)).toBe(true);
  });

  it("resets to defaults", () => {
    recordMissionResult("ddos-basics", {
      completed: true,
      stars: 3,
      health: 90,
    });
    resetGameProgress();
    expect(readStoredProgress().missions).toEqual({});
  });
});
