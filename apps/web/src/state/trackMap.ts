import { api } from "../api/client";
import type { TrackMapResponse } from "../api/types";

/**
 * Track-wide learning content loading with a small in-memory cache.
 *
 * The Track Hub renders one track-wide Knowledge Map, so this fetches every
 * domain once instead of one request per domain. A failure resolves to `null`;
 * the hub then offers the normal per-domain navigation instead.
 */

const cache = new Map<string, TrackMapResponse>();
const inflight = new Map<string, Promise<TrackMapResponse | null>>();

/** Loads the track map content, best-effort and deduplicated per track. */
export async function loadTrackMap(
  trackId: string,
  force = false,
): Promise<TrackMapResponse | null> {
  if (!force) {
    const cached = cache.get(trackId);
    if (cached) {
      return cached;
    }
  }
  const pending = inflight.get(trackId);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    try {
      const result = await api.GET("/v1/tracks/{track_id}/map", {
        params: { path: { track_id: trackId } },
      });
      if (result.error || !result.data) {
        return null;
      }
      cache.set(trackId, result.data);
      return result.data;
    } catch {
      return null;
    } finally {
      inflight.delete(trackId);
    }
  })();

  inflight.set(trackId, request);
  return request;
}

/** Clears the cached track map, for tests and explicit refreshes. */
export function clearTrackMapCache(): void {
  cache.clear();
  inflight.clear();
}
