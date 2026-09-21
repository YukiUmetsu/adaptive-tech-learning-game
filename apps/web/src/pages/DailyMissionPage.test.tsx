import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { learningFixture } from "../test/learningFixture";
import DailyMissionPage from "./DailyMissionPage";

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

let requests: RecordedRequest[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function item(
  overrides: Record<string, unknown> & { position: number; kind: string },
) {
  return {
    domain_id: "domain-1",
    domain_name: "Python Basics",
    node_id: null,
    title: "Retrieval practice",
    estimated_minutes: 6,
    status: "pending",
    question_count: 3,
    completed_at: null,
    ...overrides,
  };
}

function baseMission(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    track_id: "test-cert",
    track_version: "v1",
    day_key: "2026-09-20",
    plan_type: "adaptive",
    status: "active",
    reward_bits: 25,
    reward_granted: false,
    completed_items: 0,
    total_items: 1,
    created_at: "2026-09-20T08:00:00Z",
    completed_at: null,
    items: [item({ position: 0, kind: "practice" })],
    ...overrides,
  };
}

function stubFetch(missionPayload: Record<string, unknown>) {
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

      if (url.includes("/learning")) {
        return jsonResponse(learningFixture);
      }
      if (url.endsWith("/complete")) {
        return jsonResponse({ item_completed: true, mission: missionPayload });
      }
      if (url.includes("/items/") && url.endsWith("/start")) {
        return jsonResponse({ id: "44444444-4444-4444-8444-444444444444" });
      }
      if (url.includes("/daily-mission")) {
        return jsonResponse(missionPayload);
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tracks/test-cert/daily"]}>
      <Routes>
        <Route path="/tracks/:certificationId/daily" element={<DailyMissionPage />} />
        <Route path="/missions/:missionId" element={<p>Mission runner</p>} />
        <Route path="/tracks/:certificationId" element={<p>Dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  requests = [];
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DailyMissionPage", () => {
  it("opens on the plan, then shows the current task and starts practice", async () => {
    stubFetch(baseMission());
    renderPage();

    // A fresh mission opens on the task list, not the first task.
    expect(await screen.findByText("Today's mission")).toBeInTheDocument();
    expect(screen.getAllByText("3 questions").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Start task" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start mission" }));

    expect(await screen.findByText("Task 1 of 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start task" }));

    await waitFor(() =>
      expect(requests.some((request) => request.url.endsWith("/items/0/start"))).toBe(
        true,
      ),
    );
    expect(await screen.findByText("Mission runner")).toBeInTheDocument();
  });

  it("renders a node task in place without map or discovery controls", async () => {
    stubFetch(
      baseMission({
        items: [
          item({
            position: 0,
            kind: "learn_node",
            node_id: "n1",
            title: "Alpha",
            question_count: 0,
          }),
        ],
      }),
    );
    renderPage();

    // Start from the plan, then the focused Knowledge Card renders directly,
    // not the Knowledge Map.
    await userEvent.click(
      await screen.findByRole("button", { name: "Start mission" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back to map" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue to Knowledge Map" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Discovery Progress/)).not.toBeInTheDocument();

    // Completing the node completes the task and offers the one next action.
    await userEvent.click(
      screen.getByRole("button", { name: "Reveal WHAT?" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reveal LOOK FOR" }),
    );

    expect(
      await screen.findByRole("button", { name: "Next task →" }),
    ).toBeInTheDocument();
    expect(
      requests.some((request) => request.url.endsWith("/items/0/complete")),
    ).toBe(true);
  });

  it("shows the completion state and reward when the mission is done", async () => {
    stubFetch(
      baseMission({
        status: "completed",
        reward_granted: true,
        completed_items: 1,
        items: [
          item({
            position: 0,
            kind: "practice",
            status: "completed",
            completed_at: "2026-09-20T08:10:00Z",
          }),
        ],
      }),
    );
    renderPage();

    expect(
      await screen.findByText("Today's mission complete 🎉"),
    ).toBeInTheDocument();
    expect(screen.getByText(/\+25 Bits daily bonus/)).toBeInTheDocument();
  });
});
