import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { MissionResponse, QuizMode } from "../api/types";
import { useCatalog } from "../hooks/useCatalog";
import type { SyncState } from "../hooks/useMissionRunner";
import { claimMissionCelebration } from "../state/celebration";
import { buildKnowledgeGroups } from "../state/knowledge";
import { startMission } from "../state/mission";
import type { AttemptRecord } from "../state/persistence";
import { quizCompletionPresentation } from "../state/quizModes";
import { playMissionComplete } from "../state/sound";
import { completionMessage, computeSummary } from "../state/summary";
import { useBitsBalance } from "../state/wallet";
import BitsRewardSummary from "./BitsRewardSummary";
import CompletionActions, { type CompletionAction } from "./CompletionActions";
import DomainBreakdown, { type BreakdownRow } from "./DomainBreakdown";
import KnowledgeReinforcement from "./KnowledgeReinforcement";
import MissionCompleteHero from "./MissionCompleteHero";
import PerformanceSummary from "./PerformanceSummary";

interface QuizCompletionSummaryProps {
  mission: MissionResponse;
  attempts: AttemptRecord[];
  syncState: SyncState;
  /** When set, offers a "Continue Daily Mission" action back to the runner. */
  dailyReturnTo?: string;
  onRetrySync: () => void;
}

/**
 * Claims the celebration (sound + animated Bits) exactly once per mission.
 *
 * Uses the module-level guard so a remount after navigation cannot replay it,
 * and a ref so StrictMode's double-invoked effects cannot either.
 */
function useMissionCelebration(missionId: string): boolean {
  // Tracks the mission whose effect has already run, so StrictMode's double
  // invocation is ignored but a genuinely new mission still celebrates.
  const claimedFor = useRef<string | null>(null);
  const [celebrated, setCelebrated] = useState(false);

  useLayoutEffect(() => {
    if (claimedFor.current === missionId) {
      return;
    }
    claimedFor.current = missionId;

    if (claimMissionCelebration(missionId)) {
      setCelebrated(true);
      playMissionComplete();
    } else {
      setCelebrated(false);
    }
  }, [missionId]);

  return celebrated;
}

