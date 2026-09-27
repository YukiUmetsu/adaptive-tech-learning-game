import { render, screen, waitFor } from "@testing-library/react";
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

/** A node item whose node id no longer exists in the served learning content. */
function staleNodeItem(
  position: number,
): DailyMissionResponse["items"][number] {
  return {
    position,
    kind: "learn_node",
    domain_id: "domain-1",
    domain_name: "Monitoring and Observability",
    node_id: "node-removed-by-content-change",
    title: "Keep the sequence information the contract needs",
    estimated_minutes: 4,
    status: "pending",
    question_count: 0,
    completed_at: null,
  };
}

function renderRunner(
  value: DailyMissionResponse,
  onRefresh: () => void = () => {},
) {
  return render(
    <MemoryRouter>
      <DailyMissionRunner
        trackId="aws-soa-c03"
        mission={value}
        onRefresh={onRefresh}
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

  it("opens on the task list and starts the first task on request", async () => {
    renderRunner(mission([practiceItem(0, "pending"), practiceItem(1, "pending")]));

    // The plan is shown first: no task activity until the learner starts.
    expect(
      screen.getByRole("heading", { name: "Today's mission" }),
    ).toBeInTheDocument();
    // The quest header previews the reward and the plan.
    expect(screen.getByText("+25")).toBeInTheDocument();
    expect(screen.getByText(/Adaptive path/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start task" }),
    ).not.toBeInTheDocument();
    // The ordered checklist is the plan: one row per task.
    expect(screen.getAllByText("3 questions")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Start mission" }));

    expect(
      screen.getByRole("heading", { name: /Task 1 of 2/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start task" }),
    ).toBeInTheDocument();
  });

  it("records study activity when a Daily Mission practice task starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    renderRunner(mission([practiceItem(0, "pending")]));

    await userEvent.click(screen.getByRole("button", { name: "Start mission" }));
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

  it("requests a refreshed plan when a task names content the server no longer has", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes("/learning")) {
          return new Response(
            JSON.stringify({
              schema_version: "1.0.0",
              content_version: "soa-c03-content-v1",
              certification_id: "aws-soa-c03",
              certification_version: "soa-c03",
              exam_guide_revision: null,
              domain: {
                id: "domain-1",
                name: "Monitoring and Observability",
                weight: 0.22,
              },
              learning_design: {
                progress_label: "Discovery Progress",
                unlock_rule: "Unlock",
                mastery_note: "Explore first.",
              },
              source_refs: [],
              glossary: [],
              // The item's node is gone from the current content.
              modules: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
    const onRefresh = vi.fn();
    renderRunner(
      mission([practiceItem(0, "completed"), staleNodeItem(1)]),
      onRefresh,
    );

    expect(
      await screen.findByText(/This task is unavailable right now/),
    ).toBeInTheDocument();
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });
});
