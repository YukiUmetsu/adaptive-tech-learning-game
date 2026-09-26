import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../auth/context";
import type { MissionResponse } from "../api/types";
import { clearCatalogCache } from "../hooks/useCatalog";
import { clearFamilyInsightsCache } from "../state/familyInsights";
import { clearTrackMapCache } from "../state/trackMap";
import { familyInsightsResponseFixture } from "../test/familyInsightFixture";
import { reconcileBits } from "../state/wallet";
import QuizCompletionSummary from "./QuizCompletionSummary";

vi.mock("../state/sound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/sound")>();
  return { ...actual, playMissionComplete: vi.fn() };
});

const authenticated: AuthContextValue = {
  status: "authenticated",
  user: { id: "u1", email: null },
  configured: true,
  devSignIn: false,
  authError: null,
  signIn: async () => {},
  signOut: async () => {},
  getAccessToken: async () => "token",
};

const catalog = {
  certifications: [
    {
      id: "dsa-track",
      vendor: "Test",
      name: "DSA Track",
      exam_code: "DSA",
      official_source_url: "https://example.com/blueprint",
      last_reviewed: "2026-09-18",
      versions: [
        {
          id: "dsa-v1",
          exam_code: "DSA",
          effective_date: "2026-06-01",
          content_version: "dsa-v1-content",
          domains: [],
          concepts: [],
        },
      ],
    },
  ],
};

function mission(): MissionResponse {
  return {
    id: "challenge-mission",
    device_id: "device",
    certification_id: "dsa-track",
    certification_version: "dsa-v1",
    content_version: "dsa-v1-content",
    mode: "challenge",
    domain_id: null,
    task_id: null,
    module_id: null,
    issued_at: "2026-09-19T10:00:00Z",
    expires_at: "2026-09-19T11:00:00Z",
    questions: [],
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

let insightRequests = 0;
let insightUrl = "";

beforeEach(() => {
  clearCatalogCache();
  clearFamilyInsightsCache();
  clearTrackMapCache();
  window.localStorage.clear();
  reconcileBits(0);
  insightRequests = 0;
  insightUrl = "";

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("/family-insights")) {
        insightRequests += 1;
        insightUrl = url;
        return jsonResponse(familyInsightsResponseFixture());
      }
      if (url.includes("/v1/certifications")) {
        return jsonResponse(catalog);
      }
      if (url.includes("/v1/wallet")) {
        return jsonResponse({ user_id: "u1", bits_balance: 0 });
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Challenge completion integration: a completed challenge can offer a
 * collapsed, optional structure insight. Opening it is local-only: it creates
 * no scored event, awards no Bits, and never refetches.
 */
describe("QuizCompletionSummary pattern teaser", () => {
  it("offers a collapsed same-skeleton insight after completion", async () => {
    const user = userEvent.setup();
    render(
      <AuthContext.Provider value={authenticated}>
        <MemoryRouter initialEntries={["/missions/challenge-mission"]}>
          <Routes>
            <Route
              path="/missions/:missionId"
              element={
                <QuizCompletionSummary
                  mission={mission()}
                  attempts={[]}
                  syncState={{ status: "synced", pending: 0 }}
                  onRetrySync={vi.fn()}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    const summary = await screen.findByText(
      "See the structure these questions shared",
    );
    expect(summary).toBeInTheDocument();

    // The insight is collapsed, not dumped into the completion flow.
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);

    // The insight request is scoped to the finished mission, so the teaser
    // relates to the work the learner actually did.
    expect(insightUrl).toContain("mission_id=challenge-mission");

    const requestsBefore = insightRequests;
    await user.click(summary);

    expect(details?.open).toBe(true);
    await waitFor(() => {
      expect(screen.getAllByText("API rate limiting").length).toBeGreaterThan(0);
    });
    // Opening the insight makes no new network request and creates no event.
    expect(insightRequests).toBe(requestsBefore);
  });
});
