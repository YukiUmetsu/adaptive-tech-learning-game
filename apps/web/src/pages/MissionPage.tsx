import { Link, useParams, useSearchParams } from "react-router-dom";

import BitsIcon from "../components/BitsIcon";
import ChallengeRunner from "../components/ChallengeRunner";
import FeedbackPanel from "../components/FeedbackPanel";
import InlineText from "../components/InlineText";
import QuestionCard from "../components/QuestionCard";
import QuizCompletionSummary from "../components/QuizCompletionSummary";
import { useCatalog } from "../hooks/useCatalog";
import { useMissionRunner } from "../hooks/useMissionRunner";
import { missionDomainName } from "../state/mission";
import { quizModeLabel } from "../state/quizModes";
import { useBitsBalance } from "../state/wallet";

export default function MissionPage() {
  const { missionId } = useParams();
  const [searchParams] = useSearchParams();
  const runner = useMissionRunner(missionId ?? "");
  const bits = useBitsBalance();
  const { state } = useCatalog();

  // Missions started from a Daily Mission return to the runner afterwards.
  const dailyTrack = searchParams.get("daily") ? searchParams.get("track") : null;
  const dailyReturnTo = dailyTrack ? `/tracks/${dailyTrack}/daily` : undefined;

  if (runner.phase === "loading") {
    return <p role="status">Loading mission…</p>;
  }

  if (runner.phase === "stale") {
    return (
      <section className="mission-page">
        <h1>Mission updated</h1>
        <p>
          This mission was built from an older version of the content and can no
          longer be scored. Start a new mission to continue.
        </p>
        <p>
          <Link to="/tracks">Back to learning tracks</Link>
        </p>
      </section>
    );
  }

  if (runner.phase === "missing" || !runner.mission) {
    return (
      <section className="mission-page">
        <h1>Mission unavailable</h1>
        <p>This mission is not stored on this device.</p>
        <p>
          <Link to="/tracks">Back to learning tracks</Link>
        </p>
      </section>
    );
  }

  // A challenge orchestrates its own ordered stages, including learning-node
  // stages that have no question. It owns the header and summary too.
  if (runner.mission.challenge) {
    return <ChallengeRunner runner={runner} dailyReturnTo={dailyReturnTo} />;
  }

  if (!runner.question) {
    return (
      <section className="mission-page">
        <h1>Mission unavailable</h1>
        <p>This mission is not stored on this device.</p>
        <p>
          <Link to="/tracks">Back to learning tracks</Link>
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
          dailyReturnTo={dailyReturnTo}
          onRetrySync={() => void runner.sync()}
        />
      </div>
    );
  }

  const isLast = runner.currentIndex === runner.total - 1;

  const domainName =
    state.status === "loaded"
      ? missionDomainName(runner.mission, state.data)
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
        <h1>
          <InlineText text={runner.question.prompt} />
        </h1>
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
        feedback={runner.feedback}
        canonicalAnswer={runner.question.canonical_answer}
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
