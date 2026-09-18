import type {
  AnswerPayload,
  FeedbackResponse,
  QuestionView,
} from "../api/types";
import { reviewDetails } from "../state/feedback";

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
  const details = feedback.correct
    ? []
    : reviewDetails(question, submitted, feedback.canonical_answer);

  return (
    <section
      className={feedback.correct ? "feedback correct" : "feedback incorrect"}
      aria-live="polite"
      data-testid="feedback"
    >
      <div className="feedback-heading">
        <span className="feedback-badge" aria-hidden="true">
          {feedback.correct ? "✓" : "!"}
        </span>
        <h3>{feedback.correct ? "Correct" : "Not quite"}</h3>
        <span className="feedback-score">
          {Math.round(feedback.score * 100)}%
        </span>
      </div>

      <p>{feedback.explanation}</p>

      {details.length > 0 ? (
        <div className="feedback-review">
          <h4>What to review</h4>
          <ul aria-label="What to review">
            {details.map((detail, index) => (
              <li
                key={`${detail.kind}-${index}`}
                className={`review-${detail.kind}`}
              >
                {detail.text}
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