/** Friendly fallback when the catalog has not provided a name. */
function humanizeId(id: string): string {
  return id
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

interface SyncStatusProps {
  syncState: SyncState;
  pending: number;
  onRetrySync: () => void;
}

/** Quiet sync line, promoted only when reconciliation fails. */
function SyncStatus({ syncState, pending, onRetrySync }: SyncStatusProps) {
  if (syncState.status === "error") {
    return (
      <div className="completion-sync sync-error" role="alert">
        <p data-testid="summary-pending">
          {pending > 0
            ? `${pending} learning event${pending === 1 ? "" : "s"} waiting to sync. `
            : ""}
          {syncState.message ?? "Your progress could not be saved yet."}
        </p>
        <button type="button" onClick={onRetrySync}>
          Retry Sync
        </button>
      </div>
    );
  }

  if (pending > 0) {
    return (
      <div className="completion-sync" role="status">
        <p data-testid="summary-pending">
          {pending} learning event{pending === 1 ? "" : "s"} waiting to sync.
        </p>
        <button
          type="button"
          disabled={syncState.status === "syncing"}
          onClick={onRetrySync}
        >
          {syncState.status === "syncing" ? "Syncing…" : "Retry Sync"}
        </button>
      </div>
    );
  }

  if (syncState.status === "syncing") {
    return (
      <p className="completion-sync quiet" role="status">
        Saving progress…
      </p>
    );
  }

  return (
    <p className="completion-sync quiet" role="status">
      <span aria-hidden="true">✓</span> Progress saved
    </p>
  );
}

/**
 * Shared end-of-quiz completion experience.
 *
 * One framework renders quick, domain, and full practice summaries; only the
 * title, subtitle, breakdown, and actions vary by mode.
 */
export default function QuizCompletionSummary({
  mission,
  attempts,
  syncState,
  dailyReturnTo,
  onRetrySync,
}: QuizCompletionSummaryProps) {
  const summary = useMemo(
    () => computeSummary(mission, attempts, syncState.pending),
    [mission, attempts, syncState.pending],
  );
  const { state } = useCatalog();
  const bits = useBitsBalance();
  const navigate = useNavigate();
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const celebrated = useMissionCelebration(mission.id);

  const lookups = useMemo(() => {
    const conceptNames = new Map<string, string>();
    const domainNames = new Map<string, string>();
    const taskNames = new Map<string, string>();

    if (state.status === "loaded") {
      const certification = state.data.certifications.find(
        (entry) => entry.id === mission.certification_id,
      );
      const version =
        certification?.versions.find(
          (entry) => entry.id === mission.certification_version,
        ) ?? certification?.versions[0];

      if (version) {
        for (const concept of version.concepts ?? []) {
          conceptNames.set(concept.id, concept.name);
        }
        for (const domain of version.domains) {
          domainNames.set(domain.id, domain.name);
          for (const task of domain.tasks) {
            taskNames.set(task.id, task.name);
          }
        }
      }
    }

    return { conceptNames, domainNames, taskNames };
  }, [state, mission.certification_id, mission.certification_version]);

  const knowledgeGroups = useMemo(
    () => buildKnowledgeGroups(summary.conceptsPracticed, lookups.conceptNames),
    [summary.conceptsPracticed, lookups.conceptNames],
  );

  const domainLabel = useCallback(
    (domainId: string) => lookups.domainNames.get(domainId) ?? humanizeId(domainId),
    [lookups.domainNames],
  );
  const taskLabel = useCallback(
    (taskId: string) => lookups.taskNames.get(taskId) ?? `Task ${taskId}`,
    [lookups.taskNames],
  );

  const domainRows: BreakdownRow[] = summary.domains.map((domain) => ({
    id: domain.domainId,
    label: domainLabel(domain.domainId),
    firstAttemptCorrect: domain.firstAttemptCorrect,
    totalQuestions: domain.totalQuestions,
  }));
  const taskRows: BreakdownRow[] = summary.tasks.map((task) => ({
    id: task.taskId,
    label: taskLabel(task.taskId),
    firstAttemptCorrect: task.firstAttemptCorrect,
    totalQuestions: task.totalQuestions,
  }));

  const startAnother = useCallback(
    async (key: string, mode: QuizMode, domainId?: string) => {
      setStarting(key);
      setError(null);
      try {
        const next = await startMission({
          certificationId: mission.certification_id,
          certificationVersion: mission.certification_version,
          mode,
          domainId,
        });
        navigate(`/missions/${next.id}`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Network error");
      } finally {
        setStarting(null);
      }
    },
    [mission.certification_id, mission.certification_version, navigate],
  );

  const presentation = quizCompletionPresentation(mission.mode);
  const message = completionMessage(summary);
  const dashboardPath = `/tracks/${mission.certification_id}`;
  const busy = starting !== null;

  let actions: CompletionAction[];
  if (mission.mode === "quick_adaptive") {
    actions = [
      {
        key: "again",
        label: "⚡ Play Another Quick Quiz",
        variant: "primary",
        disabled: busy,
        onClick: () => void startAnother("again", "quick_adaptive"),
      },
      {
        key: "dashboard",
        label: "Return to Study Dashboard",
        variant: "secondary",
        to: dashboardPath,
      },
    ];
  } else if (mission.mode === "domain_quiz") {
    actions = [
      {
        key: "again",
        label: "🎯 Practice This Domain Again",
        variant: "primary",
        disabled: busy || !mission.domain_id,
        onClick: () =>
          void startAnother("again", "domain_quiz", mission.domain_id ?? undefined),
      },
      {
        key: "dashboard",
        label: "Return to Study Dashboard",
        variant: "secondary",
        to: dashboardPath,
      },
      {
        key: "choose",
        label: "Choose Another Domain",
        variant: "quiet",
        to: dashboardPath,
      },
    ];
  } else if (mission.mode === "full_practice") {
    actions = [
      {
        key: "dashboard",
        label: "Return to Study Dashboard",
        variant: "primary",
        to: dashboardPath,
      },
      {
        key: "again",
        label: "Start Another Full Practice",
        variant: "secondary",
        disabled: busy,
        onClick: () => void startAnother("again", "full_practice"),
      },
    ];
  } else {
    actions = [
      {
        key: "dashboard",
        label: "Return to Study Dashboard",
        variant: "primary",
        to: dashboardPath,
      },
    ];
  }

  if (dailyReturnTo) {
    // Daily Mission tasks are a single flow: the only action is to continue.
    actions = [
      {
        key: "daily",
        label: "Continue Daily Mission →",
        variant: "primary",
        to: dailyReturnTo,
      },
    ];
  }

  return (
    <section
      className={`completion completion-${presentation.key}`}
      aria-labelledby="completion-heading"
    >
      <MissionCompleteHero
        presentation={presentation}
        subtitle={
          mission.mode === "domain_quiz" && mission.domain_id
            ? domainLabel(mission.domain_id)
            : undefined
        }
        message={message}
      />

      <BitsRewardSummary earned={summary.bitsEarned} total={bits} animate={celebrated} />

      <PerformanceSummary summary={summary} />

      {mission.mode === "domain_quiz" && taskRows.length > 0 ? (
        <DomainBreakdown heading="Domain coverage" rows={taskRows} showCheck />
      ) : null}

      {mission.mode === "full_practice" && domainRows.length > 0 ? (
        <DomainBreakdown heading="Domain breakdown" rows={domainRows} />
      ) : null}

      <KnowledgeReinforcement groups={knowledgeGroups} />

      {mission.mode === "quick_adaptive" ? (
        <p className="completion-momentum">Nice momentum.</p>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}

      <CompletionActions actions={actions} />

      <SyncStatus
        syncState={syncState}
        pending={summary.pendingEvents}
        onRetrySync={onRetrySync}
      />
    </section>
  );
}
