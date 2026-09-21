import { api } from "../api/client";
import type { NodeProgressDto, TrackProgressResponse } from "../api/types";

/**
 * Aggregate Knowledge Signal loading with a small in-memory cache.
 *
 * The Track Hub refreshes the signal only at meaningful boundaries (opening the
 * track, completing a quiz, an explicit refresh). Answers and reveals never
 * trigger a request. A failure resolves to `null`, and the map renders normally
 * without adaptive decoration.
 */

const cache = new Map<string, TrackProgressResponse>();
const inflight = new Map<string, Promise<TrackProgressResponse | null>>();

/** Flattens the aggregate response into a node-id index. */
export function signalIndex(
  progress: TrackProgressResponse | null,
): Map<string, NodeProgressDto> {
  const index = new Map<string, NodeProgressDto>();
  if (!progress) {
    return index;
  }
  for (const domain of progress.domains) {
    for (const node of domain.nodes) {
      index.set(node.node_id, node);
    }
  }
  return index;
}

/**
 * Loads the aggregate signal for a track, best-effort.
 *
 * Concurrent callers share one request. `force` is used at explicit boundaries;
 * otherwise the cached response is returned so temporary staleness is accepted.
 */
export async function loadTrackProgress(
  trackId: string,
  force = false,
): Promise<TrackProgressResponse | null> {
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
      const result = await api.GET("/v1/tracks/{track_id}/progress", {
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

/** Clears the cached signal, for tests and explicit refreshes. */
export function clearTrackProgressCache(): void {
  cache.clear();
  inflight.clear();
}
