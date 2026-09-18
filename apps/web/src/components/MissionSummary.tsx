import { Link } from "react-router-dom";

import type { MissionResponse } from "../api/types";
import { useCatalog } from "../hooks/useCatalog";
import type { SyncState } from "../hooks/useMissionRunner";
import type { AttemptRecord } from "../state/persistence";
import { quizModeLabel } from "../state/quizModes";
import { computeSummary, formatDuration } from "../state/summary";

interface MissionSummaryProps {
  mission: MissionResponse;
  attempts: AttemptRecord[];
  syncState: SyncState;
  onRetrySync: () => void;
}

export default function MissionSummary({
  mission,
  attempts,
  syncState,
  onRetrySync,
}: MissionSummaryProps) {
  const summary = computeSummary(mission, attempts, syncState.pending);
  const { state } = useCatalog();

  const domainName = (domainId: string): string => {
    if (state.status !== "loaded") {
      return domainId;
    }
    return (
      state.data.certifications
        .flatMap((certification) => certification.versions)
        .flatMap((version) => version.domains)
        .find((domain) => domain.id === domainId)?.name ?? domainId
    );
  };

  return (
    <section aria-labelledby="summary-heading">
      <h1 id="summary-heading">Mission summary</h1>
      <p className="muted">{quizModeLabel(mission.mode)}</p>

      <dl className="summary-grid">
        <div>
          <dt>Questions completed</dt>
          <dd data-testid="summary-completed">
            {summary.questionsCompleted} / {summary.totalQuestions}
          </dd>
        </div>
        <div>
          <dt>First-attempt correct</dt>
          <dd data-testid="summary-first-attempt">
            {summary.firstAttemptCorrect}
          </dd>
        </div>
        <div>
          <dt>Recovered attempts</dt>
          <dd data-testid="summary-recovered">
            {summary.recoveredAttempts}
          </dd>
        </div>
        <div>
          <dt>Study time</dt>
          <dd data-testid="summary-study-time">
            {formatDuration(summary.studyTimeMs)}
          </dd>
        </div>
        <div>
          <dt>Bits earned</dt>
          <dd data-testid="summary-bits">◇ {summary.bitsEarned}</dd>
        </div>
      </dl>

      {mission.mode === "domain_quiz" && mission.domain_id ? (
        <p className="muted">Domain: {domainName(mission.domain_id)}</p>
      ) : null}

      {mission.mode === "full_practice" && summary.domains.length > 0 ? (
        <>
          <h2>Coverage by domain</h2>
          <ul className="summary-domains">
            {summary.domains.map((domain) => (
              <li key={domain.domainId}>
                <span>{domainName(domain.domainId)}</span>
                <span className="muted">
                  {domain.firstAttemptCorrect} / {domain.totalQuestions}{" "}
                  first-attempt
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>Concepts practiced</h2>
      {summary.conceptsPracticed.length === 0 ? (
        <p className="muted">No concepts recorded.</p>
      ) : (
        <ul>
          {summary.conceptsPracticed.map((concept) => (
            <li key={concept}>{concept}</li>
          ))}
        </ul>
      )}

      <h2>Sync</h2>
      {summary.pendingEvents === 0 ? (
        <p role="status">All learning events synced.</p>
      ) : (
        <div role="status">
          <p data-testid="summary-pending">
            {summary.pendingEvents} learning event
            {summary.pendingEvents === 1 ? "" : "s"} waiting to sync.
          </p>
          <button
            type="button"
            disabled={syncState.status === "syncing"}
            onClick={onRetrySync}
          >
            {syncState.status === "syncing" ? "Syncing…" : "Retry sync"}
          </button>
        </div>
      )}
      {syncState.message ? <p className="muted">{syncState.message}</p> : null}

      <p>
        <Link to="/certifications">Back to certifications</Link>
      </p>
    </section>
  );
}
