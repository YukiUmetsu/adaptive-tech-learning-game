import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { MissionResponse } from "../api/types";
import type { MissionRunner } from "../hooks/useMissionRunner";
import ChallengeRunner from "./ChallengeRunner";

const question = {
  id: "q1",
  prompt: "Which choice fits?",
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

const mission = {
  id: "m-1",
  certification_id: "ai-python-fluency",
  certification_version: "python-fluency-v1",
  content_version: "v1",
  mode: "challenge",
  domain_id: "domain-1",
  task_id: null,
  issued_at: "2026-09-20T10:00:00Z",
  expires_at: "2026-09-20T13:00:00Z",
  questions: [question],
  challenge: {
    id: "ch-1",
    title: "Zip Journey",
    description: "A guided sequence.",
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
    ],
  },
} as unknown as MissionResponse;

function runner(overrides: Partial<MissionRunner> = {}): MissionRunner {
  return {
    phase: "answering",
    mission,
    question: question as never,
    currentIndex: 0,
    total: 2,
    challenge: mission.challenge ?? null,
    currentStage: mission.challenge?.stages[0] ?? null,
    stageIndex: 0,
    attempts: [],
    feedback: null,
    lastAnswer: null,
    submitting: false,
    error: null,
    syncState: { status: "idle", pending: 0 },
    submit: vi.fn(async () => {}),
    retry: vi.fn(),
    next: vi.fn(),
    sync: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("ChallengeRunner", () => {
  it("shows the challenge brief and stage progress above the question", () => {
    render(
      <MemoryRouter>
        <ChallengeRunner runner={runner()} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Zip Journey")).toBeInTheDocument();
    expect(screen.getByText("A guided sequence.")).toBeInTheDocument();
    expect(screen.getByText("Stage 1 of 2")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Challenge progress" }),
    ).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Which choice fits?")).toBeInTheDocument();
  });

  it("reports an unavailable challenge when orchestration is missing", () => {
    render(
      <MemoryRouter>
        <ChallengeRunner
          runner={runner({ challenge: null, currentStage: null })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Challenge unavailable")).toBeInTheDocument();
  });
});
