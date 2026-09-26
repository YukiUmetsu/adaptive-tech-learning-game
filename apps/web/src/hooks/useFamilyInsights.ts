import { useCallback, useEffect, useRef, useState } from "react";

import type { FamilyInsightsResponse } from "../api/types";
import { loadFamilyInsights } from "../state/familyInsights";

export type FamilyInsightsState =
  | { status: "idle" }
  | { status: "loaded"; response: FamilyInsightsResponse }
  | { status: "error" };

interface UseFamilyInsightsOptions {
  /** Learning track identifier. */
  trackId: string | undefined;
  /** Whether the learner is authenticated and the feature should load. */
  enabled: boolean;
  /**
   * Completed mission to scope the insights to. Omit for the track-wide
   * pattern browser.
   */
  missionId?: string | null;
  /** Changing this forces a refresh at an explicit boundary. */
  refreshKey?: number;
}

/**
 * Loads the optional Phase 5 family insights for a track.
 *
 * Best-effort auxiliary data: it never throws into the page, never blocks the
 * dashboard, and any failure resolves to an `error` state that callers hide. A
 * track with no authored family guides loads an empty list, not an error.
 *
 * `reload` respects the in-memory cache (safe for tab activation); `refresh`
 * bypasses it for an explicit boundary such as a just-completed mission.
 */
export function useFamilyInsights({
  trackId,
  enabled,
  missionId = null,
  refreshKey = 0,
}: UseFamilyInsightsOptions) {
  const [state, setState] = useState<FamilyInsightsState>({ status: "idle" });
  // Guards against an out-of-order response overwriting a newer request.
  const requestRef = useRef(0);

  const load = useCallback(
    async (force: boolean) => {
      // `refreshKey` only participates through callback identity so changing it
      // re-runs the effect and refetches at an explicit boundary; it has no
      // effect on the request itself.
      void refreshKey;
      if (!enabled || !trackId) {
        setState({ status: "idle" });
        return;
      }
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      const response = await loadFamilyInsights(trackId, missionId, force);
      if (requestId !== requestRef.current) {
        return;
      }
      if (response) {
        setState({ status: "loaded", response });
      } else {
        setState({ status: "error" });
      }
    },
    [enabled, trackId, missionId, refreshKey],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);

  return { state, reload, refresh };
}
