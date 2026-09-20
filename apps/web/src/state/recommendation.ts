import { api } from "../api/client";
import type { PlannerAction, RecommendationEventKind } from "../api/types";

interface RecommendationEventOptions {
  trackId: string;
  recommendationId: string;
  event: RecommendationEventKind;
  action?: PlannerAction | null;
  domainId?: string | null;
  nodeId?: string | null;
  questionId?: string | null;
}

/**
 * Reports one recommendation lifecycle event.
 *
 * Telemetry is auxiliary and best-effort: a failure is swallowed so it can never
 * block the learner, the dashboard, or a study session. It is never learning
 * evidence.
 */
export async function reportRecommendationEvent(
  options: RecommendationEventOptions,
): Promise<void> {
  try {
    await api.POST(
      "/v1/tracks/{track_id}/recommendations/{recommendation_id}/events",
      {
        params: {
          path: {
            track_id: options.trackId,
            recommendation_id: options.recommendationId,
          },
        },
        body: {
          event: options.event,
          action: options.action ?? null,
          domain_id: options.domainId ?? null,
          node_id: options.nodeId ?? null,
          question_id: options.questionId ?? null,
        },
      },
    );
  } catch {
    // Auxiliary: never surface a telemetry failure to the learner.
  }
}
