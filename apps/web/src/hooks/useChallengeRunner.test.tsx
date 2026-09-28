import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionResponse } from "../api/types";
import { saveMission, type MissionProgress } from "../state/persistence";
import { useMissionRunner } from "./useMissionRunner";

vi.mock("../state/focus", () => ({
  recordStudyActivity: vi.fn(),
}));

function question(id: string) {
  return {
    id,
    prompt: `Prompt ${id}`,
    assessment_mode: "recognition",
    domain_id: "domain-1",
    task_id: "1.1",
    difficulty_prior: 0.5,
    concepts: [],
    hints: [],
    interaction_type: "multiple_choice",
    interaction: {
      type: "multiple_choice",
      choices: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    },
    canonical_answer: { type: "multiple_choice", choice_id: "a" },
    explanation: "A.",
    choice_feedback: {},
    error_codes: [],
  };
}

const mission = {
  id: "33333333-3333-4333-8333-333333333333",
  device_id: "22222222-2222-4222-8222-222222222222",
  certification_id: "ai-python-fluency",
  certification_version: "python-fluency-v1",
  content_version: "python-fluency-content-v1",
  mode: "challenge",
  domain_id: "domain-1",
  task_id: null,
  issued_at: "2026-09-20T10:00:00Z",
  expires_at: "2026-09-20T13:00:00Z",
  questions: [question("q1"), question("q2")],
  challenge: {
    id: "ch-1",
    title: "Journey",
    description: "A brief.",
    estimated_minutes: 8,
    stages: [
      {
        id: "recognize",
        order: 1,
        kind: "question",
        question_id: "q1",
        node_id: null,
        domain_id: "domain-1",
      },
      {
        id: "review",
        order: 2,
        kind: "learning_node",
        question_id: null,
        node_id: "n1",
        domain_id: "domain-1",
      },
      {
        id: "transfer",
        order: 3,
        kind: "question",
        question_id: "q2",
        node_id: null,
        domain_id: "domain-1",
      },
    ],
  },
} as unknown as MissionResponse;

function seed(stageIndex = 0): void {
  const progress: MissionProgress = {
    mission,
    currentIndex: 0,
    stageIndex,
    attempts: [],
    startedAt: "2026-09-20T10:00:00Z",
    finished: false,
  };
  saveMission(progress);
}

function Probe() {
  const runner = useMissionRunner(mission.id);
  return (
    <div>
      <p data-testid="phase">{runner.phase}</p>
      <p data-testid="stage">{runner.currentStage?.id ?? "none"}</p>
      <p data-testid="stageIndex">{runner.stageIndex}</p>
      <p data-testid="question">{runner.question?.id ?? "none"}</p>
      <p data-testid="total">{runner.total}</p>
      <button type="button" onClick={runner.next}>
        next
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  seed();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMissionRunner challenge stages", () => {
  it("advances through interleaved stages and maps question indices", async () => {
    render(<Probe />);

    await screen.findByText("answering");
    expect(screen.getByTestId("total")).toHaveTextContent("3");
    expect(screen.getByTestId("stage")).toHaveTextContent("recognize");
    expect(screen.getByTestId("question")).toHaveTextContent("q1");

    await userEvent.click(screen.getByText("next"));
    // The node stage does not consume a question and has no current question.
    expect(screen.getByTestId("stage")).toHaveTextContent("review");
    expect(screen.getByTestId("stageIndex")).toHaveTextContent("1");
    expect(screen.getByTestId("question")).toHaveTextContent("none");

    await userEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("stage")).toHaveTextContent("transfer");
    expect(screen.getByTestId("question")).toHaveTextContent("q2");

    await userEvent.click(screen.getByText("next"));
    await waitFor(() =>
      expect(screen.getByTestId("phase")).toHaveTextContent("summary"),
    );
  });

  it("resumes at the persisted stage", async () => {
    seed(2);
    render(<Probe />);

    await screen.findByText("answering");
    expect(screen.getByTestId("stage")).toHaveTextContent("transfer");
    expect(screen.getByTestId("question")).toHaveTextContent("q2");
  });

  it("keeps a finished challenge finished", async () => {
    saveMission({
      mission,
      currentIndex: 0,
      stageIndex: 2,
      attempts: [],
      startedAt: "2026-09-20T10:00:00Z",
      finished: true,
    });
    render(<Probe />);

    await screen.findByText("summary");
    expect(screen.getByTestId("phase")).toHaveTextContent("summary");
  });
});
