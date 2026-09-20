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
 * Shows only the current task plus the ordered checklist, with a single way to
 * advance. Completed tasks can be revisited read-only so the material and
 * questions can be reviewed without redoing them.
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

  const markCompleted = useCallback((position: number) => {
    // Keep the completed card visible (with its celebration and "Next task"
    // action) instead of auto-advancing, while the checklist updates.
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
    setDisplayedPosition(null);
    void onRefresh();
  }, [onRefresh]);

  return (
    <section className="daily-runner">
      <header className="daily-runner-head">
        <div>
          <p className="daily-mission-kicker">Daily Mission</p>
          <h1>
            {done
              ? "Today's mission complete 🎉"
              : `Task ${Math.min(completed + 1, total)} of ${total}`}
          </h1>
        </div>
        <p className="muted daily-mission-progress-label">
          {completed} / {total} complete
        </p>
      </header>

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

      <ol className="daily-runner-steps" aria-label="Daily Mission tasks">
        {mission.items.map((item) => (
          <DailyStep
            key={item.position}
            item={item}
            done={isDone(item)}
            current={displayed?.position === item.position}
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
  return (
    <li
      className={`daily-runner-step${done ? " daily-runner-step-done" : ""}${
        current ? " daily-runner-step-current" : ""
      }`}
    >
      <span className="daily-mission-check" aria-hidden="true">
        {done ? "✓" : current ? "●" : "○"}
      </span>
      <span className="daily-mission-icon" aria-hidden="true">
        {presentation.icon}
      </span>
      <span className="daily-mission-item-body">
        <span className="daily-mission-item-title">{presentation.primary}</span>
        <span className="muted daily-mission-item-meta">
          {presentation.kind} · {item.domain_name}
        </span>
      </span>
      {onReview ? (
        <button
          type="button"
          className="daily-step-review"
          onClick={onReview}
          aria-label={`Review ${presentation.primary}`}
        >
          Review
        </button>
      ) : null}
    </li>
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
      <section className="daily-runner-activity">
        <h2>{item.title}</h2>
        <p role="alert">This task is unavailable right now.</p>
      </section>
    );
  }

  return (
    <section className="daily-runner-activity" aria-label="Current task">
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
    <section className="daily-runner-activity" aria-label="Current task">
      <h2>{presentation.primary}</h2>
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
      <section className="daily-runner-activity">
        <h2>{item.title}</h2>
        <p role="alert">This review is unavailable right now.</p>
        <button type="button" onClick={onBack}>
          Back to mission
        </button>
      </section>
    );
  }

  return (
    <section className="daily-runner-activity" aria-label="Review">
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
    <section className="daily-runner-activity daily-review" aria-label="Review">
      <header className="daily-review-head">
        <h2>{presentation.primary}</h2>
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
            const lines = formatCanonicalAnswer(question.canonical_answer, labels);
            const attempt = attemptFor(question.id);
            return (
              <li key={question.id} className="daily-review-question">
                <p className="daily-review-prompt">{question.prompt}</p>
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
                            {line.label}
                          </span>
                        ) : null}
                        <span>{line.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {question.explanation ? (
                  <p className="daily-review-explanation">
                    {question.explanation}
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
