import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DailyMissionCard from "./DailyMissionCard";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mission(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    track_id: "ai-python-fluency",
    track_version: "python-fluency-v1",
    day_key: "2026-09-20",
    plan_type: "adaptive",
    status: "active",
    reward_bits: 25,
    reward_granted: false,
    completed_items: 1,
    total_items: 2,
    created_at: "2026-09-20T08:00:00Z",
    completed_at: null,
    items: [
      {
        position: 0,
        kind: "review_node",
        domain_id: "domain-1",
        domain_name: "Python Basics",
        node_id: "n1",
        title: "Iterators",
        estimated_minutes: 4,
        status: "completed",
        question_count: 0,
        completed_at: "2026-09-20T08:10:00Z",
      },
      {
        position: 1,
        kind: "practice",
        domain_id: "domain-1",
        domain_name: "Python Basics",
        node_id: null,
        title: "Retrieval practice",
        estimated_minutes: 6,
        status: "pending",
        question_count: 3,
        completed_at: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(mission())),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderCard() {
  return render(
    <MemoryRouter>
      <DailyMissionCard
        trackId="ai-python-fluency"
        trackVersion="python-fluency-v1"
        authStatus="authenticated"
      />
    </MemoryRouter>,
  );
}

describe("DailyMissionCard", () => {
  it("renders today's plan, progress, and a continue entry point", async () => {
    renderCard();

    expect(await screen.findByText("Daily Mission")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 complete")).toBeInTheDocument();
    expect(screen.getByText("Iterators")).toBeInTheDocument();
    expect(screen.getByText("3 questions")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue Daily Mission" }),
    ).toHaveAttribute("href", "/tracks/ai-python-fluency/daily");
  });

  it("shows a completed mission and reward", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          mission({
            status: "completed",
            reward_granted: true,
            completed_items: 2,
          }),
        ),
      ),
    );
    renderCard();

    expect(
      await screen.findByText("Today's mission complete"),
    ).toBeInTheDocument();
    expect(screen.getByText(/\+25 Bits earned/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review mission" }),
    ).toBeInTheDocument();
  });

  it("renders nothing when loading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { code: "internal" } }, 500)),
    );
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("prompts anonymous learners to sign in", () => {
    render(
      <MemoryRouter initialEntries={["/tracks/ai-python-fluency"]}>
        <Routes>
          <Route
            path="/tracks/:certificationId"
            element={
              <DailyMissionCard
                trackId="ai-python-fluency"
                trackVersion="python-fluency-v1"
                authStatus="anonymous"
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Sign in to get today's Daily Mission"),
    ).toBeInTheDocument();
  });
});
