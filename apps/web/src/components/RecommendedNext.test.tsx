import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RecommendedNext from "./RecommendedNext";

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

const baseRecommendation = {
  action: "learn_node",
  reason: "weak_concept",
  track_id: "ai-python-fluency",
  domain_id: "domain-1",
  domain_name: "Python Basics",
  node_id: "n-broadcasting",
  node_title: "Tensor broadcasting",
  question_id: null,
  assessment_mode: null,
  concept_ids: ["python.broadcasting"],
  title: "Learn Tensor broadcasting",
};

let posted: unknown[] = [];
let requestedUrls: string[] = [];

function LearnDestination() {
  const [params] = useSearchParams();
  return <p>Learn page for {params.get("node")}</p>;
}

function renderRecommendation() {
  return render(
    <MemoryRouter initialEntries={["/tracks/ai-python-fluency"]}>
      <RecommendedNext
        trackId="ai-python-fluency"
        trackVersion="python-fluency-v1"
        enabled
      />
      <Routes>
        <Route
          path="/tracks/:trackId/domains/:domainId/learn"
          element={<LearnDestination />}
        />
        <Route path="/missions/:missionId" element={<p>Mission runner</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  posted = [];
  requestedUrls = [];
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      requestedUrls.push(url);
      if (url.includes("/recommendation")) {
        return jsonResponse({ recommendation: baseRecommendation });
      }
      if (url.includes("/v1/missions/issue")) {
        if (input instanceof Request) {
          posted.push(JSON.parse(await input.clone().text()));
        }
        return jsonResponse({ id: "11111111-1111-4111-8111-111111111111" });
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecommendedNext", () => {
  it("renders nothing when recommendations are disabled", () => {
    render(
      <MemoryRouter>
        <RecommendedNext
          trackId="ai-python-fluency"
          trackVersion="python-fluency-v1"
          enabled={false}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Recommended next/)).not.toBeInTheDocument();
  });

  it("renders nothing when the planner has no recommendation", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ recommendation: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderRecommendation();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/Recommended next/)).not.toBeInTheDocument();
  });

  it("hides itself when the recommendation request fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    renderRecommendation();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/Recommended next/)).not.toBeInTheDocument();
  });

  it("opens the knowledge map for a learn_node recommendation", async () => {
    renderRecommendation();
    await screen.findByText("Learn Tensor broadcasting");

    await userEvent.click(screen.getByRole("button", { name: "Open map" }));

    expect(
      await screen.findByText("Learn page for n-broadcasting"),
    ).toBeInTheDocument();
  });

  it("starts a domain quiz for a practice recommendation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requestedUrls.push(url);
        if (url.includes("/recommendation")) {
          return jsonResponse({
            recommendation: {
              ...baseRecommendation,
              action: "practice_question",
              reason: "needs_practice",
              node_id: null,
              node_title: null,
              question_id: "q1",
              title: "Practice Python Basics",
            },
          });
        }
        if (url.includes("/v1/missions/issue")) {
          if (input instanceof Request) {
            posted.push(JSON.parse(await input.clone().text()));
          }
          return jsonResponse({ id: "11111111-1111-4111-8111-111111111111" });
        }
        return jsonResponse({}, 404);
      }),
    );

    renderRecommendation();
    await screen.findByText("Practice Python Basics");

    await userEvent.click(screen.getByRole("button", { name: "Start practice" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      certification_id: "ai-python-fluency",
      mode: "domain_quiz",
      domain_id: "domain-1",
    });
    expect(await screen.findByText("Mission runner")).toBeInTheDocument();
  });

  it("shows an inline error but stays usable when practice fails to start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes("/recommendation")) {
          return jsonResponse({
            recommendation: {
              ...baseRecommendation,
              action: "practice_domain",
              node_id: null,
              node_title: null,
              title: "Take a Python Basics review",
            },
          });
        }
        return jsonResponse({ error: { code: "internal" } }, 500);
      }),
    );

    renderRecommendation();
    await screen.findByText("Take a Python Basics review");
    await userEvent.click(screen.getByRole("button", { name: "Start practice" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Recommended next")).toBeInTheDocument();
  });

  it("sends locally explored node ids with the request", async () => {
    window.localStorage.setItem(
      "adaptive-learn.learning-progress.v3",
      JSON.stringify({
        version: 3,
        domains: {
          "python-fluency-v1::domain-1": {
            certificationVersion: "python-fluency-v1",
            domainId: "domain-1",
            contentVersion: "python-fluency-content-v1",
            revealedPromptIds: { "n-basics": ["what"] },
            revealedElementIds: {},
            updatedAt: new Date(0).toISOString(),
          },
        },
      }),
    );

    renderRecommendation();
    await waitFor(() =>
      expect(
        requestedUrls.some((url) =>
          url.includes("explored_node_ids=n-basics"),
        ),
      ).toBe(true),
    );
  });
});
