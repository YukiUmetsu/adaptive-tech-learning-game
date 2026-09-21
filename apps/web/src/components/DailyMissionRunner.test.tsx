import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyMissionResponse } from "../api/types";
import DailyMissionRunner from "./DailyMissionRunner";

vi.mock("../state/focus", () => ({
  recordStudyActivity: vi.fn(),
}));
vi.mock("../state/focusDaily", () => ({
  publishFocusDaily: vi.fn(),
}));

import { recordStudyActivity } from "../state/focus";
import { publishFocusDaily } from "../state/focusDaily";

function practiceItem(
  position: number,
  status: "pending" | "completed",
): DailyMissionResponse["items"][number] {
  return {
    position,
    kind: "practice",
    domain_id: "domain-1",
    domain_name: "Monitoring and Observability",
    node_id: null,
    title: "Retrieval practice",
    estimated_minutes: 6,
    status,
    question_count: 3,
    completed_at: status === "completed" ? "2026-09-20T08:00:00Z" : null,
  };
}

function mission(
  items: DailyMissionResponse["items"],
  status: "active" | "completed" = "active",
): DailyMissionResponse {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    track_id: "aws-soa-c03",
    track_version: "soa-c03",
    day_key: "2026-09-20",
    plan_type: "adaptive",
    status,
    reward_bits: 25,
    reward_granted: status === "completed",
    completed_items: items.filter((item) => item.status === "completed").length,
    total_items: items.length,
    created_at: "2026-09-20T08:00:00Z",
    completed_at: null,
    items,
  };
}

function renderRunner(value: DailyMissionResponse) {
  return render(
    <MemoryRouter>
      <DailyMissionRunner
        trackId="aws-soa-c03"
        mission={value}
        onRefresh={() => {}}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DailyMissionRunner", () => {
  it("publishes Daily Mission progress for the Focus widget", () => {
    renderRunner(
      mission([practiceItem(0, "completed"), practiceItem(1, "pending")]),
    );

    expect(publishFocusDaily).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: "aws-soa-c03",
        completed: 1,
        total: 2,
        nextMinutes: 6,
      }),
    );
    // Beginning the displayed activity is meaningful study.
    expect(recordStudyActivity).toHaveBeenCalledWith("daily_mission");
  });

  it("records study activity when a Daily Mission practice task starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    renderRunner(mission([practiceItem(0, "pending")]));

    await userEvent.click(screen.getByRole("button", { name: "Start task" }));

    expect(recordStudyActivity).toHaveBeenCalledWith("daily_mission");
  });

  it("shows the next task and lets completed items be reviewed", () => {
    renderRunner(mission([practiceItem(0, "completed"), practiceItem(1, "pending")]));
    expect(
      screen.getByRole("heading", { name: /Task 2 of 2/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Review/ }),
    ).toBeInTheDocument();
  });

  it("shows completion when every item is done", () => {
    renderRunner(
      mission(
        [practiceItem(0, "completed"), practiceItem(1, "completed")],
        "completed",
      ),
    );
    expect(screen.getByText(/Daily Mission complete/)).toBeInTheDocument();
  });

  it("renders a completed practice item's questions and answers on review", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              mission_id: "m",
              mode: "recommended_practice",
              completed_at: "2026-09-20T08:00:00Z",
              questions: [
                {
                  id: "q1",
                  domain_id: "domain-1",
                  task_id: "1.1",
                  prompt: "Which signal is a metric?",
                  assessment_mode: "recognition",
                  interaction: {
                    type: "classification",
                    items: [{ id: "metric_cpu", label: "CPU" }],
                    categories: [{ id: "metric", label: "Metric" }],
                  },
                  canonical_answer: {
                    type: "classification",
                    placements: { metric_cpu: "metric" },
                  },
                  explanation: "CPU is numeric.",
                  hints: [],
                  concepts: [],
                },
              ],
              attempts: [
                {
                  question_id: "q1",
                  attempt_number: 1,
                  score: 1,
                  correct: true,
                  hint_count: 0,
                  occurred_at: "2026-09-20T08:00:00Z",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    renderRunner(mission([practiceItem(0, "completed"), practiceItem(1, "pending")]));
    await userEvent.click(screen.getByRole("button", { name: /Review/ }));

    expect(await screen.findByText("Which signal is a metric?")).toBeInTheDocument();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("Metric")).toBeInTheDocument();
  });
});
