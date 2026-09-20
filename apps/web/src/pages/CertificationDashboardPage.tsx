import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import type { DomainDto, NodeProgressDto, QuizMode, TrackMapResponse } from "../api/types";
import { useAuth } from "../auth/context";
import BitsHud from "../components/BitsHud";
import KnowledgeSignalLegend from "../components/KnowledgeSignalLegend";
import NodeSignalPanel from "../components/NodeSignalPanel";
import StreakHud from "../components/StreakHud";
import TrackKnowledgeMap from "../components/TrackKnowledgeMap";
import { useCatalog } from "../hooks/useCatalog";
import { useDailyMission } from "../hooks/useDailyMission";
import { useRecommendation } from "../hooks/useRecommendation";
import { prefersReducedMotion } from "../lib/motion";
import { certificationQuestionCount, domainQuestionCount } from "../state/demo";
import { deriveNodeVisual } from "../state/knowledgeSignal";
import {
  deriveLearningState,
  loadDomainProgress,
  loadTrackDiscovery,
  type DerivedLearningState,
} from "../state/learningProgress";
import { startMission } from "../state/mission";
import { loadMission } from "../state/persistence";
import { quizModeLabel } from "../state/quizModes";
import { peekStreak, loadStreak, type Streak } from "../state/streak";
import { loadTrackMap } from "../state/trackMap";
import { loadTrackProgress, signalIndex } from "../state/trackProgress";
import { refreshWallet } from "../state/wallet";

interface Launch {
  mode: QuizMode;
  domainId?: string;
  key: string;
}

/**
 * Learning Track hub.
 *
 * The Knowledge Map is the centerpiece; the streak, Bits, Daily Mission, and
 * practice controls are compact and secondary. Every enhancement (map content,
 * Knowledge Signal, streak, recommendation, Daily Mission) loads independently
 * and degrades to a normal, usable page on failure. No percentages, pass
 * estimates, or negative states are shown.
 */
