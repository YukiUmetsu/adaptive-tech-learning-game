import { useCallback, useEffect, useState } from "react";

import { api } from "../api/client";
import type { LearningDomainResponse } from "../api/types";

export type LearningDomainState =
  | { status: "loading" }
  | { status: "loaded"; data: LearningDomainResponse }
  | { status: "error"; message: string };

/**
 * Loads a domain's pre-quiz learning content from the API.
 *
 * The curriculum is served by the Rust content layer; the React app never
 * imports learning JSON directly.
 */
export function useLearningDomain(
  certificationId: string | undefined,
  domainId: string | undefined,
) {
  const [state, setState] = useState<LearningDomainState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!certificationId || !domainId) {
      setState({ status: "error", message: "Missing certification or domain." });
      return;
    }

    setState({ status: "loading" });
    try {
      const result = await api.GET(
        "/v1/certifications/{certification_id}/domains/{domain_id}/learning",
        {
          params: {
            path: { certification_id: certificationId, domain_id: domainId },
          },
        },
      );
      if (result.data) {
        setState({ status: "loaded", data: result.data });
        return;
      }
      setState({
        status: "error",
        message:
          result.response.status === 404
            ? "This domain does not have learning content yet."
            : `The learning content could not be loaded (HTTP ${result.response.status}).`,
      });
    } catch (error) {
      setState({
        status: "error",
        message: `The learning content could not be reached (${
          error instanceof Error ? error.message : "network error"
        }).`,
      });
    }
  }, [certificationId, domainId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
