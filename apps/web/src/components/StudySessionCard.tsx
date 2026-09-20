import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { DomainDto, SessionPreference } from "../api/types";
import { useStudySession } from "../hooks/useStudySession";
import { loadTrackDiscovery } from "../state/learningProgress";
import { startMission } from "../state/mission";
import {
  adaptiveSessionPlan,
  buildStandardSession,
  type PlannedActivity,
  type StudySessionPlan,
} from "../state/sessionPlan";

interface StudySessionCardProps {
  /** Learning track identifier. */
  trackId: string;
  /** Learning track version identifier, used to start practice. */
  trackVersion: string;
  /** Already-loaded domains, used for the standard fallback. */
  domains: DomainDto[];
  /** Whether the learner is authenticated; anonymous learners see nothing. */
  enabled: boolean;
}

const DEFAULT_MINUTES = 20;
const MIN_MINUTES = 5;
const SHORTER_STEP = 5;

/**
 * Optional "Your study session" section for a learning track dashboard.
 *
 * Adaptive planning is best-effort. If it is unavailable for any reason, this
 * builds a standard, non-adaptive session from the already-loaded domains, so the
 * learner can still start studying. It never blocks the dashboard, knowledge
 * maps, or quizzes, and a failed start is shown inline.
 */
export default function StudySessionCard({
  trackId,
  trackVersion,
  domains,
  enabled,
}: StudySessionCardProps) {
  const [availableMinutes, setAvailableMinutes] = useState(DEFAULT_MINUTES);
  const [preference, setPreference] = useState<SessionPreference>("balanced");
  const [reloadKey, setReloadKey] = useState(0);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const discovery = useMemo(
    () => (enabled ? loadTrackDiscovery(trackVersion) : []),
    [enabled, trackVersion],
  );

  const { state } = useStudySession({
    trackId,
    enabled,
    availableMinutes,
    preference,
    discovery,
    reloadKey,
  });

  const plan: StudySessionPlan | null = useMemo(() => {
    if (!enabled) {
      return null;
    }
    if (state.status === "loaded" && state.session.activities.length > 0) {
      return adaptiveSessionPlan(state.session);
    }
    if (state.status === "error" || state.status === "loaded") {
      // Adaptive planning failed or returned nothing: fall back to a standard
      // session that needs no learner state or adaptive API.
      return buildStandardSession(domains, availableMinutes);
    }
    // Idle or loading: render nothing rather than flashing a fallback.
    return null;
  }, [enabled, state, domains, availableMinutes]);

  if (!plan || plan.activities.length === 0) {
    return null;
  }

  const startActivity = async (activity: PlannedActivity, key: string) => {
    setError(null);

    if (activity.kind === "learn_node" || activity.kind === "review_node") {
      const search = activity.nodeId
        ? `?node=${encodeURIComponent(activity.nodeId)}`
        : "";
      navigate(`/tracks/${trackId}/domains/${activity.domainId}/learn${search}`);
      return;
    }
    if (activity.kind === "explore_domain") {
      navigate(`/tracks/${trackId}/domains/${activity.domainId}/learn`);
      return;
    }

    setStarting(key);
    try {
      const anchor = activity.questionIds[0];
      const mission = anchor
        ? await startMission({
            certificationId: trackId,
            certificationVersion: trackVersion,
            mode: "recommended_practice",
            questionId: anchor,
          })
        : await startMission({
            certificationId: trackId,
            certificationVersion: trackVersion,
            mode: "domain_quiz",
            domainId: activity.domainId,
          });
      navigate(`/missions/${mission.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not start this activity.",
      );
    } finally {
      setStarting(null);
    }
  };

  return (
    <section className="study-session" aria-label="Study session">
      <header className="study-session-head">
        <div>
          <p className="study-session-kicker">
            {plan.source === "standard" ? "Standard study session" : "Study session"}
          </p>
          <h2 className="study-session-title">
            Your {availableMinutes}-minute session
          </h2>
          <p className="muted">
            About {plan.estimatedMinutes} minutes across {plan.activities.length}{" "}
            {plan.activities.length === 1 ? "activity" : "activities"}.
          </p>
        </div>
        <button
          type="button"
          className="primary"
          disabled={starting !== null}
          onClick={() => void startActivity(plan.activities[0], "first")}
        >
          {starting === "first" ? "Starting…" : "Start study session"}
        </button>
      </header>

      <ol className="study-session-list">
        {plan.activities.map((activity, index) => {
          const key = `${activity.kind}-${activity.domainId}-${activity.nodeId ?? index}`;
          return (
            <li key={key} className="study-session-activity">
              <div>
                <p className="study-session-activity-title">{activity.title}</p>
                <p className="muted study-session-activity-meta">
                  ~{activity.estimatedMinutes} min · {activity.domainName}
                </p>
              </div>
              <button
                type="button"
                disabled={starting !== null}
                aria-label={`Start activity: ${activity.title}`}
                onClick={() => void startActivity(activity, key)}
              >
                {starting === key ? "Starting…" : "Start"}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="study-session-overrides" aria-label="Session options">
        <button
          type="button"
          onClick={() =>
            setAvailableMinutes((minutes) => Math.max(MIN_MINUTES, minutes - SHORTER_STEP))
          }
        >
          Make it shorter
        </button>
        <button
          type="button"
          aria-pressed={preference === "more_practice"}
          onClick={() => setPreference("more_practice")}
        >
          More practice
        </button>
        <button
          type="button"
          aria-pressed={preference === "more_learning"}
          onClick={() => setPreference("more_learning")}
        >
          More learning
        </button>
        <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
          Regenerate
        </button>
      </div>

      {error ? (
        <p role="alert" className="study-session-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
