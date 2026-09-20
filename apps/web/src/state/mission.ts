import { api } from "../api/client";
import type { MissionResponse, QuizMode } from "../api/types";
import { getDeviceId, saveMission } from "./persistence";

/** Options for issuing a mission. */
export interface StartMissionOptions {
  certificationId: string;
  certificationVersion: string;
  mode: QuizMode;
  /** Required for `domain_quiz`. */
  domainId?: string;
  /** Required for `task_practice`. */
  taskId?: string;
  /** Anchor question for `recommended_practice`. Server-validated. */
  questionId?: string;
  /** Recommendation that produced this mission, when recommended. */
  recommendationId?: string;
}

/**
 * Issues a mission and stores it as the active local mission.
 *
 * The server chooses the questions; this only records the server-issued mission
 * so the learning session can run locally.
 */
export async function startMission(
  options: StartMissionOptions,
): Promise<MissionResponse> {
  const result = await api.POST("/v1/missions/issue", {
    body: {
      device_id: getDeviceId(),
      certification_id: options.certificationId,
      certification_version: options.certificationVersion,
      mode: options.mode,
      domain_id: options.domainId ?? null,
      task_id: options.taskId ?? null,
      question_id: options.questionId ?? null,
      recommendation_id: options.recommendationId ?? null,
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
