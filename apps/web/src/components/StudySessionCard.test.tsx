import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DomainDto } from "../api/types";
import StudySessionCard from "./StudySessionCard";

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

function domain(
  id: string,
  learningAvailable: boolean,
  name = `Domain ${id}`,
): DomainDto {
  return {
    id,
    name,
    weight: 0.5,
    learning_available: learningAvailable,
    tasks: [],
  };
}

const domains = [
  domain("domain-1", true, "Domain 1"),
  domain("domain-2", false, "Domain 2"),
];

let requests: RecordedRequest[] = [];

function sessionRequests(): RecordedRequest[] {
  return requests.filter((request) => request.url.endsWith("/session"));
}

function issueRequests(): RecordedRequest[] {
  return requests.filter((request) =>
    request.url.includes("/v1/missions/issue"),
  );
}

function renderCard() {
  return render(
    <MemoryRouter initialEntries={["/tracks/ai-python-fluency"]}>
      <StudySessionCard
        trackId="ai-python-fluency"
        trackVersion="python-fluency-v1"
        domains={domains}
        enabled
      />
      <Routes>
        <Route path="/missions/:missionId" element={<p>Mission runner</p>} />
        <Route
          path="/tracks/:trackId/domains/:domainId/learn"
          element={<p>Knowledge map</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function stubFetch(sessionResponse: () => Response | Promise<Response>) {
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

      if (url.includes("/v1/missions/issue")) {
        return jsonResponse({ id: "22222222-2222-4222-8222-222222222222" });
      }
      if (url.endsWith("/session")) {
        return sessionResponse();
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }),
  );
}

const adaptiveSession = {
  session_id: "session-1",
  track_id: "ai-python-fluency",
  estimated_minutes: 8,
  activities: [
    {
      kind: "practice",
      domain_id: "domain-1",
      domain_name: "Domain 1",
      node_id: null,
      node_title: null,
      question_ids: ["q1", "q2"],
      concept_ids: ["c1"],
      title: "Practice Domain 1",
      estimated_minutes: 4,
    },
    {
      kind: "review_node",
      domain_id: "domain-1",
      domain_name: "Domain 1",
      node_id: "n1",
      node_title: "Node 1",
      question_ids: [],
      concept_ids: ["c1"],
      title: "Review Node 1",
      estimated_minutes: 4,
    },
  ],
};

beforeEach(() => {
  requests = [];
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StudySessionCard", () => {
  it("renders an adaptive session and starts practice anchored on the first question", async () => {
    stubFetch(() => jsonResponse(adaptiveSession));
    renderCard();

    expect(await screen.findByText("Practice Domain 1")).toBeInTheDocument();
    expect(screen.getByText("Review Node 1")).toBeInTheDocument();
    expect(screen.queryByText("Standard study session")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Start study session" }),
    );

    await waitFor(() => expect(issueRequests()).toHaveLength(1));
    expect(issueRequests()[0].body).toMatchObject({
      mode: "recommended_practice",
      question_id: "q1",
    });
    expect(await screen.findByText("Mission runner")).toBeInTheDocument();
  });

  it("falls back to a standard session when adaptive planning fails", async () => {
    stubFetch(() => jsonResponse({ error: { code: "internal" } }, 500));
    renderCard();

    expect(await screen.findByText("Standard study session")).toBeInTheDocument();
    expect(screen.getByText("Your 20-minute session")).toBeInTheDocument();

    // The standard plan starts a normal domain quiz.
    await userEvent.click(
      screen.getByRole("button", { name: "Start activity: Practice Domain 1" }),
    );
    await waitFor(() => expect(issueRequests()).toHaveLength(1));
    expect(issueRequests()[0].body).toMatchObject({
      mode: "domain_quiz",
      domain_id: "domain-1",
    });
  });

  it("falls back when the adaptive response is malformed", async () => {
    stubFetch(() => jsonResponse({ unexpected: true }));
    renderCard();

    expect(await screen.findByText("Standard study session")).toBeInTheDocument();
  });

  it("falls back when the adaptive request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    renderCard();
    expect(await screen.findByText("Standard study session")).toBeInTheDocument();
  });

  it("applies planning overrides through new requests", async () => {
    stubFetch(() => jsonResponse(adaptiveSession));
    renderCard();
    await screen.findByText("Practice Domain 1");

    await userEvent.click(screen.getByRole("button", { name: "More practice" }));
    await waitFor(() =>
      expect(
        sessionRequests().some(
          (request) =>
            (request.body as { preference?: string } | null)?.preference ===
            "more_practice",
        ),
      ).toBe(true),
    );

    await userEvent.click(screen.getByRole("button", { name: "Make it shorter" }));
    await waitFor(() =>
      expect(
        sessionRequests().some(
          (request) =>
            (request.body as { available_minutes?: number } | null)
              ?.available_minutes === 15,
        ),
      ).toBe(true),
    );

    const before = sessionRequests().length;
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(sessionRequests().length).toBeGreaterThan(before));
  });

  it("renders nothing for anonymous learners", () => {
    stubFetch(() => jsonResponse(adaptiveSession));
    render(
      <MemoryRouter>
        <StudySessionCard
          trackId="ai-python-fluency"
          trackVersion="python-fluency-v1"
          domains={domains}
          enabled={false}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/study session/i)).not.toBeInTheDocument();
  });
});
