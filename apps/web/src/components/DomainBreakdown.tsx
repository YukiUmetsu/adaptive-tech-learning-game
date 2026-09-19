export interface BreakdownRow {
  id: string;
  label: string;
  firstAttemptCorrect: number;
  totalQuestions: number;
}

interface DomainBreakdownProps {
  heading: string;
  rows: BreakdownRow[];
  /** Show a check for fully first-try-correct rows instead of a ratio. */
  showCheck?: boolean;
}

/**
 * Actual per-domain or per-task coverage for this run.
 *
 * No mastery percentages and no pass/fail labels: only counts from the quiz.
 */
export default function DomainBreakdown({
  heading,
  rows,
  showCheck = false,
}: DomainBreakdownProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="domain-breakdown" aria-labelledby="domain-breakdown-heading">
      <h2 id="domain-breakdown-heading">{heading}</h2>
      <ul>
        {rows.map((row) => {
          const perfect = row.firstAttemptCorrect === row.totalQuestions;
          return (
            <li key={row.id}>
              <span className="domain-breakdown-label">{row.label}</span>
              <span className="domain-breakdown-score">
                {showCheck && perfect ? (
                  <span
                    className="domain-breakdown-check"
                    aria-label="all correct on the first try"
                  >
                    ✓
                  </span>
                ) : (
                  `${row.firstAttemptCorrect} / ${row.totalQuestions}`
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
