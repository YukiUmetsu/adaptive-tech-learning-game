import { Link, useParams } from "react-router-dom";

import DailyMissionRunner from "../components/DailyMissionRunner";
import { useDailyMission } from "../hooks/useDailyMission";

/**
 * Standalone Daily Mission route.
 *
 * Kept for deep links; the Track Hub embeds the same runner so the mission feels
 * like part of the hub rather than a separate page.
 */
export default function DailyMissionPage() {
  const { certificationId } = useParams();
  const trackId = certificationId ?? "";
  const { state, reload } = useDailyMission({
    trackId,
    enabled: Boolean(trackId),
  });

  if (state.status === "loading" || state.status === "idle") {
    return <p role="status">Loading Daily Mission…</p>;
  }

  if (state.status === "error") {
    return (
      <section className="daily-runner">
        <h1>Daily Mission unavailable</h1>
        <p className="muted">
          You can keep studying with the regular quizzes from the dashboard.
        </p>
        <Link to={`/tracks/${trackId}`}>Back to dashboard</Link>
      </section>
    );
  }

  return (
    <DailyMissionRunner
      trackId={trackId}
      mission={state.mission}
      onRefresh={() => void reload()}
    />
  );
}
