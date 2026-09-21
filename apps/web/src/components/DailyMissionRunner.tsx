import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type {
  DailyMissionItemDto,
  DailyMissionResponse,
  KnowledgeNode,
  MissionReviewResponse,
} from "../api/types";
import { formatCanonicalAnswer, labelIndex } from "../lib/canonicalAnswer";
import { prefersReducedMotion } from "../lib/motion";
import {
  completeDailyNodeItem,
  dailyActivityPresentation,
} from "../state/dailyMission";
import { recordStudyActivity } from "../state/focus";
import { publishFocusDaily } from "../state/focusDaily";
import {
  deriveLearningState,
  fullPromptReveals,
  loadDomainProgress,
  loadTrackDiscovery,
  mergeServerDiscovery,
  revealElement as revealElementInProgress,
  revealPrompt,
  type DomainLearningProgress,
} from "../state/learningProgress";
import { startDailyItem } from "../state/mission";
import { loadDailyItemReview } from "../state/missionReview";
import { playCheck } from "../state/sound";
import { flushAuxiliary, loadServerDiscovery } from "../state/syncAuxiliary";
import { useLearningDomain } from "../hooks/useLearningDomain";
import InlineText from "./InlineText";
import KnowledgeCard from "./KnowledgeCard";

interface DailyMissionRunnerProps {
  trackId: string;
  mission: DailyMissionResponse;
  onRefresh: () => void;
}

/**
 * The Daily Mission runner, embedded in the Track Hub and reused by the
 * standalone route.
 *
 * A fresh mission opens on the ordered task list so the learner can see the
 * plan and choose to start. Once started (or once progress already exists) it
 * shows only the current task plus the checklist, with a single way to advance.
 * Completed tasks can be revisited read-only so the material and questions can
 * be reviewed without redoing them.
 */
