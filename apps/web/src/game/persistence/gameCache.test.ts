import { beforeEach, describe, expect, it } from "vitest";

import { GAME_CATALOG } from "../data";
import { MISSIONS_BY_ID } from "../data/missions";
import { createInitialState } from "../engine/simulation";
import { clearSession, loadSession, saveSession } from "./gameCache";

const mission = MISSIONS_BY_ID["ddos-basics"];
const KEY = "adaptive-learn.cyber-defense-session.v1";

beforeEach(() => {
  window.localStorage.clear();
});

describe("gameCache", () => {
  it("round-trips a mission snapshot", () => {
    const state = createInitialState(mission, GAME_CATALOG);
    saveSession(state);
    const loaded = loadSession(mission.id);
    expect(loaded?.missionId).toBe(mission.id);
    expect(loaded?.budget).toBe(mission.startingBudget);
  });

  it("returns null for a snapshot from an older schema version", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        missionId: mission.id,
        savedAt: new Date().toISOString(),
        state: { missionId: mission.id, phase: "prep" },
      }),
    );
    expect(loadSession(mission.id)).toBeNull();
  });

  it("rejects a snapshot missing arrays the board reads", () => {
    const state = createInitialState(mission, GAME_CATALOG);
    const withoutEngagements: Record<string, unknown> = { ...state };
    delete withoutEngagements["engagements"];
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 2,
        missionId: mission.id,
        savedAt: new Date().toISOString(),
        state: withoutEngagements,
      }),
    );
    expect(loadSession(mission.id)).toBeNull();
  });

  it("ignores a snapshot for a different mission", () => {
    saveSession(createInitialState(mission, GAME_CATALOG));
    expect(loadSession("sql-injection")).toBeNull();
  });

  it("clears the snapshot", () => {
    saveSession(createInitialState(mission, GAME_CATALOG));
    clearSession();
    expect(loadSession(mission.id)).toBeNull();
  });
});
