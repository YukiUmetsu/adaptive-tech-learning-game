import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PracticeTestResponse } from "../api/types";
import {
  PRACTICE_TEST_ATTEMPT_KEY,
  answeredCount,
  clearAttempt,
  formatRemaining,
  isExpired,
  loadAttempt,
  markedCount,
  remainingMs,
  saveAttempt,
  startAttempt,
  unansweredCount,
  type PracticeTestAttempt,
} from "./practiceTest";

const test = {
  id: "aws-soa-c03-practice-test-1",
  title: "Practice Test 1",
  exam_code: "SOA-C03",
  certification_version: "soa-c03",
  content_version: "soa-c03-content-v1",
  time_limit_minutes: 130,
  question_count: 3,
  scored_question_count: 2,
  question_types: ["multiple_choice"],
  items: [
    { order: 1, question: { id: "q1" } },
    { order: 2, question: { id: "q2" } },
    { order: 3, question: { id: "q3" } },
  ],
} as unknown as PracticeTestResponse;

function attempt(overrides: Partial<PracticeTestAttempt> = {}): PracticeTestAttempt {
  return { ...startAttempt(test, "aws-soa-c03", 0), ...overrides };
}

describe("practice test attempt state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("starts an attempt with an absolute deadline, not a counter", () => {
    const started = startAttempt(test, "aws-soa-c03", 1_000_000);
    expect(started.deadlineAt).toBe(new Date(1_000_000 + 130 * 60_000).toISOString());
    expect(started.startedAt).toBe(new Date(1_000_000).toISOString());
    expect(started.questionOrder).toEqual(["q1", "q2", "q3"]);
    expect(started.currentIndex).toBe(0);
  });

  it("persists and restores an attempt across a refresh", () => {
    const started = attempt({ currentIndex: 2, answers: { q1: { choice_id: "A" } } });
    expect(saveAttempt(started)).toBe(true);
    expect(loadAttempt()).toEqual(started);
    expect(window.localStorage.getItem(PRACTICE_TEST_ATTEMPT_KEY)).not.toBeNull();
  });

  it("restores remaining time from the deadline, never resetting it", () => {
    const deadline = new Date(5_000).toISOString();
    const started = attempt({ deadlineAt: deadline });
    expect(remainingMs(started, 2_000)).toBe(3_000);
    expect(remainingMs(started, 9_000)).toBe(0);
    expect(isExpired(started, 9_000)).toBe(true);
    expect(isExpired(started, 1_000)).toBe(false);
  });

  it("formats remaining time as m:ss or h:mm:ss", () => {
    expect(formatRemaining(65_000)).toBe("1:05");
    expect(formatRemaining(3_725_000)).toBe("1:02:05");
    expect(formatRemaining(-10)).toBe("0:00");
  });

  it("counts answered, unanswered, and marked questions", () => {
    const started = attempt({
      answers: { q1: { choice_id: "A" } },
      markedForReview: ["q2", "q3"],
    });
    expect(answeredCount(started)).toBe(1);
    expect(unansweredCount(started)).toBe(2);
    expect(markedCount(started)).toBe(2);
  });

  it("clears a stored attempt", () => {
    saveAttempt(attempt());
    clearAttempt();
    expect(loadAttempt()).toBeNull();
  });
});
