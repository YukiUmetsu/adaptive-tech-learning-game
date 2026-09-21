import { useEffect, useRef } from "react";

import type {
  AnswerPayload,
  FeedbackResponse,
  QuestionView,
} from "../api/types";
import { emitBitsEarned } from "../lib/bitsFly";
import { reviewDetails, canonicalConnectionCount } from "../state/feedback";
import { playCorrect, playWrong } from "../state/sound";
import AnimatedCheck from "./AnimatedCheck";
import InlineText from "./InlineText";

interface FeedbackPanelProps {
  feedback: FeedbackResponse;
  question: QuestionView;
  submitted: AnswerPayload | null;
  isLast: boolean;
  onRetry: () => void;
  onNext: () => void;
}

function humanize(code: string): string {
  return code.replaceAll("_", " ");
}

export default function FeedbackPanel({
  feedback,
  question,
  submitted,
  isLast,
  onRetry,
  onNext,
}: FeedbackPanelProps) {
  // Partial answers get the same gentle treatment as a wrong answer, tuned only
  // slightly by the score. Never a harsh failure state.
  const partial = !feedback.correct && feedback.score > 0;
  const state = feedback.correct ? "correct" : partial ? "partial" : "incorrect";
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (feedback.correct) {
      playCorrect();
    } else {
      playWrong();
    }
  }, [feedback.event_id, feedback.correct]);

  // Send earned Bits flying into the wallet from this panel.
  useEffect(() => {
    if (feedback.correct && feedback.bits_preview > 0) {
      emitBitsEarned(feedback.bits_preview, panelRef.current);
    }
  }, [feedback.event_id, feedback.correct, feedback.bits_preview]);

  const details = feedback.correct
    ? []
    : reviewDetails(question, submitted, feedback.canonical_answer);

  // Tell the learner how many relationships a correct connection answer needs.
  const connectionCount = canonicalConnectionCount(feedback.canonical_answer);

  return (
    <section
      ref={panelRef}
      className={`feedback ${state}`}
      aria-live="polite"
      data-testid="feedback"
    >
      {feedback.correct ? (
        <span className="feedback-sparkles" aria-hidden="true">
          ✦ ✧ ✦
        </span>
      ) : null}

      <div className="feedback-heading">
        {feedback.correct ? (
          <AnimatedCheck className="feedback-check" label={null} />
        ) : (
          <span className="feedback-badge" aria-hidden="true">
            {partial ? "≈" : "!"}
          </span>
        )}
        <h3>{feedback.correct ? "Correct" : "Not quite"}</h3>
        {feedback.bits_preview > 0 ? (
          <span className="bits-reward" data-testid="bits-reward">
            +{feedback.bits_preview} Bits
          </span>
        ) : null}
        <span className="feedback-score">
          {Math.round(feedback.score * 100)}%
        </span>
      </div>

      <p>
        <InlineText text={feedback.explanation} />
        {connectionCount != null ? (
          <span className="feedback-connection-count">
            {feedback.explanation ? " " : ""}
            ({connectionCount} relationship{connectionCount === 1 ? "" : "s"}{" "}
            needed)
          </span>
        ) : null}
      </p>

      {details.length > 0 ? (
        <div className="feedback-review">
          <h4>What to review</h4>
          <ul aria-label="What to review">
            {details.map((detail, index) => (
              <li
                key={`${detail.kind}-${index}`}
                className={`review-${detail.kind}`}
              >
                <InlineText text={detail.text} />
              </li>
            ))}
          </ul>
        </div>
      ) : feedback.error_codes.length > 0 ? (
        <ul aria-label="What to review">
          {feedback.error_codes.map((code) => (
            <li key={code}>{humanize(code)}</li>
          ))}
        </ul>
      ) : null}

      <div className="feedback-actions">
        {!feedback.correct ? (
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        <button type="button" className="primary" onClick={onNext}>
          {isLast ? "Finish mission" : "Next question"}
        </button>
      </div>
    </section>
  );
}
