import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionResponse } from "../api/types";
import { saveMission, type MissionProgress } from "../state/persistence";
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
      if (url.includes("/answers")) {
        return jsonResponse({
          correct: true,
          score: 1,
          error_codes: [],
          bits_preview: 3,
        });
      }
      if (url.includes("/v1/sync")) {
        return jsonResponse({ results: [], bits_balance: 3 });
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
