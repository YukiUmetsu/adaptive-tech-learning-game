import { Link } from "react-router-dom";

import type { MissionResponse } from "../api/types";
import type { SyncState } from "../hooks/useMissionRunner";
import type { AttemptRecord } from "../state/persistence";
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

  return (
    <section aria-labelledby="summary-heading">
      <h1 id="summary-heading">Mission summary</h1>

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
      </dl>

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
