import { describe, expect, it } from "vitest";

import { GAME_CATALOG } from "./index";
import {
  isCyberCampaignMissionComplete,
  isCyberCampaignMissionUnlocked,
  type ServerCampaignEntry,
} from "./campaignUnlock";
import { defaultProgress } from "../persistence/gameProgress";

const lockedMission = GAME_CATALOG.missionsById["botnet-boss"];
const firstMission = GAME_CATALOG.missionsById["ddos-basics"];

/** A progress model where one mission was completed locally. */
function localCompleted(missionId: string) {
  return {
    ...defaultProgress(),
    missions: {
      [missionId]: { completed: true, stars: 3, bestHealth: 90, attempts: 1 },
    },
  };
}

describe("isCyberCampaignMissionUnlocked", () => {
  it("unlocks the next mission from server state with empty local storage", () => {
    const server: ServerCampaignEntry[] = [
      { mission_id: "mixed-defense", completed: true },
    ];
    expect(
      isCyberCampaignMissionUnlocked(lockedMission, server, defaultProgress()),
    ).toBe(true);
  });

  it("stays locked when neither source completed the prerequisite", () => {
    expect(
      isCyberCampaignMissionUnlocked(lockedMission, [], defaultProgress()),
    ).toBe(false);
  });

  it("keeps working for legacy local completion before migration", () => {
    expect(
      isCyberCampaignMissionUnlocked(
        lockedMission,
        null,
        localCompleted("mixed-defense"),
      ),
    ).toBe(true);
  });

  it("lets server state take precedence over stale local completion", () => {
    const server: ServerCampaignEntry[] = [
      { mission_id: "mixed-defense", completed: false },
    ];
    expect(
      isCyberCampaignMissionUnlocked(
        lockedMission,
        server,
        localCompleted("mixed-defense"),
      ),
    ).toBe(false);
  });

  it("always unlocks the first mission", () => {
    expect(
      isCyberCampaignMissionUnlocked(firstMission, [], defaultProgress()),
    ).toBe(true);
    expect(
      isCyberCampaignMissionComplete("ddos-basics", [], defaultProgress()),
    ).toBe(false);
  });
});
