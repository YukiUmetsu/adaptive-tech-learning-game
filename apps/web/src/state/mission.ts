import { api } from "../api/client";
import type { CatalogResponse, MissionResponse, QuizMode } from "../api/types";
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
  /** Required for `section_quiz`: the learning module (section) to quiz. */
  moduleId?: string;
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
      module_id: options.moduleId ?? null,
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

/**
 * Starts (or resumes) the server-issued mission for a Daily Mission item.
 */
export async function startDailyItem(options: {
  dailyMissionId: string;
  position: number;
}): Promise<MissionResponse> {
  const result = await api.POST(
    "/v1/daily-missions/{mission_id}/items/{position}/start",
    {
      params: {
        path: {
          mission_id: options.dailyMissionId,
          position: options.position,
        },
      },
    },
  );

  if (result.error || !result.data) {
    throw new Error(`Could not start activity (HTTP ${result.response.status})`);
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

/**
 * Resolves a mission's domain name, scoped to its own track and version.
 *
 * Domain ids (`domain-3`) are only unique within a track, so an unscoped lookup
 * can return another track's domain name. Always resolve against the mission's
 * certification/version.
 */
export function missionDomainName(
  mission: Pick<
    MissionResponse,
    "certification_id" | "certification_version" | "domain_id"
  >,
  catalog: CatalogResponse,
): string | undefined {
  if (!mission.domain_id) {
    return undefined;
  }
  const certification = catalog.certifications.find(
    (entry) => entry.id === mission.certification_id,
  );
  const version =
    certification?.versions.find(
      (entry) => entry.id === mission.certification_version,
    ) ?? certification?.versions[0];
  return version?.domains.find((domain) => domain.id === mission.domain_id)?.name;
}
