import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import type {
  DomainDiscoveryInput,
  SessionPreference,
  StudySessionResponse,
} from "../api/types";

export type StudySessionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; session: StudySessionResponse }
  | { status: "error" };

interface UseStudySessionOptions {
  /** Learning track identifier. */
  trackId: string | undefined;
  /** Whether the learner is authenticated and planning should run. */
  enabled: boolean;
  /** Requested approximate session length. */
  availableMinutes: number;
  /** How to balance learning and retrieval practice. */
  preference: SessionPreference;
  /** Raw Knowledge Map discovery progress, if available. */
  discovery?: DomainDiscoveryInput[];
  /** Changing this forces a reload (the "regenerate" override). */
  reloadKey?: number;
}

/**
 * Guards against a malformed session response so the caller can fall back
 * instead of rendering broken data.
 */
function isStudySessionResponse(value: unknown): value is StudySessionResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as StudySessionResponse;
  return (
    typeof session.session_id === "string" &&
    Array.isArray(session.activities) &&
    session.activities.every(
      (activity) =>
        Boolean(activity) &&
        typeof activity.title === "string" &&
        typeof activity.kind === "string" &&
        Array.isArray(activity.question_ids),
    )
  );
}

/**
 * Loads the optional adaptive study session for a learning track.
 *
 * Best-effort auxiliary data: any failure resolves to an `error` state that the
 * caller handles by building a standard non-adaptive session. It never throws
 * into the page and never participates in a required loading chain.
 */
export function useStudySession({
  trackId,
  enabled,
  availableMinutes,
  preference,
  discovery = [],
  reloadKey = 0,
}: UseStudySessionOptions) {
  const discoveryKey = useMemo(() => JSON.stringify(discovery), [discovery]);
  const [state, setState] = useState<StudySessionState>({ status: "idle" });
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    // Referenced so the regenerate override retriggers the effect.
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
      const result = await api.POST("/v1/tracks/{track_id}/session", {
        params: { path: { track_id: trackId } },
        body: {
          available_minutes: availableMinutes,
          preference,
          discovery: payload,
        },
      });
      if (requestId !== requestRef.current) {
        return;
      }
      if (isStudySessionResponse(result.data)) {
        setState({ status: "loaded", session: result.data });
      } else {
        setState({ status: "error" });
      }
    } catch {
      if (requestId !== requestRef.current) {
        return;
      }
      // Optional data: swallow the failure so the caller can fall back.
      setState({ status: "error" });
    }
  }, [enabled, trackId, availableMinutes, preference, discoveryKey, reloadKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
