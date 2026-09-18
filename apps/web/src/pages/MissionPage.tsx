import { Link, useParams } from "react-router-dom";

import FeedbackPanel from "../components/FeedbackPanel";
import MissionSummary from "../components/MissionSummary";
import QuestionCard from "../components/QuestionCard";
import { useMissionRunner } from "../hooks/useMissionRunner";

export default function MissionPage() {
  const { missionId } = useParams();
  const runner = useMissionRunner(missionId ?? "");

  if (runner.phase === "loading") {
    return <p role="status">Loading mission…</p>;
  }

  if (runner.phase === "missing" || !runner.mission || !runner.question) {
    return (
      <section>
        <h1>Mission unavailable</h1>
        <p>This mission is not stored on this device.</p>
        <p>
          <Link to="/certifications">Back to certifications</Link>
        </p>
      </section>
    );
  }

  if (runner.phase === "summary") {
    return (
      <MissionSummary
        mission={runner.mission}
        attempts={runner.attempts}
        syncState={runner.syncState}
        onRetrySync={() => void runner.sync()}
      />
    );
  }

  const isLast = runner.currentIndex === runner.total - 1;

  return (
    <section>
      <header className="mission-header" data-testid="mission-header">
        <div className="mission-meta">
          <span className="badge">SOA-C03 · Task {runner.mission.task_id}</span>
          <span className="muted">
            Question {runner.currentIndex + 1} of {runner.total}
          </span>
          <span className="muted interaction-tag">
            {runner.question.interaction_type.replaceAll("_", " ")}
          </span>
        </div>
        <h1>{runner.question.prompt}</h1>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={runner.total}
          aria-valuenow={runner.currentIndex + 1}
          aria-label="Mission progress"
        >
          <div
            className="progress-fill"
            style={{
              width: `${((runner.currentIndex + 1) / runner.total) * 100}%`,
            }}
          />
        </div>
      </header>

      <QuestionCard
        key={runner.question.id}
        question={runner.question}
        disabled={runner.submitting || runner.phase === "feedback"}
        onSubmit={(answer) => void runner.submit(answer)}
      />

      {runner.error ? <p role="alert">{runner.error}</p> : null}

      {runner.feedback ? (
        <FeedbackPanel
          feedback={runner.feedback}
          question={runner.question}
          submitted={runner.lastAnswer}
          isLast={isLast}
          onRetry={runner.retry}
          onNext={runner.next}
        />
      ) : null}
    </section>
  );
}
