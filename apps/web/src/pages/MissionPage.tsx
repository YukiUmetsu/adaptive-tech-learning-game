import { Link, useParams } from "react-router-dom";

import BitsIcon from "../components/BitsIcon";
import FeedbackPanel from "../components/FeedbackPanel";
import QuestionCard from "../components/QuestionCard";
import QuizCompletionSummary from "../components/QuizCompletionSummary";
import { useCatalog } from "../hooks/useCatalog";
import { useMissionRunner } from "../hooks/useMissionRunner";
import { quizModeLabel } from "../state/quizModes";
import { useBitsBalance } from "../state/wallet";

export default function MissionPage() {
  const { missionId } = useParams();
  const runner = useMissionRunner(missionId ?? "");
  const bits = useBitsBalance();
  const { state } = useCatalog();

  if (runner.phase === "loading") {
    return <p role="status">Loading mission…</p>;
  }

  if (runner.phase === "missing" || !runner.mission || !runner.question) {
    return (
      <section className="mission-page">
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
      <div className="mission-page">
        <QuizCompletionSummary
          mission={runner.mission}
          attempts={runner.attempts}
          syncState={runner.syncState}
          onRetrySync={() => void runner.sync()}
        />
      </div>
    );
  }

  const isLast = runner.currentIndex === runner.total - 1;

  const domainName =
    runner.mission.domain_id && state.status === "loaded"
      ? state.data.certifications
          .flatMap((certification) => certification.versions)
          .flatMap((version) => version.domains)
          .find((domain) => domain.id === runner.mission?.domain_id)?.name
      : undefined;

  return (
    <section className="mission-page">
      <header className="mission-header" data-testid="mission-header">
        <div className="mission-meta">
          <span className="badge">{quizModeLabel(runner.mission.mode)}</span>
          {domainName ? <span className="muted">{domainName}</span> : null}
          <span className="muted">
            Question {runner.currentIndex + 1} of {runner.total}
          </span>
          <span className="mission-bits" aria-label={`${bits} Bits`}>
            <BitsIcon className="bits-icon" /> {bits.toLocaleString()}
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
