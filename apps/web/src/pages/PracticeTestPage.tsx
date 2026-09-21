import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import type {
  AnswerPayload,
  PracticeTestAnswerRequest,
  PracticeTestItemResult,
  PracticeTestResponse,
  PracticeTestResultResponse,
} from "../api/types";
import InlineText from "../components/InlineText";
import MultipleChoiceInteraction from "../components/MultipleChoiceInteraction";
import MultipleResponseInteraction from "../components/MultipleResponseInteraction";
import {
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
} from "../state/practiceTest";

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; test: PracticeTestResponse }
  | { status: "error"; message: string };

/**
 * Exam-simulation practice test.
 *
 * Deliberately different from the adaptive quiz flow: fixed authored order, a
 * wall-clock timer, no per-question feedback or rewards, and a single
 * submission that reveals the full review. The questions are not adapted and
 * nothing here touches concept mastery.
 */
export default function PracticeTestPage() {
  const { certificationId, practiceTestId } = useParams();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState<PracticeTestAttempt | null>(null);
  const [result, setResult] = useState<PracticeTestResultResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const autoSubmitted = useRef(false);

  // Load the learner-safe test content.
  useEffect(() => {
    if (!certificationId || !practiceTestId) {
      setLoad({ status: "error", message: "Missing practice test." });
      return;
    }
    let cancelled = false;
    setLoad({ status: "loading" });
    void api
      .GET("/v1/certifications/{certification_id}/practice-tests/{practice_test_id}", {
        params: {
          path: {
            certification_id: certificationId,
            practice_test_id: practiceTestId,
          },
        },
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        if (response.data) {
          setLoad({ status: "loaded", test: response.data });
        } else {
          setLoad({
            status: "error",
            message: `Could not load this practice test (HTTP ${response.response.status}).`,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoad({ status: "error", message: "Could not reach the API." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [certificationId, practiceTestId]);

  // Restore an in-flight attempt for this test on mount.
  useEffect(() => {
    if (load.status !== "loaded") {
      return;
    }
    const stored = loadAttempt();
    if (
      stored &&
      stored.practiceTestId === load.test.id &&
      stored.contentVersion === load.test.content_version &&
      !stored.submitted
    ) {
      setAttempt(stored);
    } else {
      setAttempt(null);
    }
  }, [load]);

  // Tick the clock once per second while an attempt is live.
  const live = Boolean(attempt) && !result;
  useEffect(() => {
    if (!live) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);

  const persist = useCallback((next: PracticeTestAttempt) => {
    setAttempt(next);
    saveAttempt(next);
  }, []);

  const submit = useCallback(
    async (current: PracticeTestAttempt) => {
      if (!certificationId || !practiceTestId || submitting) {
        return;
      }
      setSubmitting(true);
      setError(null);

      const answers: PracticeTestAnswerRequest[] = current.questionOrder
        .filter((questionId) => current.answers[questionId])
        .map((questionId) => ({
          question_id: questionId,
          answer: current.answers[questionId],
        }));

      try {
        const response = await api.POST(
          "/v1/certifications/{certification_id}/practice-tests/{practice_test_id}/submit",
          {
            params: {
              path: {
                certification_id: certificationId,
                practice_test_id: practiceTestId,
              },
            },
            body: { answers },
          },
        );

        if (response.error || !response.data) {
          setError(
            `Submission failed (HTTP ${response.response.status}). Your answers are still saved.`,
          );
          return;
        }

        setResult(response.data);
        clearAttempt();
      } catch {
        setError("Submission failed. Your answers are still saved.");
      } finally {
        setSubmitting(false);
      }
    },
    [certificationId, practiceTestId, submitting],
  );

  const start = useCallback(() => {
    if (load.status !== "loaded" || !certificationId) {
      return;
    }
    const next = startAttempt(load.test, certificationId, Date.now());
    setResult(null);
    autoSubmitted.current = false;
    setNow(Date.now());
    persist(next);
  }, [load, certificationId, persist]);

  const expired = attempt ? isExpired(attempt, now) : false;

  // Auto-submit once when time runs out; answers stay locked afterwards.
  useEffect(() => {
    if (!attempt || result || expired === false || autoSubmitted.current) {
      return;
    }
    autoSubmitted.current = true;
    void submit(attempt);
  }, [attempt, expired, result, submit]);

  if (load.status === "loading") {
    return <p role="status">Loading practice test…</p>;
  }

  if (load.status === "error") {
    return (
      <section className="practice-test-page">
        <h1>Practice test unavailable</h1>
        <p role="alert">{load.message}</p>
        <p>
          <Link to={`/tracks/${certificationId ?? ""}`}>Back to the track</Link>
        </p>
      </section>
    );
  }

  const test = load.test;

  if (result) {
    return (
      <PracticeTestResult
        result={result}
        reviewIndex={reviewIndex}
        onReviewIndex={setReviewIndex}
        backTo={`/tracks/${certificationId ?? ""}`}
      />
    );
  }

  if (!attempt) {
    return (
      <PracticeTestStart
        test={test}
        onStart={start}
        backTo={`/tracks/${certificationId ?? ""}`}
      />
    );
  }

  const index = Math.min(attempt.currentIndex, attempt.questionOrder.length - 1);
  const item = test.items[index];
  const question = item.question;
  const questionId = question.id;
  const selected = attempt.answers[questionId];
  const marked = attempt.markedForReview.includes(questionId);
  const remaining = remainingMs(attempt, now);

  const setAnswer = (answer: AnswerPayload) => {
    persist({
      ...attempt,
      answers: { ...attempt.answers, [questionId]: answer },
    });
  };

  const goTo = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, test.items.length - 1));
    persist({ ...attempt, currentIndex: clamped });
  };

  const toggleMark = () => {
    persist({
      ...attempt,
      markedForReview: marked
        ? attempt.markedForReview.filter((id) => id !== questionId)
        : [...attempt.markedForReview, questionId],
    });
  };

  // A question's navigator state (answered / marked / unanswered) is
  // independent of whether it is the current one, so both are shown.
  const statuses = attempt.questionOrder.map((id) => {
    if (attempt.markedForReview.includes(id)) {
      return "marked";
    }
    return attempt.answers[id] ? "answered" : "unanswered";
  });

  return (
    <section className="practice-test-page" aria-label={test.title}>
      <header className="practice-test-header">
        <div>
          <span className="badge">Exam Simulation</span>
          <h1>{test.title}</h1>
        </div>
        <div
          className={`practice-test-timer${expired ? " practice-test-timer--expired" : ""}`}
          role="timer"
          aria-label="Time remaining"
          data-testid="practice-test-timer"
        >
          {expired ? "Time is up" : formatRemaining(remaining)}
        </div>
      </header>

      <div className="practice-test-status">
        <div
          className="practice-test-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={test.items.length}
          aria-valuenow={answeredCount(attempt)}
          aria-label="Questions answered"
        >
          <div
            className="practice-test-progress-fill"
            style={{
              width: `${(answeredCount(attempt) / test.items.length) * 100}%`,
            }}
          />
        </div>
        <p className="practice-test-status-text">
          Question {index + 1} of {test.items.length}
          <span className="muted"> · {answeredCount(attempt)} answered</span>
        </p>
        <button
          type="button"
          className="navigator-toggle"
          aria-expanded={navigatorOpen}
          onClick={() => setNavigatorOpen((open) => !open)}
        >
          {navigatorOpen ? "Hide questions" : "All questions"}
          {markedCount(attempt) > 0 ? (
            <span className="navigator-toggle-badge">
              {markedCount(attempt)} marked
            </span>
          ) : null}
        </button>
      </div>

      {navigatorOpen ? (
        <div className="practice-test-navigator-panel">
          <ul className="navigator-legend">
            <li>
              <span
                className="legend-swatch legend-swatch--answered"
                aria-hidden="true"
              />
              Answered
            </li>
            <li>
              <span
                className="legend-swatch legend-swatch--marked"
                aria-hidden="true"
              />
              Marked
            </li>
            <li>
              <span
                className="legend-swatch legend-swatch--unanswered"
                aria-hidden="true"
              />
              Not answered
            </li>
          </ul>
          <nav className="practice-test-navigator" aria-label="Question navigator">
            {attempt.questionOrder.map((id, position) => (
              <button
                key={id}
                type="button"
                className={`navigator-cell navigator-cell--${statuses[position]}${
                  position === index ? " navigator-cell--current" : ""
                }`}
                aria-current={position === index ? "true" : undefined}
                aria-label={`Question ${position + 1}, ${statuses[position]}${
                  position === index ? ", current" : ""
                }`}
                onClick={() => {
                  goTo(position);
                  setNavigatorOpen(false);
                }}
              >
                {position + 1}
              </button>
            ))}
          </nav>
        </div>
      ) : null}

      <article className="practice-test-question">
        {question.instruction ? (
          <p className="question-instruction">{question.instruction}</p>
        ) : null}
        <h2 className="practice-test-prompt">
          <InlineText text={question.prompt} />
        </h2>

        {question.interaction.type === "multiple_choice" ? (
          <MultipleChoiceInteraction
            choices={question.interaction.choices}
            value={selected?.choice_id ?? null}
            disabled={expired || submitting}
            onChange={(choiceId) => setAnswer({ choice_id: choiceId })}
          />
        ) : question.interaction.type === "multiple_response" ? (
          <MultipleResponseInteraction
            choices={question.interaction.choices}
            requiredSelections={question.interaction.required_selections}
            value={selected?.choice_ids ?? []}
            disabled={expired || submitting}
            onChange={(choiceIds) => setAnswer({ choice_ids: choiceIds })}
          />
        ) : (
          <p role="alert">
            This question type is not supported in exam simulation yet.
          </p>
        )}
      </article>

      {error ? <p role="alert">{error}</p> : null}

      <div className="practice-test-footer">
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0}>
          Previous
        </button>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={index >= test.items.length - 1}
        >
          Next
        </button>
        <button
          type="button"
          className={marked ? "mark-review mark-review--active" : "mark-review"}
          aria-pressed={marked}
          onClick={toggleMark}
          disabled={expired}
        >
          {marked ? "Marked for review" : "Mark for review"}
        </button>
        <button
          type="button"
          className="primary practice-test-submit"
          onClick={() => (expired ? void submit(attempt) : setConfirming(true))}
          disabled={submitting}
        >
          {submitting ? "Submitting…" : expired ? "Submit now" : "Submit test"}
        </button>
      </div>

      {confirming ? (
        <div
          className="practice-test-confirm"
          role="dialog"
          aria-modal="true"
          aria-label="Submit practice test"
        >
          <p>
            You still have {unansweredCount(attempt)} unanswered question
            {unansweredCount(attempt) === 1 ? "" : "s"} and {markedCount(attempt)} marked
            for review. Submit anyway?
          </p>
          <div className="practice-test-confirm-actions">
            <button type="button" onClick={() => setConfirming(false)} disabled={submitting}>
              Keep working
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setConfirming(false);
                void submit(attempt);
              }}
              disabled={submitting}
            >
              Submit test
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PracticeTestStart({
  test,
  onStart,
  backTo,
}: {
  test: PracticeTestResponse;
  onStart: () => void;
  backTo: string;
}) {
  const multipleResponse = test.question_types.includes("multiple_response");
  return (
    <section className="practice-test-page practice-test-start">
      <Link to={backTo} className="track-hub-back">
        ← Back to the track
      </Link>
      <span className="badge">Exam Simulation</span>
      <h1>{test.title}</h1>
      <p className="muted">{test.exam_code}</p>

      <ul className="practice-test-facts">
        <li>{test.question_count} questions</li>
        <li>{test.time_limit_minutes} minutes</li>
        <li>
          Multiple Choice{multipleResponse ? " + Multiple Response" : ""}
        </li>
        <li>Answers are reviewed after final submission</li>
      </ul>

      <p className="muted">
        This is a fixed exam simulation. There is no feedback, scoring, or reward
        until you submit, and the timer keeps running if you leave the page.
      </p>

      <button type="button" className="primary" onClick={onStart}>
        Start practice test
      </button>
    </section>
  );
}

function PracticeTestResult({
  result,
  reviewIndex,
  onReviewIndex,
  backTo,
}: {
  result: PracticeTestResultResponse;
  reviewIndex: number;
  onReviewIndex: (index: number) => void;
  backTo: string;
}) {
  const item = result.questions[Math.min(reviewIndex, result.questions.length - 1)];
  const accuracy = Math.round(result.raw_accuracy * 100);

  return (
    <section className="practice-test-page" aria-label="Practice test results">
      <header className="practice-test-result-head">
        <span className="badge">Exam Simulation</span>
        <h1>{result.title}</h1>
      </header>

      <div className="practice-test-score">
        <p className="practice-test-score-main">
          Practice score: {result.correct_count} / {result.scored_question_count}{" "}
          scored questions
        </p>
        <p className="practice-test-score-sub">
          Raw accuracy: {accuracy}%
        </p>
        <p className="muted">{result.score_note}</p>
      </div>

      <ul className="practice-test-summary">
        <li>{result.answered_count} answered</li>
        <li>{result.unanswered_count} unanswered</li>
        <li>{result.scored_question_count} scored</li>
        <li>{result.total_questions - result.scored_question_count} unscored</li>
      </ul>

      <table className="practice-test-domains">
        <caption className="sr-only">Scored accuracy by domain</caption>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">Correct</th>
            <th scope="col">Scored</th>
          </tr>
        </thead>
        <tbody>
          {result.domain_breakdown.map((domain) => (
            <tr key={domain.domain_id}>
              <td>{domain.domain_id}</td>
              <td>{domain.correct}</td>
              <td>{domain.scored_count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Question review</h2>
      <PracticeTestItemReview item={item} />

      <div className="practice-test-actions">
        <button
          type="button"
          onClick={() => onReviewIndex(reviewIndex - 1)}
          disabled={reviewIndex === 0}
        >
          Previous
        </button>
        <span className="muted">
          {reviewIndex + 1} of {result.questions.length}
        </span>
        <button
          type="button"
          className="primary"
          onClick={() => onReviewIndex(reviewIndex + 1)}
          disabled={reviewIndex >= result.questions.length - 1}
        >
          Next
        </button>
      </div>

      <p>
        <Link to={backTo}>Back to the track</Link>
      </p>
    </section>
  );
}

function PracticeTestItemReview({ item }: { item: PracticeTestItemResult }) {
  const selectedIds = new Set(
    item.submitted_answer?.choice_ids ??
      (item.submitted_answer?.choice_id
        ? [item.submitted_answer.choice_id]
        : []),
  );
  const canonicalIds = new Set(
    item.canonical_answer.type === "multiple_choice"
      ? [item.canonical_answer.choice_id]
      : item.canonical_answer.type === "multiple_response"
        ? item.canonical_answer.choice_ids
        : [],
  );
  const choices =
    item.interaction.type === "multiple_choice" ||
    item.interaction.type === "multiple_response"
      ? item.interaction.choices
      : [];

  const state = item.is_scored
    ? item.correct
      ? "Correct"
      : item.answered
        ? "Incorrect"
        : "Unanswered"
    : "Unscored simulation item";

  return (
    <article className="practice-test-review-item">
      <p className="muted">
        Question {item.order} · {item.domain_id} · {state}
      </p>
      {item.instruction ? (
        <p className="question-instruction">{item.instruction}</p>
      ) : null}
      <h3 className="practice-test-prompt">
        <InlineText text={item.prompt} />
      </h3>

      <ul className="item-list choice-list review-choice-list">
        {choices.map((choice) => {
          const isCorrect = canonicalIds.has(choice.id);
          const isChosen = selectedIds.has(choice.id);
          const feedback = item.choice_feedback[choice.id];
          const marker = isCorrect
            ? isChosen
              ? "✓ your answer"
              : "✓ correct answer"
            : isChosen
              ? "✗ your answer"
              : "";
          return (
            <li
              key={choice.id}
              className={`review-choice${isCorrect ? " review-choice--correct" : ""}${
                isChosen && !isCorrect ? " review-choice--wrong" : ""
              }${!isCorrect && !isChosen ? " review-choice--neutral" : ""}`}
            >
              <span className="choice-label">
                <InlineText text={choice.label} />
              </span>
              {marker ? <span className="review-marker">{marker}</span> : null}
              {feedback ? (
                <span className="review-choice-feedback">
                  <InlineText text={feedback} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {item.explanation ? (
        <p className="practice-test-explanation">
          <InlineText text={item.explanation} />
        </p>
      ) : null}
    </article>
  );
}
