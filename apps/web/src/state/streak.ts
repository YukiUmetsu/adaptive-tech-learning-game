import { api } from "../api/client";
import type { StreakDto } from "../api/types";

/**
 * Account-wide study streak loading.
 *
 * The streak is bundled into `GET /v1/me`, so no separate endpoint is needed.
 * It is best-effort: a failure resolves to `null` and the UI simply omits the
 * streak HUD. Loading is deduplicated and cached; `force` is used at meaningful
 * boundaries (opening a track, returning from a mission).
 */

/** Account-wide streak, independent of any single learning track. */
export interface Streak {
  current: number;
  longest: number;
  activeToday: boolean;
  lastActiveDay: string | null;
}

/** The neutral streak shown when data is unavailable. */
export const EMPTY_STREAK: Streak = {
  current: 0,
  longest: 0,
  activeToday: false,
  lastActiveDay: null,
};

function toStreak(dto: StreakDto): Streak {
  return {
    current: dto.current,
    longest: dto.longest,
    activeToday: dto.active_today,
    lastActiveDay: dto.last_active_day ?? null,
  };
}

let cached: Streak | null = null;
let inflight: Promise<Streak | null> | null = null;

/** Loads the account streak, best-effort and deduplicated. */
export async function loadStreak(force = false): Promise<Streak | null> {
  if (!force && cached) {
    return cached;
  }
  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const result = await api.GET("/v1/me");
      if (result.error || !result.data?.streak) {
        return null;
      }
      const streak = toStreak(result.data.streak);
      cached = streak;
      return streak;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Returns the cached streak without triggering a request, if any. */
export function peekStreak(): Streak | null {
  return cached;
}

/** Clears the cached streak, for tests and explicit refreshes. */
export function clearStreakCache(): void {
  cached = null;
  inflight = null;
}
