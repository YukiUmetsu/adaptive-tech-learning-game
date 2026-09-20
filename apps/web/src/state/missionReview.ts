import { api } from "../api/client";
import type { MissionReviewResponse } from "../api/types";

/**
 * Read-only review of a completed Daily Mission item.
 *
 * Best-effort: a failure resolves to `null` and the UI hides the review action.
 * Review never creates evidence or changes scores.
 */
export async function loadDailyItemReview(
  dailyMissionId: string,
  position: number,
): Promise<MissionReviewResponse | null> {
  try {
    const result = await api.GET(
      "/v1/daily-missions/{mission_id}/items/{position}/review",
      {
        params: { path: { mission_id: dailyMissionId, position } },
      },
    );
    if (result.error || !result.data) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/** Read-only review of any completed mission. */
export async function loadMissionReview(
  missionId: string,
): Promise<MissionReviewResponse | null> {
  try {
    const result = await api.GET("/v1/missions/{mission_id}/review", {
      params: { path: { mission_id: missionId } },
    });
    if (result.error || !result.data) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}