export default function DailyMissionRunner({
  trackId,
  mission,
  onRefresh,
}: DailyMissionRunnerProps) {
  const [reviewItem, setReviewItem] = useState<DailyMissionItemDto | null>(null);
  // Positions completed in this session, before the mission is refetched. This
  // lets the checklist and header reflect progress immediately without
  // auto-advancing the card the learner is reading.
  const [locallyCompleted, setLocallyCompleted] = useState<Set<number>>(new Set());
  const [displayedPosition, setDisplayedPosition] = useState<number | null>(null);
  // A mission with no progress yet opens on the plan, not on the first task.
  const [started, setStarted] = useState(false);

  const isDone = useCallback(
    (item: DailyMissionItemDto) =>
      item.status === "completed" || locallyCompleted.has(item.position),
    [locallyCompleted],
  );
  const completed = mission.items.filter(isDone).length;
  const total = mission.items.length;
  const current = mission.items.find((item) => !isDone(item)) ?? null;
  const displayed =
    displayedPosition != null
      ? mission.items.find((item) => item.position === displayedPosition) ?? current
      : current;
  const done =
    mission.status === "completed" ||
    (mission.items.length > 0 && mission.items.every(isDone));
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  // First visit of the day: show the plan and let the learner start. Resuming a
  // mission that already has progress keeps going straight to the next task.
  const showPlan = !started && !done && completed === 0 && total > 0;

  const totalMinutes = mission.items.reduce(
    (sum, item) => sum + item.estimated_minutes,
    0,
  );
  const planLabel =
    mission.plan_type === "adaptive" ? "Adaptive path" : "Standard path";
  const heading = done
    ? "Today's mission complete 🎉"
    : showPlan
      ? "Today's mission"
      : `Task ${Math.min(completed + 1, total)} of ${total}`;

  const startMission = useCallback(() => {
    recordStudyActivity("daily_mission");
    setStarted(true);
  }, []);

  const markCompleted = useCallback((position: number) => {
    // Keep the completed card visible (with its celebration and "Next task"
    // action) instead of auto-advancing, while the checklist updates.
    recordStudyActivity("daily_mission");
    setDisplayedPosition(position);
    playCheck();
    setLocallyCompleted((previous) => {
      if (previous.has(position)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(position);
      return next;
    });
  }, []);

  const advance = useCallback(() => {
    recordStudyActivity("daily_mission");
    setDisplayedPosition(null);
    void onRefresh();
  }, [onRefresh]);

  // Beginning or resuming a Daily Mission activity is meaningful study, but
  // merely previewing the plan is not.
  const displayedItemPosition = displayed?.position ?? null;
  useEffect(() => {
    if (!showPlan && displayedItemPosition != null) {
      recordStudyActivity("daily_mission");
    }
  }, [showPlan, displayedItemPosition]);

  // Keep the floating widget's Daily Mission projection in sync with the
  // learner's local progress. This is a display cache, never mission state.
  useEffect(() => {
    if (done || !current) {
      publishFocusDaily(null);
      return;
    }
    const presentation = dailyActivityPresentation(current);
    publishFocusDaily({
      trackId,
      completed,
      total,
      nextTitle: presentation.primary,
      nextMinutes: current.estimated_minutes,
    });
  }, [trackId, completed, total, current, done]);

  return (
    <section className="daily-runner">
      <header className="quest-head">
        <div className="quest-head-top">
          <p className="quest-kicker">Daily Mission</p>
          <span className="quest-reward">
            <span aria-hidden="true">💰</span>
            <strong>+{mission.reward_bits}</strong>
            <span className="quest-reward-label">Bits</span>
          </span>
        </div>
        <h1 className="quest-title">{heading}</h1>
        <p className="quest-meta">
          {planLabel} · ~{totalMinutes} min
        </p>
        <div className="quest-progress-row">
          <div
            className="daily-mission-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completed}
            aria-label="Daily Mission progress"
          >
            <div
              className="daily-mission-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="quest-progress-count">
            {completed}/{total}
          </span>
        </div>
      </header>

      {reviewItem ? (
        reviewItem.kind === "learn_node" || reviewItem.kind === "review_node" ? (
          <DailyNodeReview
            trackId={trackId}
            item={reviewItem}
            onBack={() => setReviewItem(null)}
          />
        ) : (
          <DailyPracticeReview
            missionId={mission.id}
            item={reviewItem}
            onBack={() => setReviewItem(null)}
          />
        )
      ) : showPlan ? (
        <DailyMissionPlan onStart={startMission} />
      ) : displayed ? (
        displayed.kind === "learn_node" || displayed.kind === "review_node" ? (
          <DailyNodeActivity
            key={`node-${displayed.position}`}
            trackId={trackId}
            missionId={mission.id}
            item={displayed}
            onCompleted={() => markCompleted(displayed.position)}
            onAdvanced={advance}
          />
        ) : (
          <DailyPracticeActivity
            key={`practice-${displayed.position}`}
            trackId={trackId}
            missionId={mission.id}
            item={displayed}
          />
        )
      ) : (
        <DailyMissionComplete
          mission={mission}
          trackId={trackId}
          onRefresh={onRefresh}
        />
      )}

      <ol className="quest-steps" aria-label="Daily Mission tasks">
        {mission.items.map((item) => (
          <DailyStep
            key={item.position}
            item={item}
            done={isDone(item)}
            current={!showPlan && displayed?.position === item.position}
            onReview={
              isDone(item) ? () => setReviewItem(item) : undefined
            }
          />
        ))}
      </ol>
    </section>
  );
}

/** One checklist row; completed rows can be reviewed read-only. */
function DailyStep({
  item,
  current,
  done,
  onReview,
}: {
  item: DailyMissionItemDto;
  current: boolean;
  done: boolean;
  onReview?: () => void;
}) {
  const presentation = dailyActivityPresentation(item);
  const status = done ? "Cleared" : current ? "In progress" : "Up next";
  return (
    <li
      className={`quest-step${done ? " quest-step--done" : ""}${
        current ? " quest-step--current" : ""
      }`}
      aria-current={current ? "step" : undefined}
    >
      <span className="quest-step-marker" aria-hidden="true">
        {done ? "✓" : item.position + 1}
      </span>
      <span className="quest-step-body">
        <span className="quest-step-title">
          <span className="quest-step-icon" aria-hidden="true">
            {presentation.icon}
          </span>
          <InlineText text={presentation.primary} />
        </span>
        <span className="quest-step-meta">
          {presentation.kind} · {item.domain_name} · ~{item.estimated_minutes} min
        </span>
      </span>
      <span className="sr-only">{status}</span>
      {current ? <span className="quest-step-now">Now</span> : null}
      {onReview ? (
        <button
          type="button"
          className="quest-step-review"
          onClick={onReview}
          aria-label={`Review ${presentation.primary}`}
        >
          Review
        </button>
      ) : null}
    </li>
  );
}

/**
 * Opening plan for a fresh mission. The step list below is the plan itself;
 * this row only carries the one explicit action that starts the first task.
 */
function DailyMissionPlan({ onStart }: { onStart: () => void }) {
  return (
    <section className="quest-plan" aria-label="Today's plan">
      <p className="quest-plan-note">
        Clear every step to claim the reward.
      </p>
      <button
        type="button"
        className="primary quest-plan-start"
        onClick={onStart}
      >
        Start mission
      </button>
    </section>
  );
}

/** Focused knowledge-card task with no map, HUD, or discovery progress. */
function DailyNodeActivity({
  trackId,
  missionId,
  item,
  onCompleted,
  onAdvanced,
}: {
  trackId: string;
  missionId: string;
  item: DailyMissionItemDto;
  onCompleted: () => void;
  onAdvanced: () => void;
}) {
  const { state } = useLearningDomain(trackId, item.domain_id);
  const [progress, setProgress] = useState<DomainLearningProgress | null>(null);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  const data = state.status === "loaded" ? state.data : null;

  useEffect(() => {
    if (!data) {
      return;
    }
    setProgress(loadDomainProgress(data.certification_version, data.domain.id));
  }, [data]);

  // Local-first: merge persisted discovery asynchronously. A failure is ignored
  // and the card keeps working from local progress.
  useEffect(() => {
    if (!data) {
      return;
    }
    let cancelled = false;
    void loadServerDiscovery(data.certification_id, data.certification_version).then((server) => {
      if (cancelled || !server) {
        return;
      }
      mergeServerDiscovery(
        data.certification_version,
        data.content_version,
        server,
      );
      setProgress(loadDomainProgress(data.certification_version, data.domain.id));
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const derived = useMemo(
    () => (data ? deriveLearningState(data, progress) : null),
    [data, progress],
  );

  const node: KnowledgeNode | null = useMemo(() => {
    if (!data || !item.node_id) {
      return null;
    }
    return (
      data.modules.flatMap((module) => module.nodes).find(
        (candidate) => candidate.id === item.node_id,
      ) ?? null
    );
  }, [data, item.node_id]);

  const moduleTitle = useMemo(() => {
    if (!data || !node) {
      return "";
    }
    return data.modules.find((module) =>
      module.nodes.some((candidate) => candidate.id === node.id),
    )?.title ?? "";
  }, [data, node]);

  const unlocked = Boolean(node && derived?.unlockedNodeIds.has(node.id));

  // Completing the node completes the Daily Mission item server-side. Opening
  // the card alone never does.
  useEffect(() => {
    if (!data || !node || !unlocked || submitted.current) {
      return;
    }
    submitted.current = true;
    void completeDailyNodeItem({
      dailyMissionId: missionId,
      position: item.position,
      discovery: loadTrackDiscovery(data.certification_version),
    })
      .then((response) => {
        if (response.item_completed) {
          setCompleted(true);
          onCompleted();
          // Persist any pending discovery/telemetry now that this Daily Mission
          // transition is a natural synchronization boundary.
          void flushAuxiliary();
        } else {
          submitted.current = false;
          setError("This task is not marked complete yet. Keep exploring.");
        }
      })
      .catch(() => {
        submitted.current = false;
        setError("Could not update your Daily Mission. Try again.");
      });
  }, [data, node, unlocked, missionId, item.position, onCompleted]);

  const reveal = useCallback(
    (promptId: string) => {
      if (!data || !node || !derived) {
        return;
      }
      if (derived.nodeState[node.id] === "locked") {
        return;
      }
      recordStudyActivity("reveal");
      setProgress(
        revealPrompt(
          data.certification_version,
          data.domain.id,
          data.content_version,
          node.id,
          promptId,
        ),
      );
    },
    [data, node, derived],
  );

  const revealElement = useCallback(
    (promptId: string, elementId: string) => {
      if (!data || !node || !derived) {
        return;
      }
      if (derived.nodeState[node.id] === "locked") {
        return;
      }
      recordStudyActivity("table_reveal");
      setProgress(
        revealElementInProgress(
          data.certification_version,
          data.domain.id,
          data.content_version,
          node.id,
          promptId,
          elementId,
        ),
      );
    },
    [data, node, derived],
  );

  if (state.status === "loading") {
    return <p role="status">Loading task…</p>;
  }

  if (state.status === "error" || !data || !node || !derived) {
    return (
      <section className="quest-task">
        <h2>
          <InlineText text={item.title} />
        </h2>
        <p role="alert">This task is unavailable right now.</p>
      </section>
    );
  }

  return (
    <section className="quest-task" aria-label="Current task">
      <p className="quest-task-kicker">Current step</p>
      <KnowledgeCard
        node={node}
        moduleTitle={moduleTitle}
        state={derived.nodeState[node.id] ?? "locked"}
        revealedPromptIds={derived.revealedPromptIds[node.id] ?? []}
        revealedElementIds={derived.revealedElementIds[node.id] ?? {}}
        nextNode={null}
        reducedMotion={reducedMotion}
        onReveal={reveal}
        onRevealElement={revealElement}
        onClose={onAdvanced}
        onDiscoverNext={() => {}}
        headerAction={null}
        glossary={data.glossary}
        unlockedActions={
          completed ? (
            <button type="button" className="primary" onClick={onAdvanced}>
              Next task →
            </button>
          ) : (
            <span className="muted">Completing…</span>
          )
        }
      />
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

/** Practice/domain task: hands off to the focused mission runner. */
function DailyPracticeActivity({
  trackId,
  missionId,
  item,
}: {
  trackId: string;
  missionId: string;
  item: DailyMissionItemDto;
}) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presentation = dailyActivityPresentation(item);

  const start = async () => {
    setStarting(true);
    setError(null);
    recordStudyActivity("daily_mission");
    try {
      const mission = await startDailyItem({
        dailyMissionId: missionId,
        position: item.position,
      });
      navigate(`/missions/${mission.id}?daily=1&track=${trackId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start task.");
      setStarting(false);
    }
  };

  return (
    <section className="quest-task" aria-label="Current task">
      <p className="quest-task-kicker">Current step</p>
      <h2>
        <InlineText text={presentation.primary} />
      </h2>
      <p className="muted">
        {presentation.kind} · {item.domain_name} · ~{item.estimated_minutes} min
      </p>
      <button
        type="button"
        className="primary"
        disabled={starting}
        onClick={() => void start()}
      >
        {starting ? "Starting…" : "Start task"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

/** Read-only review of a completed learning-node task. */
function DailyNodeReview({
  trackId,
  item,
  onBack,
}: {
  trackId: string;
  item: DailyMissionItemDto;
  onBack: () => void;
}) {
  const { state } = useLearningDomain(trackId, item.domain_id);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const data = state.status === "loaded" ? state.data : null;

  const node = useMemo(() => {
    if (!data || !item.node_id) {
      return null;
    }
    return (
      data.modules.flatMap((module) => module.nodes).find(
        (candidate) => candidate.id === item.node_id,
      ) ?? null
    );
  }, [data, item.node_id]);

  const moduleTitle = useMemo(() => {
    if (!data || !node) {
      return "";
    }
    return data.modules.find((module) =>
      module.nodes.some((candidate) => candidate.id === node.id),
    )?.title ?? "";
  }, [data, node]);

  const full = useMemo(() => (node ? fullPromptReveals(node) : null), [node]);

  if (state.status === "loading") {
    return <p role="status">Loading review…</p>;
  }
  if (!data || !node || !full) {
    return (
      <section className="quest-task">
        <h2>
          <InlineText text={item.title} />
        </h2>
        <p role="alert">This review is unavailable right now.</p>
        <button type="button" onClick={onBack}>
          Back to mission
        </button>
      </section>
    );
  }

  return (
    <section className="quest-task" aria-label="Review">
      <KnowledgeCard
        node={node}
        moduleTitle={moduleTitle}
        state="unlocked"
        revealedPromptIds={full.promptIds}
        revealedElementIds={full.elementIds}
        nextNode={null}
        reducedMotion={reducedMotion}
        readOnly
        onReveal={() => {}}
        onRevealElement={() => {}}
        onClose={onBack}
        onDiscoverNext={() => {}}
        headerAction={
          <button type="button" onClick={onBack}>
            Back to mission
          </button>
        }
        glossary={data.glossary}
      />
    </section>
  );
}

/** Read-only review of a completed practice task's questions and answers. */
function DailyPracticeReview({
  missionId,
  item,
  onBack,
}: {
  missionId: string;
  item: DailyMissionItemDto;
  onBack: () => void;
}) {
  const [review, setReview] = useState<MissionReviewResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const presentation = dailyActivityPresentation(item);

  useEffect(() => {
    let cancelled = false;
    void loadDailyItemReview(missionId, item.position).then((result) => {
      if (cancelled) {
        return;
      }
      if (result) {
        setReview(result);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [missionId, item.position]);

  const attemptFor = (questionId: string) =>
    review?.attempts.find((attempt) => attempt.question_id === questionId);

  return (
    <section className="quest-task daily-review" aria-label="Review">
      <header className="daily-review-head">
        <h2>
          <InlineText text={presentation.primary} />
        </h2>
        <button type="button" onClick={onBack}>
          Back to mission
        </button>
      </header>

      {status === "loading" ? <p role="status">Loading review…</p> : null}
      {status === "error" ? (
        <p role="alert">This review is unavailable right now.</p>
      ) : null}

      {review ? (
        <ol className="daily-review-questions">
          {review.questions.map((question) => {
            const labels = labelIndex(question.interaction);
            const lines = formatCanonicalAnswer(
              question.canonical_answer,
              labels,
              question.interaction,
            );
            const attempt = attemptFor(question.id);
            return (
              <li key={question.id} className="daily-review-question">
                <p className="daily-review-prompt">
                  <InlineText text={question.prompt} />
                </p>
                <p className="muted daily-review-meta">
                  {question.assessment_mode.replace(/_/g, " ")}
                  {attempt
                    ? ` · ${
                        attempt.correct ? "correct" : "reviewed"
                      } · attempt ${attempt.attempt_number}`
                    : ""}
                </p>
                <div className="daily-review-answer">
                  <p className="daily-review-answer-title">Answer</p>
                  <ul>
                    {lines.map((line, index) => (
                      <li key={`${question.id}-${index}`}>
                        {line.label ? (
                          <span className="daily-review-answer-label">
                            <InlineText text={line.label} />
                          </span>
                        ) : null}
                        <span>
                          <InlineText text={line.value} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {question.explanation ? (
                  <p className="daily-review-explanation">
                    <InlineText text={question.explanation} />
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

/** Final state with the one-time completion bonus. */
function DailyMissionComplete({
  mission,
  trackId,
  onRefresh,
}: {
  mission: DailyMissionResponse;
  trackId: string;
  onRefresh: () => void;
}) {
  return (
    <section className="daily-page-complete" aria-label="Daily mission complete">
      <p className="daily-page-complete-title">Daily Mission complete! 🎉</p>
      <p className="muted">
        {mission.reward_granted
          ? `You earned the +${mission.reward_bits} Bits daily bonus.`
          : `Your +${mission.reward_bits} Bits bonus is being settled.`}
      </p>
      <div className="daily-page-complete-actions">
        <Link className="primary" to={`/tracks/${trackId}`}>
          Back to dashboard
        </Link>
        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </section>
  );
}