export default function CertificationDashboardPage() {
  const { certificationId } = useParams();
  const { state } = useCatalog();
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useAuth();
  const authenticated = status === "authenticated";

  const [view, setView] = useState<"map" | "practice">("map");
  const [starting, setStarting] = useState<string | null>(null);
  const [choosingDomain, setChoosingDomain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [trackMap, setTrackMap] = useState<TrackMapResponse | null>(null);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [signals, setSignals] = useState<Map<string, NodeProgressDto>>(
    new Map(),
  );
  const [streak, setStreak] = useState<Streak | null>(null);
  const [streakPulse, setStreakPulse] = useState(false);

  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    void refreshWallet();
  }, []);

  const certification = state.status === "loaded"
    ? state.data.certifications.find((entry) => entry.id === certificationId)
    : undefined;
  const version = certification?.versions[0];
  const trackVersion = version?.id;

  // Local discovery progress is the source of truth for the discovery dimension.
  const discovery = useMemo(
    () => (authenticated && trackVersion ? loadTrackDiscovery(trackVersion) : []),
    [authenticated, trackVersion],
  );

  const { state: recommendationState } = useRecommendation({
    trackId: certificationId,
    enabled: authenticated,
    discovery,
  });
  const { state: dailyState } = useDailyMission({
    trackId: certificationId,
    enabled: authenticated,
    discovery,
  });

  // Map content: one aggregate request. Failing here falls back to the normal
  // per-domain navigation instead of breaking the page.
  useEffect(() => {
    if (!authenticated || !certificationId) {
      setTrackMap(null);
      setMapStatus("ready");
      return;
    }
    let cancelled = false;
    setMapStatus("loading");
    void loadTrackMap(certificationId).then((map) => {
      if (cancelled) {
        return;
      }
      setTrackMap(map);
      setMapStatus(map ? "ready" : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, certificationId]);

  // Knowledge Signal: one aggregate request, refreshed when the track opens.
  useEffect(() => {
    if (!authenticated || !certificationId) {
      setSignals(new Map());
      return;
    }
    let cancelled = false;
    void loadTrackProgress(certificationId, true).then((progress) => {
      if (!cancelled) {
        setSignals(signalIndex(progress));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, certificationId]);

  // Streak: bundled with the account response, refreshed on track open. A pulse
  // plays only when today's streak just activated during this session.
  useEffect(() => {
    if (!authenticated) {
      setStreak(null);
      return;
    }
    let cancelled = false;
    const previous = peekStreak();
    void loadStreak(true).then((fresh) => {
      if (cancelled) {
        return;
      }
      setStreak(fresh);
      if (previous && fresh && !previous.activeToday && fresh.activeToday) {
        setStreakPulse(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, certificationId]);

  const derivedByDomain = useMemo(() => {
    const result: Record<string, DerivedLearningState> = {};
    if (!trackMap || !trackVersion) {
      return result;
    }
    for (const domain of trackMap.domains) {
      result[domain.domain.id] = deriveLearningState(
        domain,
        loadDomainProgress(trackVersion, domain.domain.id),
      );
    }
    return result;
  }, [trackMap, trackVersion]);

  const selected = useMemo(() => {
    if (!trackMap || !selectedNodeId) {
      return null;
    }
    for (const domain of trackMap.domains) {
      for (const module of domain.modules) {
        const node = module.nodes.find((candidate) => candidate.id === selectedNodeId);
        if (node) {
          return { node, domain, module };
        }
      }
    }
    return null;
  }, [trackMap, selectedNodeId]);

  const recommendation =
    recommendationState.status === "loaded" ? recommendationState.recommendation : null;
  const recommendedNodeId =
    recommendation &&
    (recommendation.action === "learn_node" ||
      recommendation.action === "review_node")
      ? recommendation.node_id ?? null
      : null;

  const selectedVisual =
    selected && trackMap
      ? deriveNodeVisual(
          selected.node.id,
          derivedByDomain[selected.domain.domain.id]?.nodeState[selected.node.id] ??
            "ready",
          signals.get(selected.node.id),
          recommendedNodeId,
        )
      : null;

  const launch = useCallback(
    async ({ mode, domainId, key }: Launch) => {
      if (!certification || !version) {
        return;
      }
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
    },
    [certification, version, status, location, navigate],
  );

  const startRecommendedPractice = useCallback(async () => {
    if (!recommendation || !certification || !version) {
      return;
    }
    setStarting("recommended");
    setError(null);
    try {
      const useQuestion =
        recommendation.action === "practice_question" &&
        recommendation.question_id != null;
      const mission = await startMission(
        useQuestion
          ? {
              certificationId: certification.id,
              certificationVersion: version.id,
              mode: "recommended_practice",
              questionId: recommendation.question_id ?? undefined,
              recommendationId: recommendationState.status === "loaded"
                ? recommendationState.recommendationId ?? undefined
                : undefined,
            }
          : {
              certificationId: certification.id,
              certificationVersion: version.id,
              mode: "domain_quiz",
              domainId: recommendation.domain_id,
              recommendationId: recommendationState.status === "loaded"
                ? recommendationState.recommendationId ?? undefined
                : undefined,
            },
      );
      navigate(`/missions/${mission.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start practice.");
    } finally {
      setStarting(null);
    }
  }, [recommendation, recommendationState, certification, version, navigate]);

  if (state.status === "loading") {
    return <p role="status">Loading certification…</p>;
  }

  if (state.status === "error") {
    return <p role="alert">Could not load the catalog: {state.message}</p>;
  }

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
    stored && !stored.finished && stored.mission.certification_id === certification.id
      ? stored
      : null;

  const dailyMission =
    dailyState.status === "loaded" ? dailyState.mission : null;

  const practiceControls = (
    <div className="hub-practice">
      <button
        type="button"
        className="hub-practice-btn hub-practice-btn--quick"
        disabled={starting !== null}
        onClick={() => void launch({ mode: "quick_adaptive", key: "quick" })}
      >
        <span aria-hidden="true">⚡</span>
        {starting === "quick" ? "Starting…" : "Start Quick Quiz"}
      </button>
      <button
        type="button"
        className="hub-practice-btn"
        disabled={starting !== null}
        onClick={() => {
          setView("practice");
          setChoosingDomain(true);
        }}
      >
        <span aria-hidden="true">🎯</span>
        Choose Domain
      </button>
      <button
        type="button"
        className="hub-practice-btn"
        disabled={starting !== null}
        onClick={() => void launch({ mode: "full_practice", key: "full" })}
      >
        <span aria-hidden="true">🏁</span>
        {starting === "full" ? "Starting…" : "Start Full Practice"}
      </button>
    </div>
  );

  const domainPicker = choosingDomain ? (
    <section className="hub-domain-picker" aria-label="Choose a domain">
      <div className="hub-domain-picker-head">
        <h2>Choose a domain</h2>
        <button type="button" onClick={() => setChoosingDomain(false)}>
          Close
        </button>
      </div>
      <ul className="hub-domain-list">
        {domains.map((domain: DomainDto) => (
          <li key={domain.id}>
            <button
              type="button"
              disabled={starting !== null}
              onClick={() =>
                void launch({
                  mode: "domain_quiz",
                  domainId: domain.id,
                  key: `picker-${domain.id}`,
                })
              }
            >
              <span>{domain.name}</span>
              <span className="muted">
                {Math.round(domain.weight * 100)}% · {domainQuestionCount(domain)} questions
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  const fallbackDomains = (
    <ul className="hub-fallback-domains" aria-label="Exam domains">
      {domains.map((domain: DomainDto) => (
        <li key={domain.id}>
          <div className="hub-fallback-domain">
            <div>
              <p className="hub-fallback-name">{domain.name}</p>
              <p className="muted">
                {Math.round(domain.weight * 100)}% · {domainQuestionCount(domain)} questions
              </p>
            </div>
            <div className="hub-fallback-actions">
              {domain.learning_available ? (
                <Link
                  className="primary"
                  to={`/tracks/${certification.id}/domains/${domain.id}/learn`}
                  aria-label={`Explore Domain: ${domain.name}`}
                >
                  Explore
                </Link>
              ) : null}
              <button
                type="button"
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
                Domain Quiz
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="track-hub">
      <header className="track-hub-head">
        <div className="track-hub-title">
          <Link to="/tracks" className="track-hub-back">
            ← Learning Tracks
          </Link>
          <h1>{certification.name}</h1>
          <p className="muted track-hub-subtitle">
            Explore. Learn. Practice. Build real skills.
          </p>
        </div>

        <nav className="track-hub-tabs" aria-label="Track views">
          <button
            type="button"
            aria-current={view === "map" ? "page" : undefined}
            onClick={() => setView("map")}
          >
            <span aria-hidden="true">🗺️</span> Knowledge Map
          </button>
          <Link to={`/tracks/${certification.id}/daily`}>
            <span aria-hidden="true">🧭</span> Daily Mission
          </Link>
          <button
            type="button"
            aria-current={view === "practice" ? "page" : undefined}
            onClick={() => setView("practice")}
          >
            <span aria-hidden="true">🎯</span> Practice
          </button>
        </nav>

        <div className="track-hub-hud">
          {streak ? <StreakHud streak={streak} justActivated={streakPulse} /> : null}
          <BitsHud />
        </div>
      </header>

      {resumable ? (
        <p className="track-hub-resume">
          <Link to={`/missions/${resumable.mission.id}`}>
            Resume your {quizModeLabel(resumable.mission.mode)}
          </Link>
        </p>
      ) : null}

      {view === "map" ? (
        <div className="track-hub-map-layout">
          <div className="track-hub-map">
            {mapStatus === "loading" ? (
              <p role="status" className="track-hub-map-status">
                Lighting up your map…
              </p>
            ) : null}
            {trackMap ? (
              <TrackKnowledgeMap
                map={trackMap}
                signals={signals}
                derivedByDomain={derivedByDomain}
                selectedNodeId={selectedNodeId}
                recommendedNodeId={recommendedNodeId}
                reducedMotion={reducedMotion}
                onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
              />
            ) : null}
            {mapStatus === "error" || !authenticated ? fallbackDomains : null}
          </div>

          <aside className="track-hub-side">
            {selected && selectedVisual ? (
              <NodeSignalPanel
                node={selected.node}
                domainName={selected.domain.domain.name}
                moduleTitle={selected.module.title}
                visual={selectedVisual}
                onExplore={() =>
                  navigate(
                    `/tracks/${certification.id}/domains/${selected.domain.domain.id}/learn?node=${encodeURIComponent(selected.node.id)}`,
                  )
                }
                onClose={() => setSelectedNodeId(null)}
              />
            ) : (
              <KnowledgeSignalLegend />
            )}

            {recommendation &&
            (recommendation.action === "practice_question" ||
              recommendation.action === "practice_domain") ? (
              <div className="hub-next-practice">
                <p className="hub-next-practice-title">{recommendation.title}</p>
                <button
                  type="button"
                  className="primary"
                  disabled={starting !== null}
                  onClick={() => void startRecommendedPractice()}
                >
                  {starting === "recommended" ? "Starting…" : "Start practice"}
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      ) : (
        <section className="track-hub-practice-view" aria-label="Practice">
          <h2>Practice</h2>
          <p className="muted">
            {totalQuestions} questions across {domains.length} domains.
          </p>
          {domainPicker}
        </section>
      )}

      <div className="track-hub-actions">
        {practiceControls}
        {dailyMission ? (
          <Link className="primary hub-daily-cta" to={`/tracks/${certification.id}/daily`}>
            <span aria-hidden="true">🧭</span>
            {dailyMission.status === "completed"
              ? "Review today's Daily Mission"
              : "Continue Daily Mission"}
            <span className="hub-daily-progress muted">
              {dailyMission.completed_items} / {dailyMission.total_items}
            </span>
          </Link>
        ) : null}
      </div>

      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
