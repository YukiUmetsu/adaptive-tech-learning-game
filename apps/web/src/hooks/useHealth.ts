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
        message: `Request failed with HTTP ${result.response.status}`,
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Network error",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
