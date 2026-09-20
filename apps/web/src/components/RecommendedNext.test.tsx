import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RecommendedNext from "./RecommendedNext";

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
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

let requests: RecordedRequest[] = [];

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

function eventRequests(): RecordedRequest[] {
  return requests.filter((request) => request.url.includes("/events"));
}

function issueRequests(): RecordedRequest[] {
  return requests.filter((request) =>
    request.url.includes("/v1/missions/issue"),
  );
}

beforeEach(() => {
  requests = [];
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const method = (request?.method ?? init?.method ?? "GET").toUpperCase();
      let body: unknown = null;
      if (request) {
        try {
          body = JSON.parse(await request.clone().text());
        } catch {
          body = null;
        }
      }
      requests.push({ url, method, body });

      if (url.includes("/recommendation") && url.includes("/events")) {
        return jsonResponse({ recorded: true });
      }
      if (url.includes("/recommendation")) {
        return jsonResponse({
          recommendation_id: "11111111-1111-4111-8111-111111111111",
          recommendation: baseRecommendation,
        });
      }
      if (url.includes("/v1/missions/issue")) {
        return jsonResponse({ id: "22222222-2222-4222-8222-222222222222" });
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
    expect(requests).toHaveLength(0);
  });

  it("renders nothing when the planner has no recommendation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ recommendation_id: null, recommendation: null }),
      ),
    );
    renderRecommendation();
    await waitFor(() => expect(eventRequests()).toHaveLength(0));
    expect(screen.queryByText(/Recommended next/)).not.toBeInTheDocument();
  });

  it("hides itself when the recommendation request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    renderRecommendation();
    await waitFor(() => expect(screen.queryByText(/Recommended next/)).not.toBeInTheDocument());
  });

  it("reports shown but never treats the request itself as shown", async () => {
    renderRecommendation();
    await screen.findByText("Learn Tensor broadcasting");

    await waitFor(() => expect(eventRequests()).toHaveLength(1));
    const [shown] = eventRequests();
    expect(shown.method).toBe("POST");
    expect(shown.body).toMatchObject({ event: "shown", action: "learn_node" });
  });

  it("opens the knowledge map and reports node_opened for a learn_node recommendation", async () => {
    renderRecommendation();
    await screen.findByText("Learn Tensor broadcasting");

    await userEvent.click(screen.getByRole("button", { name: "Open map" }));

    expect(
      await screen.findByText("Learn page for n-broadcasting"),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(
        eventRequests().some(
          (request) =>
            (request.body as { event?: string } | null)?.event === "clicked",
        ),
      ).toBe(true),
    );
    expect(
      eventRequests().some(
        (request) =>
          (request.body as { event?: string } | null)?.event === "node_opened",
      ),
    ).toBe(true);
  });

  it("starts focused recommended practice for a practice_question recommendation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request ? request.url : String(input);
        const method = (request?.method ?? init?.method ?? "GET").toUpperCase();
        let body: unknown = null;
        if (request) {
          try {
            body = JSON.parse(await request.clone().text());
          } catch {
            body = null;
          }
        }
        requests.push({ url, method, body });

        if (url.includes("/recommendation") && url.includes("/events")) {
          return jsonResponse({ recorded: true });
        }
        if (url.includes("/recommendation")) {
          return jsonResponse({
            recommendation_id: "11111111-1111-4111-8111-111111111111",
            recommendation: {
              ...baseRecommendation,
              action: "practice_question",
              reason: "needs_practice",
              node_id: null,
              node_title: null,
              question_id: "q-target",
              title: "Practice Python Basics",
            },
          });
        }
        if (url.includes("/v1/missions/issue")) {
          return jsonResponse({ id: "22222222-2222-4222-8222-222222222222" });
        }
        return jsonResponse({}, 404);
      }),
    );

    renderRecommendation();
    await screen.findByText("Practice Python Basics");

    await userEvent.click(screen.getByRole("button", { name: "Start practice" }));

    await waitFor(() => expect(issueRequests()).toHaveLength(1));
    expect(issueRequests()[0].body).toMatchObject({
      mode: "recommended_practice",
      question_id: "q-target",
      recommendation_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(await screen.findByText("Mission runner")).toBeInTheDocument();
  });

  it("starts a domain quiz for a practice_domain recommendation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request ? request.url : String(input);
        const method = (request?.method ?? init?.method ?? "GET").toUpperCase();
        let body: unknown = null;
        if (request) {
          try {
            body = JSON.parse(await request.clone().text());
          } catch {
            body = null;
          }
        }
        requests.push({ url, method, body });

        if (url.includes("/recommendation") && url.includes("/events")) {
          return jsonResponse({ recorded: true });
        }
        if (url.includes("/recommendation")) {
          return jsonResponse({
            recommendation_id: "11111111-1111-4111-8111-111111111111",
            recommendation: {
              ...baseRecommendation,
              action: "practice_domain",
              node_id: null,
              node_title: null,
              title: "Take a Python Basics review",
            },
          });
        }
        if (url.includes("/v1/missions/issue")) {
          return jsonResponse({ id: "22222222-2222-4222-8222-222222222222" });
        }
        return jsonResponse({}, 404);
      }),
    );

    renderRecommendation();
    await screen.findByText("Take a Python Basics review");
    await userEvent.click(screen.getByRole("button", { name: "Start practice" }));

    await waitFor(() => expect(issueRequests()).toHaveLength(1));
    expect(issueRequests()[0].body).toMatchObject({
      mode: "domain_quiz",
      domain_id: "domain-1",
    });
  });

  it("shows an inline error but stays usable when practice fails to start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/recommendation") && url.includes("/events")) {
          return jsonResponse({ recorded: true });
        }
        if (url.includes("/recommendation")) {
          return jsonResponse({
            recommendation_id: "11111111-1111-4111-8111-111111111111",
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

  it("sends raw discovery progress with the request", async () => {
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
    await screen.findByText("Learn Tensor broadcasting");

    const recommendationRequest = requests.find((request) =>
      request.url.endsWith("/recommendation"),
    );
    expect(recommendationRequest?.method).toBe("POST");
    expect(recommendationRequest?.body).toMatchObject({
      discovery: [
        {
          domain_id: "domain-1",
          revealed_prompt_ids: { "n-basics": ["what"] },
        },
      ],
    });
  });
});
