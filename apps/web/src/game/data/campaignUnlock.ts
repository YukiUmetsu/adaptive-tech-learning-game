import type { MissionDefinition } from "../models/mission";
import type { GameProgress } from "../persistence/gameProgress";

/**
 * Cross-device campaign unlock rules.
 *
 * Once the Stage 2 profile exists, the server's campaign state is authoritative:
 * completion on one device unlocks the next mission on every other device even
 * when local storage is empty. Local Stage 1 progress is only a fallback before
 * the profile (or its legacy import) is available. One shared helper so the
 * dashboard and the mission page can never disagree (Stage2.md step 18 / fix).
 */

/** One server campaign result row, trimmed to what unlocking needs. */
export interface ServerCampaignEntry {
  mission_id: string;
  completed: boolean;
}

/** Whether a mission is complete, preferring server state when present. */
export function isCyberCampaignMissionComplete(
  missionId: string,
  serverCampaign: readonly ServerCampaignEntry[] | null,
  localProgress: GameProgress,
): boolean {
  if (serverCampaign) {
    const row = serverCampaign.find((entry) => entry.mission_id === missionId);
    return row?.completed === true;
  }
  return localProgress.missions[missionId]?.completed === true;
}

/**
 * Whether a mission's prerequisite is satisfied.
 *
 * `serverCampaign` is `null` only before a profile snapshot exists; passing an
 * empty array means "known to the server and nothing is complete", which must
 * not fall back to stale local storage.
 */
export function isCyberCampaignMissionUnlocked(
  mission: MissionDefinition,
  serverCampaign: readonly ServerCampaignEntry[] | null,
  localProgress: GameProgress,
): boolean {
  if (!mission.requiresMissionId) {
    return true;
  }
  return isCyberCampaignMissionComplete(
    mission.requiresMissionId,
    serverCampaign,
    localProgress,
  );
}
