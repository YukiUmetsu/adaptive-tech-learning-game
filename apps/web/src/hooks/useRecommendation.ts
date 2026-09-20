import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { Recommendation } from "../api/types";

export type RecommendationState =
  | { status: "idle" }
  | { status: "loaded"; data: Recommendation | null }
  | { status: "error" };

interface UseRecommendationOptions {
  /** Learning track identifier. */
  trackId: string | undefined;
  /** Whether the learner is authenticated and the feature should load. */
  enabled: boolean;
  /** Knowledge-node ids the learner has already explored locally. */
  exploredNodeIds?: string[];
}

/**
 * Loads the optional next-action recommendation for a learning track.
 *
 * This is best-effort auxiliary data. It never throws into the page, never
 * blocks the dashboard, and never participates in a required loading chain: any
 * failure resolves to an `error` state that callers hide.
 */
export function useRecommendation({
  trackId,
  enabled,
  exploredNodeIds = [],
}: UseRecommendationOptions) {
  const exploredKey = exploredNodeIds.join(",");
  const [state, setState] = useState<RecommendationState>({ status: "idle" });
  // Guards against an out-of-order response overwriting a newer request.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !trackId) {
      setState({ status: "idle" });
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    try {
      const result = await api.GET("/v1/tracks/{track_id}/recommendation", {
        params: {
          path: { track_id: trackId },
          query: exploredKey ? { explored_node_ids: exploredKey } : undefined,
        },
      });
      if (requestId !== requestRef.current) {
        return;
      }
      if (result.data) {
        setState({ status: "loaded", data: result.data.recommendation ?? null });
      } else {
        setState({ status: "error" });
      }
    } catch {
      if (requestId !== requestRef.current) {
        return;
      }
      // Optional data: swallow the failure so the page renders normally.
      setState({ status: "error" });
    }
  }, [enabled, trackId, exploredKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
