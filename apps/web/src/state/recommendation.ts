import type { PlannerAction, RecommendationEventKind } from "../api/types";
import { enqueueAuxiliaryEvent } from "./auxiliaryQueue";

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
 * Queues one recommendation lifecycle event for batched delivery.
 *
 * Telemetry is auxiliary and best-effort. Queueing only writes local storage, so
 * it can never block the learner, the dashboard, or a study session. Events are
 * flushed at natural sync boundaries and are never learning evidence.
 */
export function reportRecommendationEvent(
  options: RecommendationEventOptions,
): void {
  enqueueAuxiliaryEvent({
    trackId: options.trackId,
    recommendationId: options.recommendationId,
    event: options.event,
    action: options.action ?? null,
    domainId: options.domainId ?? null,
    nodeId: options.nodeId ?? null,
    questionId: options.questionId ?? null,
  });
}
