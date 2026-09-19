import { formatDuration, type MissionSummary } from "../state/summary";

interface PerformanceSummaryProps {
  summary: MissionSummary;
}

/**
 * Compact "Your Run" statistics.
 *
 * Intentionally secondary to the Bits reward. Recovery is framed as successful
 * learning rather than as a failure count.
 */
export default function PerformanceSummary({ summary }: PerformanceSummaryProps) {
  const { firstAttemptCorrect, recoveredAttempts, questionsCompleted } = summary;

  return (
    <section className="performance-summary" aria-labelledby="your-run-heading">
      <h2 id="your-run-heading">Your run</h2>

      <dl className="performance-stats">
        <div>
          <dt>Completed</dt>
          <dd data-testid="summary-completed">
            {questionsCompleted} / {summary.totalQuestions}
          </dd>
        </div>
        <div>
          <dt>First try</dt>
          <dd data-testid="summary-first-attempt">{firstAttemptCorrect}</dd>
        </div>
        <div>
          <dt>Recovered</dt>
          <dd data-testid="summary-recovered">{recoveredAttempts}</dd>
        </div>
        <div>
          <dt>Study time</dt>
          <dd data-testid="summary-study-time">
            {formatDuration(summary.studyTimeMs)}
          </dd>
        </div>
      </dl>

      <p className="performance-caption">
        {firstAttemptCorrect} first try · {recoveredAttempts} recovered
      </p>
      {recoveredAttempts > 0 ? (
        <p className="performance-note">
          Recovering {recoveredAttempts === 1 ? "a question" : "questions"} is
          how knowledge sticks.
        </p>
      ) : null}
    </section>
  );
}
