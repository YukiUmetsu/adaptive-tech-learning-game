import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { DailyMissionItemDto, DailyMissionResponse, KnowledgeNode } from "../api/types";
import KnowledgeCard from "../components/KnowledgeCard";
import { useDailyMission } from "../hooks/useDailyMission";
import { useLearningDomain } from "../hooks/useLearningDomain";
import { prefersReducedMotion } from "../lib/motion";
import {
  completedItemCount,
  completeDailyNodeItem,
  dailyActivityPresentation,
  firstIncompleteItem,
} from "../state/dailyMission";
import {
  deriveLearningState,
  loadDomainProgress,
  loadTrackDiscovery,
  revealElement as revealElementInProgress,
  revealPrompt,
  type DomainLearningProgress,
} from "../state/learningProgress";
import { startDailyItem } from "../state/mission";

/**
 * Dedicated Daily Mission runner.
 *
 * Shows only the current task plus the ordered checklist, with a single way to
 * advance. Node tasks render their Knowledge Card in place (no Knowledge Map,
 * HUD, or discovery-progress section); practice tasks open the focused mission
 * runner. Returning here always resumes the first incomplete task.
 */
export default function DailyMissionPage() {
  const { certificationId } = useParams();
  const trackId = certificationId ?? "";
  const { state, reload } = useDailyMission({
    trackId,
    enabled: Boolean(trackId),
  });

  if (state.status === "loading" || state.status === "idle") {
    return <p role="status">Loading Daily Mission…</p>;
  }

  if (state.status === "error") {
    return (
      <section className="daily-runner">
        <h1>Daily Mission unavailable</h1>
        <p className="muted">
          You can keep studying with the regular quizzes from the dashboard.
        </p>
        <Link to={`/tracks/${trackId}`}>Back to dashboard</Link>
      </section>
    );
  }

  const mission = state.mission;
  const completed = completedItemCount(mission.items);
  const total = mission.items.length;
  const current = firstIncompleteItem(mission.items);
  const done = mission.status === "completed";
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

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

      {current ? (
        current.kind === "learn_node" || current.kind === "review_node" ? (
          <DailyNodeActivity
            key={`node-${current.position}`}
            trackId={trackId}
            missionId={mission.id}
            item={current}
            onAdvanced={() => void reload()}
          />
        ) : (
          <DailyPracticeActivity
            key={`practice-${current.position}`}
            trackId={trackId}
            missionId={mission.id}
            item={current}
          />
        )
      ) : (
        <DailyMissionComplete
          mission={mission}
          trackId={trackId}
          onRefresh={() => void reload()}
        />
      )}

      <ol className="daily-runner-steps" aria-label="Daily Mission tasks">
        {mission.items.map((item) => (
          <DailyStep
            key={item.position}
            item={item}
            current={current?.position === item.position}
          />
        ))}
      </ol>
    </section>
  );
}

/** One read-only checklist row; only the current task is emphasised. */
function DailyStep({
  item,
  current,
}: {
  item: DailyMissionItemDto;
  current: boolean;
}) {
  const presentation = dailyActivityPresentation(item);
  const done = item.status === "completed";
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
    </li>
  );
}

/** Focused knowledge-card task with no map, HUD, or discovery progress. */
function DailyNodeActivity({
  trackId,
  missionId,
  item,
  onAdvanced,
}: {
  trackId: string;
  missionId: string;
  item: DailyMissionItemDto;
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
        } else {
          submitted.current = false;
          setError("This task is not marked complete yet. Keep exploring.");
        }
      })
      .catch(() => {
        submitted.current = false;
        setError("Could not update your Daily Mission. Try again.");
      });
  }, [data, node, unlocked, missionId, item.position]);

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
