import { api } from "../api/client";
import type { MissionResponse } from "../api/types";
import { getDeviceId, saveMission } from "./persistence";

/**
 * Issues a mission and stores it as the active local mission.
 *
 * The server remains authoritative: this only records the server-issued mission
 * so the learning session can run locally.
 */
export async function startMission(
  certificationId: string,
  certificationVersion: string,
  taskId: string,
): Promise<MissionResponse> {
  const result = await api.POST("/v1/missions/issue", {
    body: {
      device_id: getDeviceId(),
      certification_id: certificationId,
      certification_version: certificationVersion,
      task_id: taskId,
    },
  });

  if (result.error || !result.data) {
    throw new Error(`Could not start mission (HTTP ${result.response.status})`);
  }

  saveMission({
    mission: result.data,
    currentIndex: 0,
    attempts: [],
    startedAt: new Date().toISOString(),
    finished: false,
  });

  return result.data;
}
