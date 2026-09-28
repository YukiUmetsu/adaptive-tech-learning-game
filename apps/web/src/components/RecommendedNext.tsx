import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { RecommendationReason } from "../api/types";
import { useRecommendation } from "../hooks/useRecommendation";
import { loadTrackDiscovery } from "../state/learningProgress";
import { startMission } from "../state/mission";
import { reportRecommendationEvent } from "../state/recommendation";
import InlineText from "./InlineText";

interface RecommendedNextProps {
  /** Learning track identifier. */
  trackId: string;
  /** Learning track version identifier, used to start practice. */
  trackVersion: string;
  /** Whether the learner is authenticated; anonymous learners see nothing. */
  enabled: boolean;
}

const REASON_LABELS: Record<RecommendationReason, string> = {
  cold_start: "Start here",
  weak_concept: "A weak area worth building up",
  weak_prerequisite: "A prerequisite to shore up first",
  needs_practice: "Worth a retrieval attempt",
  stale_knowledge: "Due for review",
  domain_review: "A broad domain review",
  strong_and_fresh: "Ready for a harder challenge",
  targeted_remediation: "A targeted review of a recent mistake",
};

/**
 * Optional "Recommended next" section for a learning track dashboard.
 *
 * Recommendations are auxiliary: while loading, on any fetch error, or when the
 * planner has nothing to suggest, this renders nothing. It never blocks the
 * dashboard, knowledge maps, or quizzes, and a failed practice launch is shown
 * inline rather than as a page error.
 *
 * Lifecycle reporting is best-effort and never treated as learning evidence.
 */
export default function RecommendedNext({
  trackId,
  trackVersion,
  enabled,
}: RecommendedNextProps) {
  const discovery = useMemo(
    () => (enabled ? loadTrackDiscovery(trackVersion) : []),
    [enabled, trackVersion],
  );
  const { state } = useRecommendation({ trackId, enabled, discovery });
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Report "shown" once per recommendation id; a GET is not proof of showing.
  const shownRef = useRef<string | null>(null);

  const recommendationId =
    state.status === "loaded" ? state.recommendationId : null;
  const recommendation =
    state.status === "loaded" ? state.recommendation : null;

  useEffect(() => {
    if (!recommendation || !recommendationId || shownRef.current === recommendationId) {
      return;
    }
    shownRef.current = recommendationId;
    void reportRecommendationEvent({
      trackId,
      recommendationId,
      event: "shown",
      action: recommendation.action,
      domainId: recommendation.domain_id,
      nodeId: recommendation.node_id,
      questionId: recommendation.question_id,
    });
  }, [recommendation, recommendationId, trackId]);

  if (!recommendation) {
    return null;
  }

  const opensMap =
    recommendation.action === "learn_node" ||
    recommendation.action === "review_node";

  const reportClicked = () => {
    if (!recommendationId) {
      return;
    }
    void reportRecommendationEvent({
      trackId,
      recommendationId,
      event: "clicked",
      action: recommendation.action,
      domainId: recommendation.domain_id,
      nodeId: recommendation.node_id,
      questionId: recommendation.question_id,
    });
  };

  const start = async () => {
    reportClicked();

    if (opensMap) {
      if (recommendationId) {
        void reportRecommendationEvent({
          trackId,
          recommendationId,
          event: "node_opened",
          action: recommendation.action,
          domainId: recommendation.domain_id,
          nodeId: recommendation.node_id,
        });
      }
      const search = recommendation.node_id
        ? `?node=${encodeURIComponent(recommendation.node_id)}`
        : "";
      navigate(
        `/tracks/${trackId}/domains/${recommendation.domain_id}/learn${search}`,
      );
      return;
    }

    setStarting(true);
    setError(null);
    try {
      // A recommended question uses the focused recommended-practice mission so
      // the exact question is guaranteed to be practiced. If no anchor is
      // available, fall back to a domain quiz rather than failing.
      const useRecommendedQuestion =
        recommendation.action === "practice_question" &&
        recommendation.question_id != null;

      const mission = await startMission(
        useRecommendedQuestion
          ? {
              certificationId: trackId,
              certificationVersion: trackVersion,
              mode: "recommended_practice",
              questionId: recommendation.question_id ?? undefined,
              recommendationId: recommendationId ?? undefined,
            }
          : {
              certificationId: trackId,
              certificationVersion: trackVersion,
              mode: "domain_quiz",
              domainId: recommendation.domain_id,
              recommendationId: recommendationId ?? undefined,
            },
      );
      navigate(`/missions/${mission.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not start practice.",
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="recommended-next" aria-label="Recommended next">
      <div className="recommended-next-body">
        <p className="recommended-next-kicker">Recommended next</p>
        <h2 className="recommended-next-title">
          <InlineText text={recommendation.title} />
        </h2>
        <p className="recommended-next-reason muted">
          {REASON_LABELS[recommendation.reason] ?? "Suggested next step"}
        </p>
      </div>
      <button
        type="button"
        className="primary"
        disabled={starting}
        onClick={() => void start()}
      >
        {starting ? "Starting…" : opensMap ? "Open map" : "Start practice"}
      </button>
      {error ? (
        <p role="alert" className="recommended-next-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
