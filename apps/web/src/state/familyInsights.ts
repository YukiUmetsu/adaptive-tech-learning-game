import { api } from "../api/client";
import type { FamilyInsightDto, FamilyInsightsResponse } from "../api/types";

/**
 * Family insights loading with a small in-memory cache (Phase 5).
 *
 * One aggregate request returns every family the learner has already seen, so
 * the Track Hub never fetches per-family or per-example state. This is optional
 * teaching content: a failure resolves to `null` and the hub keeps working.
 *
 * A request may optionally be scoped to a completed mission, so a completion
 * summary only sees the structures that mission involved. The cache key
 * therefore includes the mission scope.
 *
 * Caching matches the track-map and Knowledge-Signal pattern: insights are
 * cached per (track, mission scope) and only refreshed at meaningful boundaries
 * (a completed mission, an explicit refresh), never on a poll or after every
 * answer.
 */

const cache = new Map<string, FamilyInsightsResponse>();
const inflight = new Map<string, Promise<FamilyInsightsResponse | null>>();

function cacheKey(trackId: string, missionId: string | null): string {
  return `${trackId}::${missionId ?? ""}`;
}

/**
 * Loads family insights for a track, best-effort and deduplicated per scope.
 *
 * `missionId` scopes the response to a completed mission's families. Pass
 * `force` only at an explicit refresh boundary.
 */
export async function loadFamilyInsights(
  trackId: string,
  missionId: string | null = null,
  force = false,
): Promise<FamilyInsightsResponse | null> {
  const key = cacheKey(trackId, missionId);
  if (!force) {
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
  }
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    try {
      const result = await api.GET("/v1/tracks/{track_id}/family-insights", {
        params: {
          path: { track_id: trackId },
          query: { mission_id: missionId ?? undefined },
        },
      });
      if (result.error || !result.data) {
        return null;
      }
      cache.set(key, result.data);
      return result.data;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

/** Returns cached insights synchronously, when already loaded. */
export function peekFamilyInsights(
  trackId: string,
  missionId: string | null = null,
): FamilyInsightsResponse | null {
  return cache.get(cacheKey(trackId, missionId)) ?? null;
}

/** The comparison for the first unlocked family that has one. */
export function firstComparison(
  response: FamilyInsightsResponse | null,
): FamilyInsightDto | null {
  if (!response) {
    return null;
  }
  return response.insights.find((insight) => insight.comparison != null) ?? null;
}

/** Clears the cache, for tests and explicit refreshes. */
export function clearFamilyInsightsCache(): void {
  cache.clear();
  inflight.clear();
}
