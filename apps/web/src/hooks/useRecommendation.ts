import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import type { DomainDiscoveryInput, Recommendation } from "../api/types";

export type RecommendationState =
  | { status: "idle" }
  | {
      status: "loaded";
      recommendation: Recommendation | null;
      recommendationId: string | null;
    }
  | { status: "error" };

interface UseRecommendationOptions {
  /** Learning track identifier. */
  trackId: string | undefined;
  /** Whether the learner is authenticated and the feature should load. */
  enabled: boolean;
  /** Raw Knowledge Map discovery progress for the track, if available. */
  discovery?: DomainDiscoveryInput[];
}

/**
 * Loads the optional next-action recommendation for a learning track.
 *
 * This is best-effort auxiliary data. It never throws into the page, never
 * blocks the dashboard, and never participates in a required loading chain: any
 * failure resolves to an `error` state that callers hide. A successful request
 * is not proof the learner saw anything; `shown` is reported separately.
 */
export function useRecommendation({
  trackId,
  enabled,
  discovery = [],
}: UseRecommendationOptions) {
  // Serialize so the effect only reruns when the discovery payload changes.
  const discoveryKey = useMemo(() => JSON.stringify(discovery), [discovery]);
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
    const payload = JSON.parse(discoveryKey) as DomainDiscoveryInput[];
    try {
      const result = await api.POST("/v1/tracks/{track_id}/recommendation", {
        params: { path: { track_id: trackId } },
        body: { discovery: payload },
      });
      if (requestId !== requestRef.current) {
        return;
      }
      if (result.data) {
        setState({
          status: "loaded",
          recommendation: result.data.recommendation ?? null,
          recommendationId: result.data.recommendation_id ?? null,
        });
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
  }, [enabled, trackId, discoveryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
