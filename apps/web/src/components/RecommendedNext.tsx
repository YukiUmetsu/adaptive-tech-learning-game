import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { RecommendationReason } from "../api/types";
import { useRecommendation } from "../hooks/useRecommendation";
import { loadTrackExploredNodeIds } from "../state/learningProgress";
import { startMission } from "../state/mission";

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
};

/**
 * Optional "Recommended next" section for a learning track dashboard.
 *
 * Recommendations are auxiliary: while loading, on any fetch error, or when the
 * planner has nothing to suggest, this renders nothing. It never blocks the
 * dashboard, knowledge maps, or quizzes, and a failed practice launch is shown
 * inline rather than as a page error.
 */
export default function RecommendedNext({
  trackId,
  trackVersion,
  enabled,
}: RecommendedNextProps) {
  const exploredNodeIds = useMemo(
    () => (enabled ? loadTrackExploredNodeIds(trackVersion) : []),
    [enabled, trackVersion],
  );
  const { state } = useRecommendation({ trackId, enabled, exploredNodeIds });
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== "loaded" || !state.data) {
    return null;
  }

  const recommendation = state.data;
  const opensMap =
    recommendation.action === "learn_node" ||
    recommendation.action === "review_node";

  const start = async () => {
    if (opensMap) {
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
      const mission = await startMission({
        certificationId: trackId,
        certificationVersion: trackVersion,
        mode: "domain_quiz",
        domainId: recommendation.domain_id,
      });
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
        <h2 className="recommended-next-title">{recommendation.title}</h2>
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
