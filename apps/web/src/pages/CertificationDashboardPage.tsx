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
import { dailyActivityPresentation } from "../state/dailyMission";
import { publishFocusDaily } from "../state/focusDaily";
import { deriveNodeVisual } from "../state/knowledgeSignal";
import {
  deriveLearningState,
  loadDomainProgress,
  loadTrackDiscovery,
  type DerivedLearningState,
} from "../state/learningProgress";
import { startMission } from "../state/mission";
import { loadMission } from "../state/persistence";
import {
  DEFAULT_SETTINGS,
  loadAccount,
  peekAccount,
  saveUnlockAllMaterials,
  type Streak,
  type UserSettings,
} from "../state/account";
import {
  DOMAIN_QUIZ,
  FULL_PRACTICE,
  QUICK_QUIZ,
  quizModeLabel,
  type QuizModePresentation,
} from "../state/quizModes";
import { loadTrackMap } from "../state/trackMap";
import { loadTrackProgress, signalIndex } from "../state/trackProgress";
import { refreshWallet } from "../state/wallet";
import { shortDomainName } from "../state/domainNames";
import { ANSWER_REWARD_RANGE } from "../state/rewards";
import DailyMissionRunner from "../components/DailyMissionRunner";

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

  const [view, setView] = useState<"map" | "daily" | "practice">("map");
  const [starting, setStarting] = useState<string | null>(null);
  const [choosingDomain, setChoosingDomain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeDomainId, setActiveDomainId] = useState<string | null>(null);

  const [trackMap, setTrackMap] = useState<TrackMapResponse | null>(null);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [signals, setSignals] = useState<Map<string, NodeProgressDto>>(
    new Map(),
  );
  const [streak, setStreak] = useState<Streak | null>(null);
  const [streakPulse, setStreakPulse] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

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
  const { state: dailyState, reload: reloadDaily } = useDailyMission({
    trackId: certificationId,
    enabled: authenticated,
    discovery,
  });

  // Publish the Daily Mission projection for the floating Focus widget when the
  // runner is not mounted. The runner owns it while the daily view is open, so
  // this never fights the learner's local progress.
  useEffect(() => {
    if (view === "daily" || dailyState.status !== "loaded") {
      return;
    }
    const mission = dailyState.mission;
    if (mission.status === "completed") {
      publishFocusDaily(null);
      return;
    }
    const nextItem =
      mission.items.find((item) => item.status === "pending") ?? null;
    const presentation = nextItem ? dailyActivityPresentation(nextItem) : null;
    publishFocusDaily({
      trackId: certification?.id ?? mission.track_id,
      completed: mission.completed_items,
      total: mission.total_items,
      nextTitle: presentation?.primary ?? null,
      nextMinutes: nextItem?.estimated_minutes ?? null,
    });
  }, [view, dailyState, certification?.id]);

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
      setSettings(DEFAULT_SETTINGS);
      return;
    }
    let cancelled = false;
    const previous = peekAccount();
    void loadAccount(true).then((account) => {
      if (cancelled || !account) {
        return;
      }
      setStreak(account.streak);
      setSettings(account.settings);
      if (previous && !previous.streak.activeToday && account.streak.activeToday) {
        setStreakPulse(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, certificationId]);

  // Refresh account + Daily Mission at natural boundaries: returning to the tab
  // or after a mission completes elsewhere. No polling.
  useEffect(() => {
    if (!authenticated) {
      return;
    }
    const refresh = () => {
      void loadAccount(true).then((account) => {
        if (account) {
          setStreak(account.streak);
          setSettings(account.settings);
        }
      });
      // Do not auto-advance the runner the learner is currently reading; the
      // mission reloads when they advance or switch views.
      if (view !== "daily") {
        void reloadDaily();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    window.addEventListener("adaptive-learn:study-updated", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("adaptive-learn:study-updated", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authenticated, reloadDaily, view]);

  // Keep the visible domain on a valid one as the map loads or the track changes.
  useEffect(() => {
    if (!trackMap || trackMap.domains.length === 0) {
      setActiveDomainId(null);
      return;
    }
    if (
      !activeDomainId ||
      !trackMap.domains.some((domain) => domain.domain.id === activeDomainId)
    ) {
      setActiveDomainId(trackMap.domains[0].domain.id);
    }
  }, [trackMap, activeDomainId]);

  const derivedByDomain = useMemo(() => {
    const result: Record<string, DerivedLearningState> = {};
    if (!trackMap || !trackVersion) {
      return result;
    }
    for (const domain of trackMap.domains) {
      result[domain.domain.id] = deriveLearningState(
        domain,
        loadDomainProgress(trackVersion, domain.domain.id),
        {
          guided: !settings.unlockAllMaterials,
          unlockAll: settings.unlockAllMaterials,
        },
      );
    }
    return result;
  }, [trackMap, trackVersion, settings.unlockAllMaterials]);

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

  const toggleUnlockAll = useCallback(async (next: boolean) => {
    setSettings((current) => ({ ...current, unlockAllMaterials: next }));
    const stored = await saveUnlockAllMaterials(next);
    if (stored) {
      setSettings(stored);
    }
  }, []);

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

  // Full name (not the short pill label) of the domain currently shown.
  const activeDomain =
    trackMap?.domains.find((entry) => entry.domain.id === activeDomainId) ??
    trackMap?.domains[0] ??
    null;

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

  const modeCard = (presentation: QuizModePresentation) => {
    const isDomain = presentation.key === "domain_quiz";
    return (
      <article
        key={presentation.key}
        className={`mode-card mode-${presentation.key} hub-mode-card`}
      >
        <div className="mode-card-heading">
          <span className="mode-icon" aria-hidden="true">
            {presentation.icon}
          </span>
          <h3>{presentation.label}</h3>
        </div>
        <p className="hub-mode-questions">{presentation.questionLabel}</p>
        <p className="muted">{presentation.duration}</p>
        <p className="mode-horizon muted">{presentation.horizon}</p>
        <span className="hub-mode-reward">
          <span aria-hidden="true">💰</span> Earn {ANSWER_REWARD_RANGE} Bits per
          correct answer
        </span>
        <button
          type="button"
          className="primary"
          disabled={starting !== null}
          onClick={() => {
            if (isDomain) {
              setChoosingDomain(true);
              return;
            }
            void launch({ mode: presentation.key, key: presentation.key });
          }}
        >
          {starting === presentation.key
            ? "Starting…"
            : isDomain
              ? "Choose Domain"
              : `Start ${presentation.label}`}
        </button>
      </article>
    );
  };

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
              <p className="hub-fallback-name" title={domain.name}>
                {shortDomainName(domain.name)}
              </p>
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
          <button
            type="button"
            aria-current={view === "daily" ? "page" : undefined}
            onClick={() => {
              setView("daily");
              void reloadDaily();
            }}
          >
            <span aria-hidden="true">🧭</span> Daily Mission
          </button>
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
            {trackMap && trackMap.domains.length > 0 ? (
              <nav className="hub-domain-switcher" aria-label="Knowledge map domains">
                {trackMap.domains.map((domain) => {
                  const derived = derivedByDomain[domain.domain.id];
                  const unlocked = derived?.unlockedCount ?? 0;
                  const total = derived?.totalNodeCount ?? 0;
                  const complete = derived?.domainComplete ?? false;
                  const active = activeDomainId === domain.domain.id;
                  return (
                    <button
                      key={domain.domain.id}
                      type="button"
                      className={`hub-domain-pill${
                        active ? " hub-domain-pill--active" : ""
                      }${complete ? " hub-domain-pill--complete" : ""}`}
                      aria-current={active ? "true" : undefined}
                      aria-label={`${domain.domain.name}, ${unlocked} of ${total} nodes explored`}
                      title={domain.domain.name}
                      onClick={() => {
                        setActiveDomainId(domain.domain.id);
                        setSelectedNodeId(null);
                      }}
                    >
                      <span className="hub-domain-pill-top">
                        <span className="hub-domain-pill-name">
                          {shortDomainName(domain.domain.name)}
                        </span>
                        <span className="hub-domain-pill-progress" aria-hidden="true">
                          {unlocked}/{total}
                        </span>
                      </span>
                      <span className="hub-domain-pill-bar" aria-hidden="true">
                        <span
                          className="hub-domain-pill-bar-fill"
                          style={{
                            width: `${total > 0 ? (unlocked / total) * 100 : 0}%`,
                          }}
                        />
                      </span>
                    </button>
                  );
                })}
              </nav>
            ) : null}

            {activeDomain ? (
              <h2 className="track-hub-map-domain">
                {activeDomain.domain.name}
              </h2>
            ) : null}

            {mapStatus === "loading" ? (
              <p role="status" className="track-hub-map-status">
                Lighting up your map…
              </p>
            ) : null}
            {trackMap ? (
              <TrackKnowledgeMap
                map={trackMap}
                activeDomainId={activeDomainId}
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
                domainName={shortDomainName(selected.domain.domain.name)}
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
              <>
                <KnowledgeSignalLegend />
                <label className="hub-setting">
                  <input
                    type="checkbox"
                    checked={settings.unlockAllMaterials}
                    onChange={(event) =>
                      void toggleUnlockAll(event.target.checked)
                    }
                  />
                  <span>
                    <span className="hub-setting-title">
                      Unlock all study materials
                    </span>
                    <span className="muted hub-setting-note">
                      Off keeps a guided, in-order path.
                    </span>
                  </span>
                </label>
              </>
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
      ) : view === "daily" ? (
        dailyState.status === "loaded" ? (
          <DailyMissionRunner
            trackId={certification.id}
            mission={dailyState.mission}
            onRefresh={() => void reloadDaily()}
          />
        ) : dailyState.status === "error" ? (
          <section className="track-hub-practice-view" aria-label="Daily Mission">
            <p className="muted">
              Today&apos;s Daily Mission is unavailable right now. You can still
              explore your map or practice.
            </p>
          </section>
        ) : (
          <p role="status">Loading today&apos;s mission…</p>
        )
      ) : (
        <section className="track-hub-practice-view" aria-label="Practice">
          <div className="hub-practice-head">
            <h2>Practice</h2>
            <p className="muted">
              {totalQuestions} questions across {domains.length} domains. Earn
              Bits for every correct answer.
            </p>
          </div>
          <div className="mode-grid">
            {[QUICK_QUIZ, DOMAIN_QUIZ, FULL_PRACTICE].map((presentation) =>
              modeCard(presentation),
            )}
          </div>
          {domainPicker}
        </section>
      )}

      <div className="track-hub-actions">
        {view === "map" ? practiceControls : null}
        {dailyMission ? (
          <button
            type="button"
            className="primary hub-daily-cta"
            onClick={() => {
              setView("daily");
              void reloadDaily();
            }}
          >
            <span aria-hidden="true">🧭</span>
            {dailyMission.status === "completed"
              ? "Review today's Daily Mission"
              : "Continue Daily Mission"}
            <span className="hub-daily-progress muted">
              {dailyMission.completed_items} / {dailyMission.total_items}
            </span>
          </button>
        ) : null}
      </div>

      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
