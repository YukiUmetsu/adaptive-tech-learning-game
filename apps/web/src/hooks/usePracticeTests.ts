import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { PracticeTestSummaryDto } from "../api/types";

export type PracticeTestsState =
  | { status: "loading" }
  | { status: "loaded"; tests: PracticeTestSummaryDto[] }
  | { status: "error" };

/**
 * Loads the practice tests authored for a certification.
 *
 * Failing here just hides the exam-simulation entry point; it never breaks the
 * track page.
 */
export function usePracticeTests(certificationId: string | undefined) {
  const [state, setState] = useState<PracticeTestsState>({
    status: "loading",
  });

  useEffect(() => {
    if (!certificationId) {
      setState({ status: "loaded", tests: [] });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    void api
      .GET("/v1/certifications/{certification_id}/practice-tests", {
        params: { path: { certification_id: certificationId } },
      })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.data) {
          setState({
            status: "loaded",
            tests: result.data.practice_tests ?? [],
          });
        } else {
          setState({ status: "error" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [certificationId]);

  return state;
}
