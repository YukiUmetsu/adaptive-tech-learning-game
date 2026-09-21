import type {
  AnswerPayload,
  PracticeTestResponse,
} from "../api/types";

/**
 * Versioned local attempt state for one practice test (exam simulation).
 *
 * Exam runs are local-first: progress lives in `localStorage` and only the
 * final submission touches the server. The timer is stored as an absolute
 * `deadlineAt` timestamp, never as a decrementing counter, so a refresh cannot
 * reset or extend the exam.
 */
export const PRACTICE_TEST_ATTEMPT_KEY =
  "adaptive-learn.practice-test-attempt.v1";

/** Persisted progress for one in-flight practice test. */
export interface PracticeTestAttempt {
  practiceTestId: string;
  certificationId: string;
  certificationVersion: string;
  contentVersion: string;
  title: string;
  /** Question ids in authored presentation order. */
  questionOrder: string[];
  /** When the attempt started (ISO 8601). */
  startedAt: string;
  /** Absolute deadline (ISO 8601). Survives refresh unchanged. */
  deadlineAt: string;
  /** Index into `questionOrder` of the question on screen. */
  currentIndex: number;
  /** Answer payloads keyed by question id. */
  answers: Record<string, AnswerPayload>;
  /** Question ids marked for review. */
  markedForReview: string[];
  /** Whether the attempt has been submitted. */
  submitted: boolean;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadAttempt(): PracticeTestAttempt | null {
  return readJson<PracticeTestAttempt>(PRACTICE_TEST_ATTEMPT_KEY);
}

export function saveAttempt(attempt: PracticeTestAttempt): boolean {
  return writeJson(PRACTICE_TEST_ATTEMPT_KEY, attempt);
}

export function clearAttempt(): void {
  try {
    window.localStorage.removeItem(PRACTICE_TEST_ATTEMPT_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
}

/** Creates a fresh attempt with an absolute deadline. */
export function startAttempt(
  test: PracticeTestResponse,
  certificationId: string,
  now: number = Date.now(),
): PracticeTestAttempt {
  return {
    practiceTestId: test.id,
    certificationId,
    certificationVersion: test.certification_version,
    contentVersion: test.content_version,
    title: test.title,
    questionOrder: test.items.map((item) => item.question.id),
    startedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + test.time_limit_minutes * 60_000).toISOString(),
    currentIndex: 0,
    answers: {},
    markedForReview: [],
    submitted: false,
  };
}

/** Milliseconds until the deadline, floored at zero. */
export function remainingMs(
  attempt: Pick<PracticeTestAttempt, "deadlineAt">,
  now: number = Date.now(),
): number {
  const deadline = Date.parse(attempt.deadlineAt);
  if (Number.isNaN(deadline)) {
    return 0;
  }
  return Math.max(0, deadline - now);
}

/** Whether the authored time limit has elapsed. */
export function isExpired(
  attempt: Pick<PracticeTestAttempt, "deadlineAt">,
  now: number = Date.now(),
): boolean {
  return remainingMs(attempt, now) <= 0;
}

/** Formats a remaining duration as `h:mm:ss` (or `m:ss` under an hour). */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** Count of questions with a submitted answer. */
export function answeredCount(attempt: PracticeTestAttempt): number {
  return attempt.questionOrder.filter((id) => attempt.answers[id]).length;
}

/** Count of questions still unanswered. */
export function unansweredCount(attempt: PracticeTestAttempt): number {
  return attempt.questionOrder.length - answeredCount(attempt);
}

/** Count of questions marked for review. */
export function markedCount(attempt: PracticeTestAttempt): number {
  return attempt.markedForReview.length;
}
