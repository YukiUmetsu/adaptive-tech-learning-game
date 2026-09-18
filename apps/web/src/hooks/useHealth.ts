import { useCallback, useEffect, useState } from "react";

import { api } from "../api/client";
import type { components } from "../api/schema";

export type HealthResponse = components["schemas"]["HealthResponse"];

export type HealthState =
  | { status: "loading" }
  | { status: "loaded"; data: HealthResponse }
  | { status: "error"; message: string };

/**
 * Loads the API health payload.
 *
 * The API returns the same body for `200` and `503`, so a degraded service is
 * still shown as loaded data rather than an opaque failure.
 */
export function useHealth() {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });

    try {
      const result = await api.GET("/health");
      const payload = result.data ?? result.error;

      if (payload) {
        setState({ status: "loaded", data: payload });
        return;
      }

      setState({
        status: "error",
        message: `The API returned HTTP ${result.response.status}. Check that the API is running and VITE_API_PROXY_TARGET points to it.`,
      });
    } catch (error) {
      setState({
        status: "error",
        message: `The API could not be reached (${
          error instanceof Error ? error.message : "network error"
        }). Start the API and check VITE_API_PROXY_TARGET (dev) or VITE_API_BASE_URL (deployed).`,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
