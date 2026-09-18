import { useCallback, useEffect, useState } from "react";

import { api } from "../api/client";
import type { CatalogResponse } from "../api/types";

export type CatalogState =
  | { status: "loading" }
  | { status: "loaded"; data: CatalogResponse }
  | { status: "error"; message: string };

// The catalog is immutable for a running app, so cache it across route changes
// instead of refetching on every page.
let cached: CatalogResponse | null = null;

/**
 * Clears the cached catalog.
 *
 * Used by tests and by explicit refresh flows that must not reuse stale
 * certification data.
 */
export function clearCatalogCache(): void {
  cached = null;
}

/** Loads the certification catalog, reusing a cached copy when available. */
export function useCatalog() {
  const [state, setState] = useState<CatalogState>(() =>
    cached
      ? { status: "loaded", data: cached }
      : { status: "loading" },
  );

  const load = useCallback(async (force = false) => {
    if (cached && !force) {
      setState({ status: "loaded", data: cached });
      return;
    }

    setState({ status: "loading" });
    try {
      const result = await api.GET("/v1/certifications");
      if (result.data) {
        cached = result.data;
        setState({ status: "loaded", data: result.data });
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

  return { state, reload: () => load(true) };
}
