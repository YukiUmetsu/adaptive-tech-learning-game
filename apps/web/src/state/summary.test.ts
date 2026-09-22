import { describe, expect, it } from "vitest";

import type { MissionResponse, StudyQuestionView } from "../api/types";
import type { AttemptRecord } from "./persistence";
import {
  completionMessage,
  computeSummary,
  formatDuration,
  type MissionSummary,
} from "./summary";

function question(id: string, concepts: string[]): StudyQuestionView {
  return {
    id,
    domain_id: "domain-1",
    task_id: "1.1",
    prompt: `Prompt ${id}`,
    interaction_type: "classification",
    assessment_mode: "recognition",
    difficulty_prior: 0.2,
    concepts: concepts.map((concept_id) => ({ concept_id, weight: 1 })),
    hints: [],
    interaction: { type: "classification", items: [], categories: [] },
    canonical_answer: { type: "classification", placements: {} },
    explanation: "",
    choice_feedback: {},
    error_codes: [],
  };
}

const mission: MissionResponse = {
  id: "mission",
  device_id: "device",
  certification_id: "aws-soa-c03",
  certification_version: "soa-c03",
  content_version: "soa-c03-content-v1",
  mode: "quick_adaptive",
  domain_id: null,
  task_id: null,
  issued_at: "2026-09-19T10:00:00Z",
  expires_at: "2026-09-19T11:00:00Z",
  questions: [question("q1", ["a"]), question("q2", ["b"])],
};

function attempt(
  questionId: string,
  attemptNumber: number,
  correct: boolean,
  responseMs: number,
): AttemptRecord {
  return {
    eventId: `${questionId}-${attemptNumber}`,
    questionId,
    attemptNumber,
    correct,
    score: correct ? 1 : 0.5,
    errorCodes: [],
    hintCount: 0,
    responseMs,
    occurredAt: "2026-09-19T10:00:00Z",
  };
}

describe("computeSummary", () => {
  it("counts first-attempt success and recovery separately", () => {
    const summary = computeSummary(
      mission,
      [
        attempt("q1", 1, true, 1000),
        attempt("q2", 1, false, 2000),
        attempt("q2", 2, true, 3000),
      ],
      0,
    );

    expect(summary.questionsCompleted).toBe(2);
    expect(summary.firstAttemptCorrect).toBe(1);
    expect(summary.recoveredAttempts).toBe(1);
    expect(summary.studyTimeMs).toBe(6000);
    expect(summary.conceptsPracticed).toEqual(["a", "b"]);
    expect(summary.pendingEvents).toBe(0);
  });

  it("does not count a recovered question as first-attempt correct", () => {
    const summary = computeSummary(mission, [attempt("q1", 1, false, 500)], 0);

    expect(summary.firstAttemptCorrect).toBe(0);
    expect(summary.recoveredAttempts).toBe(0);
  });

  it("sums Bits and reports per-domain and per-task coverage", () => {
    const summary = computeSummary(
      mission,
      [
        { ...attempt("q1", 1, true, 1000), bits: 12 },
        { ...attempt("q2", 1, false, 1000), bits: 0 },
        { ...attempt("q2", 2, true, 1000), bits: 6 },
      ],
      0,
    );

    expect(summary.bitsEarned).toBe(18);
    expect(summary.domains).toEqual([
      { domainId: "domain-1", totalQuestions: 2, firstAttemptCorrect: 1 },
    ]);
    expect(summary.tasks).toEqual([
      {
        taskId: "1.1",
        domainId: "domain-1",
        totalQuestions: 2,
        firstAttemptCorrect: 1,
      },
    ]);
  });
});

function summaryWith(
  firstAttemptCorrect: number,
  recoveredAttempts: number,
  completed: number,
): MissionSummary {
  return {
    totalQuestions: completed,
    questionsCompleted: completed,
    firstAttemptCorrect,
    recoveredAttempts,
    conceptsPracticed: [],
    studyTimeMs: 0,
    pendingEvents: 0,
    bitsEarned: 0,
    domains: [],
    tasks: [],
  };
}

describe("completionMessage", () => {
  it("celebrates a flawless run", () => {
    expect(completionMessage(summaryWith(10, 0, 10))).toBe("Flawless run!");
  });

  it("celebrates an excellent run", () => {
    expect(completionMessage(summaryWith(9, 1, 10))).toBe("Excellent run!");
  });

  it("celebrates several recoveries as successful learning", () => {
    expect(completionMessage(summaryWith(3, 3, 10))).toBe("Strong recovery!");
  });

  it("falls back to a neutral positive message", () => {
    expect(completionMessage(summaryWith(2, 1, 10))).toBe("Quiz complete!");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds as minutes and seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
  });
});
