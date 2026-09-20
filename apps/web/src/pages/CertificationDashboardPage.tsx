import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import type { DomainDto, QuizMode } from "../api/types";
import { useAuth } from "../auth/context";
import BitsHud from "../components/BitsHud";
import RecommendedNext from "../components/RecommendedNext";
import StudySessionCard from "../components/StudySessionCard";
import { useCatalog } from "../hooks/useCatalog";
import { certificationQuestionCount, domainQuestionCount } from "../state/demo";
import { startMission } from "../state/mission";
import { loadMission } from "../state/persistence";
import {
  DOMAIN_QUIZ,
  FULL_PRACTICE,
  QUICK_QUIZ,
  quizModeLabel,
  type QuizModePresentation,
} from "../state/quizModes";
import { refreshWallet } from "../state/wallet";

interface Launch {
  mode: QuizMode;
  domainId?: string;
  key: string;
}

export default function CertificationDashboardPage() {
  const { certificationId } = useParams();
  const { state } = useCatalog();
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useAuth();
  const [starting, setStarting] = useState<string | null>(null);
  const [choosingDomain, setChoosingDomain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshWallet();
  }, []);

  if (state.status === "loading") {
    return <p role="status">Loading certification…</p>;
  }

  if (state.status === "error") {
    return <p role="alert">Could not load the catalog: {state.message}</p>;
  }

  const certification = state.data.certifications.find(
    (entry) => entry.id === certificationId,
  );
  const version = certification?.versions[0];
  if (!certification || !version) {
    return (
      <section>
        <h1>Certification not found</h1>
        <p>
          <Link to="/tracks">Back to learning tracks</Link>
        </p>
      </section>
    );
  }

  const domains = version.domains;
  const totalQuestions = certificationQuestionCount(certification);
  const stored = loadMission();
  const resumable =
    stored &&
    !stored.finished &&
    stored.mission.certification_id === certification.id
      ? stored
      : null;

  const launch = async ({ mode, domainId, key }: Launch) => {
    // Scored missions are user-owned, so an anonymous learner is sent to sign
    // in first and returned to this dashboard afterwards.
    if (status !== "authenticated") {
      const returnTo = `${location.pathname}${location.search}`;
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    setStarting(key);
    setError(null);
    try {
      const mission = await startMission({
        certificationId: certification.id,
        certificationVersion: version.id,
        mode,
        domainId,
      });
      navigate(`/missions/${mission.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Network error");
    } finally {
      setStarting(null);
    }
  };

  const modeCard = (presentation: QuizModePresentation, onStart: () => void, key: string) => (
    <article className={`mode-card mode-${presentation.key}`}>
      <div className="mode-card-heading">
        <span className="mode-icon" aria-hidden="true">
          {presentation.icon}
        </span>
        <h3>{presentation.label}</h3>
      </div>
      <p>{presentation.questionLabel}</p>
      <p className="muted">{presentation.duration}</p>
      <p className="mode-horizon muted">{presentation.horizon}</p>
      <button
        type="button"
        className="primary"
        disabled={starting !== null}
        onClick={onStart}
      >
        {starting === key
          ? "Starting…"
          : presentation.key === "domain_quiz"
            ? "Choose Domain"
            : `Start ${presentation.label}`}
      </button>
    </article>
  );

  const domainButton = (domain: DomainDto, index: number, key: string) => (
    <button
      type="button"
      className="domain-node"
      disabled={starting !== null}
      onClick={() => void launch({ mode: "domain_quiz", domainId: domain.id, key })}
    >
      <span className="domain-number">Domain {index + 1}</span>
      <span className="domain-name">{domain.name}</span>
      <span className="domain-meta">
        {Math.round(domain.weight * 100)}% · {domainQuestionCount(domain)} questions
      </span>
    </button>
  );

  const domainCard = (domain: DomainDto, index: number) => (
    <article className="domain-card">
      <div className="domain-card-heading">
        <span className="domain-number">Domain {index + 1}</span>
        <h3 className="domain-name">{domain.name}</h3>
        <span className="domain-meta">
          {Math.round(domain.weight * 100)}% · {domainQuestionCount(domain)} questions
        </span>
      </div>
      <div className="domain-card-actions">
        {domain.learning_available ? (
          <Link
            className="primary domain-explore"
            to={`/tracks/${certification.id}/domains/${domain.id}/learn`}
            aria-label={`Explore Domain: ${domain.name}`}
          >
            Explore Domain
          </Link>
        ) : null}
        <button
          type="button"
          className={domain.learning_available ? "" : "primary"}
          disabled={starting !== null}
          aria-label={`Start Domain Quiz for ${domain.name}`}
          onClick={() =>
            void launch({
              mode: "domain_quiz",
              domainId: domain.id,
              key: `card-${domain.id}`,
            })
          }
        >
          {starting === `card-${domain.id}` ? "Starting…" : "Domain Quiz"}
        </button>
      </div>
    </article>
  );

  return (
    <section className="dashboard">
      <header className="dashboard-hud">
        <div>
          <p className="muted">
            {certification.vendor} · {certification.exam_code}
          </p>
          <h1>{certification.name}</h1>
        </div>
        <BitsHud />
      </header>

      {resumable ? (
        <p className="dashboard-resume">
          <Link to={`/missions/${resumable.mission.id}`}>
            Resume your {quizModeLabel(resumable.mission.mode)}
          </Link>
        </p>
      ) : null}

      {/* Optional and best-effort: hidden on any failure, never blocks the page. */}
      <RecommendedNext
        trackId={certification.id}
        trackVersion={version.id}
        enabled={status === "authenticated"}
      />

      {/* Optional adaptive session with a standard fallback; never required. */}
      <StudySessionCard
        trackId={certification.id}
        trackVersion={version.id}
        domains={domains}
        enabled={status === "authenticated"}
      />

      <article className="campaign-panel">
        <h2>Campaign</h2>
        <dl className="campaign-stats">
          <div>
            <dt>Exam</dt>
            <dd>{certification.exam_code}</dd>
          </div>
          <div>
            <dt>Questions</dt>
            <dd>{totalQuestions}</dd>
          </div>
          <div>
            <dt>Domains</dt>
            <dd>{domains.length}</dd>
          </div>
          <div>
            <dt>Content</dt>
            <dd>{version.content_version}</dd>
          </div>
        </dl>
        <p className="muted">
          Blueprint reviewed {certification.last_reviewed}. Complete quizzes to
          build your knowledge profile.
        </p>
      </article>

      <h2>Quiz modes</h2>
      <div className="mode-grid">
        {modeCard(QUICK_QUIZ, () => void launch({ mode: "quick_adaptive", key: "quick" }), "quick")}
        {modeCard(DOMAIN_QUIZ, () => setChoosingDomain(true), "domain")}
        {modeCard(FULL_PRACTICE, () => void launch({ mode: "full_practice", key: "full" }), "full")}
      </div>

      {error ? <p role="alert">{error}</p> : null}

      {choosingDomain ? (
        <section className="domain-picker" aria-label="Choose a domain">
          <div className="domain-picker-heading">
            <h2>Choose a domain</h2>
            <button type="button" onClick={() => setChoosingDomain(false)}>
              Close
            </button>
          </div>
          <ul className="domain-map">
            {domains.map((domain, index) => (
              <li key={domain.id}>
                {domainButton(domain, index, `picker-${domain.id}`)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2>Domain map</h2>
      <ul className="domain-map" aria-label="Exam domains">
        {domains.map((domain, index) => (
          <li key={domain.id}>{domainCard(domain, index)}</li>
        ))}
      </ul>
    </section>
  );
}
