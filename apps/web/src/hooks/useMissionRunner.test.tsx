import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionResponse } from "../api/types";
import {
  loadMission,
  loadPendingEvents,
  saveMission,
  type MissionProgress,
} from "../state/persistence";
import { useMissionRunner } from "./useMissionRunner";

vi.mock("../state/focus", () => ({
  recordStudyActivity: vi.fn(),
}));

import { recordStudyActivity } from "../state/focus";

const mission = {
  id: "11111111-1111-4111-8111-111111111111",
  device_id: "22222222-2222-4222-8222-222222222222",
  certification_id: "aws-soa-c03",
  certification_version: "soa-c03",
  content_version: "soa-c03-content-v1",
  mode: "task_practice",
  domain_id: "domain-1",
  task_id: "1.1",
  issued_at: "2026-09-20T10:00:00Z",
  expires_at: "2026-09-20T11:00:00Z",
  questions: [
    {
      id: "q1",
      prompt: "Which signal is a metric?",
      assessment_mode: "recognition",
      domain_id: "domain-1",
      task_id: "1.1",
      difficulty_prior: 0.5,
      concepts: [],
      hints: [],
      interaction_type: "classification",
      interaction: {
        type: "classification",
        items: [{ id: "cpu", label: "CPU" }],
        categories: [{ id: "metric", label: "Metric" }],
      },
      canonical_answer: {
        type: "classification",
        placements: { cpu: "metric" },
      },
      explanation: "CPU is a metric.",
      choice_feedback: {},
      error_codes: [],
    },
  ],
} as unknown as MissionResponse;

function seed(): void {
  const progress: MissionProgress = {
    mission,
    currentIndex: 0,
    attempts: [],
    startedAt: "2026-09-20T10:00:00Z",
    finished: false,
  };
  saveMission(progress);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function Probe() {
  const runner = useMissionRunner(mission.id);
  return (
    <div>
      <p data-testid="phase">{runner.phase}</p>
      <button
        type="button"
        onClick={() => void runner.submit({ placements: { cpu: "metric" } })}
      >
        submit
      </button>
      <button type="button" onClick={runner.next}>
        next
      </button>
      <button type="button" onClick={runner.retry}>
        retry
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  seed();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/sync")) {
        return jsonResponse({
          results: [],
          bits_balance: 3,
          discovery: { accepted: true },
          auxiliary: { accepted: true },
        });
      }
      return jsonResponse({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMissionRunner focus activity", () => {
  it("records question, answer, and next boundaries", async () => {
    render(<Probe />);

    await screen.findByText("answering");
    await waitFor(() =>
      expect(recordStudyActivity).toHaveBeenCalledWith("question"),
    );

    await userEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() =>
      expect(recordStudyActivity).toHaveBeenCalledWith("answer_submit"),
    );

    await userEvent.click(screen.getByRole("button", { name: "next" }));
    expect(recordStudyActivity).toHaveBeenCalledWith("mission_next");
  });
});

describe("useMissionRunner scorer reconciliation", () => {
  it("lets the authoritative server score win and reconciles local state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.includes("/v1/sync")) {
          return jsonResponse({});
        }

        let body: { events?: { event_id?: string }[] } = { events: [] };
        if (input instanceof Request) {
          body = (await input.clone().json()) as typeof body;
        } else if (init?.body) {
          body = JSON.parse(String(init.body)) as typeof body;
        }

        // The local attempt scored 1.0/correct; the server disagrees.
        return jsonResponse({
          results: [
            {
              event_id: body.events?.[0]?.event_id,
              accepted: true,
              correct: false,
              score: 0.5,
              error_codes: ["classification_misplaced"],
              bits_settled: 0,
            },
          ],
          bits_balance: 0,
          discovery: { accepted: true },
          auxiliary: { accepted: true },
        });
      }),
    );

    render(<Probe />);
    await screen.findByText("answering");

    await userEvent.click(screen.getByRole("button", { name: "submit" }));
    await screen.findByText("feedback");

    // Local optimistic state was correct before reconciliation.
    expect(loadMission()?.attempts[0]?.correct).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "next" }));

    await waitFor(() => {
      const attempt = loadMission()?.attempts[0];
      expect(attempt?.correct).toBe(false);
      expect(attempt?.score).toBeCloseTo(0.5);
      expect(attempt?.errorCodes).toEqual(["classification_misplaced"]);
      expect(attempt?.bits).toBe(0);
    });
  });
});

describe("useMissionRunner stale content recovery", () => {
  it("drops a mission whose content changed and stops retrying it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.includes("/v1/sync")) {
          return jsonResponse({});
        }

        let body: { events?: { event_id?: string }[] } = { events: [] };
        if (input instanceof Request) {
          body = (await input.clone().json()) as typeof body;
        }

        // The server cannot score the mission: its questions no longer exist.
        return jsonResponse({
          results: [
            {
              event_id: body.events?.[0]?.event_id,
              accepted: false,
              error_code: "mission_content_stale",
              correct: false,
              score: 0,
              error_codes: [],
              bits_settled: 0,
            },
          ],
          bits_balance: 0,
          discovery: { accepted: true },
          auxiliary: { accepted: true },
        });
      }),
    );

    render(<Probe />);
    await screen.findByText("answering");

    await userEvent.click(screen.getByRole("button", { name: "submit" }));
    await screen.findByText("feedback");
    // The attempt is queued for reconciliation at the mission boundary.
    expect(loadPendingEvents()).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "next" }));

    await screen.findByText("stale");
    // Both the persisted mission and its unscoreable outbox are cleared.
    expect(loadMission()).toBeNull();
    expect(loadPendingEvents()).toEqual([]);
  });
});
