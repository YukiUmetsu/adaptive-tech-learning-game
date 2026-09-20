import type { Streak } from "../state/streak";

interface StreakHudProps {
  streak: Streak;
  /** Briefly pulses the flame when today's streak just activated. */
  justActivated?: boolean;
}

/**
 * Compact account-wide streak HUD.
 *
 * Never punishing: an inactive day is quiet and dim, and a broken streak reads
 * as "start a streak today" rather than "you lost your streak". A lost streak is
 * never announced.
 */
export default function StreakHud({ streak, justActivated = false }: StreakHudProps) {
  const active = streak.activeToday;
  const label = active
    ? "day streak"
    : streak.current > 0
      ? "study today to keep it"
      : "start a streak today";

  const aria = active
    ? `${streak.current} day study streak, active today`
    : streak.current > 0
      ? `${streak.current} day study streak, not active today`
      : "No study streak yet; study today to start one";

  return (
    <div
      className={`streak-hud${active ? " streak-hud--active" : " streak-hud--quiet"}${
        justActivated ? " streak-hud--pulse" : ""
      }`}
      aria-label={aria}
    >
      <span className="streak-flame" aria-hidden="true">
        🔥
      </span>
      <span className="streak-body">
        <span className="streak-count">{streak.current}</span>
        <span className="streak-label">{label}</span>
      </span>
    </div>
  );
}
