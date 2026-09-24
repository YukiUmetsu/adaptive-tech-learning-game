import { useFocusDaily } from "../state/focusDaily";

/**
 * Link target for the "Daily missions" navigation entry.
 *
 * Daily Missions are per track, so this points at the most recently active
 * track — the one bridged to the Focus widget while its Daily Mission is open —
 * and falls back to the Learning Tracks page when no track is known yet.
 */
export function useDailyMissionHref(): string {
  const daily = useFocusDaily();
  return daily ? `/tracks/${daily.trackId}/daily` : "/tracks";
}
