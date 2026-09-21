import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DomainDiscoveryInput } from "../api/types";
import { useRecommendation } from "./useRecommendation";

let recommendationRequests = 0;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function discovery(promptId: string): DomainDiscoveryInput[] {
  return [
    {
      domain_id: "d1",
      revealed_prompt_ids: { n1: [promptId] },
      revealed_element_ids: {},
    },
  ];
}

beforeEach(() => {
  recommendationRequests = 0;
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/recommendation")) {
        recommendationRequests += 1;
        return jsonResponse({
          recommendation_id: "11111111-1111-4111-8111-111111111111",
          recommendation: null,
        });
      }
      return jsonResponse({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRecommendation", () => {
  it("does not refetch when discovery changes within the same mount", async () => {
    const { rerender } = renderHook(
      ({ value, refreshKey }: { value: DomainDiscoveryInput[]; refreshKey: number }) =>
        useRecommendation({
          trackId: "track",
          enabled: true,
          discovery: value,
          refreshKey,
        }),
      { initialProps: { value: discovery("p1"), refreshKey: 0 } },
    );

    await waitFor(() => expect(recommendationRequests).toBe(1));

    // A reveal/answer changes discovery but must not trigger another request.
    rerender({ value: discovery("p2"), refreshKey: 0 });
    rerender({ value: discovery("p3"), refreshKey: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recommendationRequests).toBe(1);

    // An explicit boundary refresh does refetch.
    rerender({ value: discovery("p3"), refreshKey: 1 });
    await waitFor(() => expect(recommendationRequests).toBe(2));
  });

  it("stays in an error state when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const { result } = renderHook(() =>
      useRecommendation({ trackId: "track", enabled: true, discovery: [] }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });
});
