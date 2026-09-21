import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import type { DailyMissionResponse, DomainDiscoveryInput } from "../api/types";

export type DailyMissionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; mission: DailyMissionResponse }
  | { status: "error" };

interface UseDailyMissionOptions {
  /** Learning track identifier. */
  trackId: string | undefined;
  /** Whether the learner is authenticated and the mission should load. */
  enabled: boolean;
  /** Raw Knowledge Map discovery progress, if available. */
  discovery?: DomainDiscoveryInput[];
  /** Changing this forces a reload. */
  reloadKey?: number;
}

function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function isDailyMissionResponse(value: unknown): value is DailyMissionResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mission = value as DailyMissionResponse;
  return typeof mission.id === "string" && Array.isArray(mission.items);
}

/**
 * Loads today's immutable Daily Mission, generating it once if needed.
 *
 * Best-effort auxiliary data: any failure resolves to an `error` state that the
 * caller hides. It never throws and never participates in a required loading
 * chain. The server returns the same stored snapshot for the rest of the day.
 */
export function useDailyMission({
  trackId,
  enabled,
  discovery = [],
  reloadKey = 0,
}: UseDailyMissionOptions) {
  const discoveryKey = useMemo(() => JSON.stringify(discovery), [discovery]);
  const [state, setState] = useState<DailyMissionState>({ status: "idle" });
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    void reloadKey;

    if (!enabled || !trackId) {
      setState({ status: "idle" });
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState({ status: "loading" });
    const payload = JSON.parse(discoveryKey) as DomainDiscoveryInput[];
    try {
      const result = await api.POST("/v1/tracks/{track_id}/daily-mission", {
        params: { path: { track_id: trackId } },
        body: { timezone: browserTimezone(), discovery: payload },
      });
      if (requestId !== requestRef.current) {
        return;
      }
      if (isDailyMissionResponse(result.data)) {
        setState({ status: "loaded", mission: result.data });
      } else {
        setState({ status: "error" });
      }
    } catch {
      if (requestId !== requestRef.current) {
        return;
      }
      setState({ status: "error" });
    }
  }, [enabled, trackId, discoveryKey, reloadKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
