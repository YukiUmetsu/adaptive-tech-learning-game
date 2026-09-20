import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";

import type { AuthStatus } from "../auth/context";
import { useDailyMission } from "../hooks/useDailyMission";
import { completedItemCount, dailyActivityPresentation } from "../state/dailyMission";
import { loadTrackDiscovery } from "../state/learningProgress";

interface DailyMissionCardProps {
  /** Learning track identifier. */
  trackId: string;
  /** Learning track version identifier, used to read local discovery progress. */
  trackVersion: string;
  /** Coarse auth state. Anonymous learners get a sign-in prompt instead. */
  authStatus: AuthStatus;
}

/**
 * Optional "Daily Mission" section for a learning track dashboard.
 *
 * The mission is a server-persisted, immutable snapshot for the day, so this
 * always shows the same plan with checkmarks retained. If loading fails, the
 * section hides and every existing study control stays available.
 */
export default function DailyMissionCard({
  trackId,
  trackVersion,
  authStatus,
}: DailyMissionCardProps) {
  const enabled = authStatus === "authenticated";
  const location = useLocation();
  const discovery = useMemo(
    () => (enabled ? loadTrackDiscovery(trackVersion) : []),
    [enabled, trackVersion],
  );
  const { state } = useDailyMission({ trackId, enabled, discovery });

  if (authStatus === "anonymous") {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <section
        className="daily-mission daily-mission-signin"
        aria-label="Daily mission"
      >
        <div>
          <p className="daily-mission-kicker">Daily Mission</p>
          <h2 className="daily-mission-title">
            Sign in to get today&apos;s Daily Mission
          </h2>
          <p className="muted">
            A short personalized plan, saved for the rest of the day.
          </p>
        </div>
        <Link
          className="primary daily-mission-cta"
          to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        >
          Sign in
        </Link>
      </section>
    );
  }

  if (state.status !== "loaded") {
    return null;
  }

  const mission = state.mission;
  const completed = completedItemCount(mission.items);
  const total = mission.items.length;
  const done = mission.status === "completed";
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <section className="daily-mission" aria-label="Daily mission">
      <header className="daily-mission-head">
        <div>
          <p className="daily-mission-kicker">Daily Mission</p>
          <h2 className="daily-mission-title">
            {done ? "Today's mission complete" : "Today's study plan"}
          </h2>
          <p className="muted daily-mission-progress-label">
            {completed} / {total} complete
            {done ? ` · +${mission.reward_bits} Bits earned` : ""}
          </p>
        </div>
        <Link className="primary daily-mission-cta" to={`/tracks/${trackId}/daily`}>
          {done ? "Review mission" : "Continue Daily Mission"}
        </Link>
      </header>

      <div
        className="daily-mission-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-label="Daily Mission progress"
      >
        <div
          className="daily-mission-progress-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="daily-mission-list">
        {mission.items.map((item) => {
          const presentation = dailyActivityPresentation(item);
          const isDone = item.status === "completed";
          return (
            <li
              key={item.position}
              className={`daily-mission-item${isDone ? " daily-mission-item-done" : ""}`}
            >
              <span className="daily-mission-check" aria-hidden="true">
                {isDone ? "✓" : "○"}
              </span>
              <span className="daily-mission-icon" aria-hidden="true">
                {presentation.icon}
              </span>
              <span className="daily-mission-item-body">
                <span className="daily-mission-item-title">
                  {presentation.primary}
                </span>
                <span className="muted daily-mission-item-meta">
                  {presentation.kind} · {item.domain_name}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
