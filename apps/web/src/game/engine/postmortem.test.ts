import { describe, expect, it } from "vitest";

import { GAME_CATALOG } from "../data";
import { MISSIONS_BY_ID } from "../data/missions";
import { buildPostmortem } from "./postmortem";
import {
  createInitialState,
  placeDefense,
  startFirstWave,
  stepSimulation,
  type GameState,
} from "./simulation";

function runMission(
  missionId: string,
  place: Array<[string, string]>,
): GameState {
  const mission = MISSIONS_BY_ID[missionId];
  let state = createInitialState(mission, GAME_CATALOG);
  for (const [defenseId, nodeId] of place) {
    const node = mission.map.nodes.find((item) => item.id === nodeId);
    if (!node) {
      throw new Error(`node ${nodeId} not in map`);
    }
    state = placeDefense(
      state,
      {
        defenseId,
        nodeId,
        nodeType: node.type,
        padId: `${nodeId}-p${state.placed.length}`,
      },
      GAME_CATALOG,
    ).state;
  }
  state = startFirstWave(state, mission);
  let elapsed = 0;
  while (state.phase === "running" && elapsed < 600_000) {
    state = stepSimulation(state, 250, { mission, catalog: GAME_CATALOG });
    elapsed += 250;
  }
  return state;
}

describe("buildPostmortem", () => {
  it("reports a clean win with three stars and a lesson", () => {
    const state = runMission("ddos-basics", [
      ["traffic_analyzer", "internet"],
      ["traffic_blocker", "edge"],
    ]);
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const report = buildPostmortem(state, mission, GAME_CATALOG);

    expect(report.completed).toBe(true);
    expect(report.stars).toBe(3);
    expect(report.blockedTotal).toBeGreaterThan(0);
    expect(report.blocked.length).toBeGreaterThan(0);
    expect(report.mostEffectiveDefense).toBeDefined();
    expect(report.message).toBe(mission.lessons.completion);
    expect(report.bitsPreview).toBe(60);
  });

  it("reports the primary cause and lesson on failure", () => {
    const state = runMission("ddos-basics", []);
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const report = buildPostmortem(state, mission, GAME_CATALOG);

    expect(report.completed).toBe(false);
    expect(report.stars).toBe(0);
    expect(report.primaryCause?.attackType).toBe("ddos");
    expect(report.message).toBe(mission.lessons.failure?.ddos);
    expect(report.bitsPreview).toBe(0);
  });
});
