import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type {
  AnswerPayload,
  FeedbackResponse,
  MissionResponse,
  StudyQuestionView,
  SyncEventResult,
} from "../api/types";
import { newId } from "../lib/id";
import { scoreQuestion, ScoringError } from "../scoring";
import { rewardBits } from "../scoring/reward";
import { recordStudyActivity } from "../state/focus";
import {
  loadPendingAuxiliary,
  loadPendingDiscovery,
  markAuxiliarySynced,
  markDiscoverySent,
} from "../state/auxiliaryQueue";
import {
  appendPendingEvent,
  getDeviceId,
  loadMission,
  loadPendingEvents,
  markEventsSynced,
  pendingEventCount,
  saveMission,
  type AttemptRecord,
  type MissionProgress,
} from "../state/persistence";
import { previewBits, reconcileBits } from "../state/wallet";
import { useQuestionTimer } from "./useQuestionTimer";

export type RunnerPhase =
  | "loading"
  | "missing"
  | "answering"
  | "feedback"
  | "summary";

export interface SyncState {
  status: "idle" | "syncing" | "synced" | "pending" | "error";
  pending: number;
  message?: string;
}

export interface MissionRunner {
  phase: RunnerPhase;
  mission: MissionResponse | null;
  question: StudyQuestionView | null;
  currentIndex: number;
  total: number;
  attempts: AttemptRecord[];
  feedback: FeedbackResponse | null;
  lastAnswer: AnswerPayload | null;
  submitting: boolean;
  error: string | null;
  syncState: SyncState;
  submit: (answer: AnswerPayload) => Promise<void>;
  retry: () => void;
  next: () => void;
  sync: () => Promise<void>;
}

/**
 * Runs one mission against persisted local state.
 *
 * Ordinary study missions are scored locally against the canonical answer that
 * ships with the issued mission, so answering a question performs zero network
 * requests. Raw answer primitives are queued in the pending-event outbox and
 * reconciled at a natural boundary (mission completion, manual retry, or
 * reconnect) with a single `/v1/sync` call.
 *
 * Local scoring is never authoritative: the server re-scores every raw answer
 * and its result wins on reconciliation.
 */
export function useMissionRunner(missionId: string): MissionRunner {
  const [progress, setProgress] = useState<MissionProgress | null>(null);
  const [phase, setPhase] = useState<RunnerPhase>("loading");
  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
  const [lastAnswer, setLastAnswer] = useState<AnswerPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(() => ({
    status: "idle",
    pending: pendingEventCount(),
  }));
  const completed = useRef(false);

  const question = progress?.mission.questions[progress.currentIndex] ?? null;
  const timer = useQuestionTimer(question?.id ?? "none", phase === "answering");

  // Beginning meaningful question interaction is a semantic boundary that
  // resumes Focus. Low-level input components never touch the timer.
  useEffect(() => {
    if (phase === "answering" && question) {
      recordStudyActivity("question");
    }
  }, [phase, question]);

  useEffect(() => {
    const stored = loadMission();
    if (!stored || stored.mission.id !== missionId) {
      setPhase("missing");
      return;
    }
    setProgress(stored);
    setPhase(stored.finished ? "summary" : "answering");
  }, [missionId]);

  const persist = useCallback((next: MissionProgress) => {
    setProgress(next);
    saveMission(next);
  }, []);

  /**
   * Reconciles local optimistic attempt results with the authoritative server
   * scoring returned by sync. The server always wins.
   */
  const reconcileAttempts = useCallback((results: SyncEventResult[]) => {
    if (results.length === 0) {
      return;
    }
    const byEvent = new Map(results.map((entry) => [entry.event_id, entry]));
    const stored = loadMission();
    if (!stored) {
      return;
    }

    let changed = false;
    const nextAttempts = stored.attempts.map((attempt) => {
      const result = byEvent.get(attempt.eventId);
      if (!result || !result.accepted) {
        return attempt;
      }

      const correctChanged = result.correct !== attempt.correct;
      const scoreChanged = Math.abs(result.score - attempt.score) > 1e-9;
      if (correctChanged || scoreChanged) {
        warnScorerMismatch(attempt, result);
      }

      // Settled Bits are authoritative. A duplicate retry reports 0 without
      // contradicting an already-settled attempt, so only a genuinely
      // non-correct server score clears the optimistic preview.
      const settledBits =
        result.score < 1
          ? 0
          : result.bits_settled > 0
            ? result.bits_settled
            : attempt.bits;

      if (
        !correctChanged &&
        !scoreChanged &&
        settledBits === attempt.bits
      ) {
        return attempt;
      }

      changed = true;
      return {
        ...attempt,
        correct: result.correct,
        score: result.score,
        errorCodes: result.error_codes,
        bits: settledBits,
      };
    });

    if (changed) {
      const next = { ...stored, attempts: nextAttempts };
      persist(next);
    }

    setFeedback((current) => {
      if (!current) {
        return current;
      }
      const result = byEvent.get(current.event_id);
      if (!result || !result.accepted) {
        return current;
      }
      return {
        ...current,
        correct: result.correct,
        score: result.score,
        error_codes: result.error_codes,
        bits_preview:
          result.score < 1
            ? 0
            : result.bits_settled > 0
              ? result.bits_settled
              : current.bits_preview,
      };
    });
  }, [persist]);

  const sync = useCallback(async () => {
    const pending = loadPendingEvents();
    const discovery = loadPendingDiscovery();
    const auxiliary = loadPendingAuxiliary();
    if (pending.length === 0 && discovery.length === 0 && auxiliary.length === 0) {
      setSyncState({ status: "synced", pending: 0 });
      return;
    }

    setSyncState({ status: "syncing", pending: pending.length });
    try {
      const result = await api.POST("/v1/sync", {
        body: {
          device_id: getDeviceId(),
          events: pending.map((event) => ({
            event_id: event.eventId,
            mission_instance_id: event.missionInstanceId,
            question_id: event.questionId,
            content_version: event.contentVersion,
            attempt_number: event.attemptNumber,
            hint_count: event.hintCount,
            response_ms: event.responseMs,
            occurred_at: event.occurredAt,
            answer: event.answer,
          })),
          // Auxiliary work rides along on the same request but is logically
          // isolated server-side. Only accepted sections are cleared below.
          discovery_updates: discovery.map((entry) => ({
            track_version: entry.trackVersion,
            content_version: entry.contentVersion,
            domains: entry.domains,
          })),
          auxiliary_events: auxiliary.map((entry) => ({
            event_id: entry.eventId,
            track_id: entry.trackId,
            recommendation_id: entry.recommendationId,
            event: entry.event,
            action: entry.action,
            domain_id: entry.domainId,
            node_id: entry.nodeId,
            question_id: entry.questionId,
          })),
        },
      });

      if (result.error || !result.data) {
        setSyncState({
          status: "error",
          pending: pending.length,
          message: `Sync failed with HTTP ${result.response.status}`,
        });
        return;
      }

      const acceptedResults = result.data.results.filter(
        (entry) => entry.accepted,
      );
      reconcileAttempts(acceptedResults);
      markEventsSynced(acceptedResults.map((entry) => entry.event_id));
      if (result.data.discovery?.accepted) {
        markDiscoverySent(discovery);
      }
      if (result.data.auxiliary?.accepted) {
        markAuxiliarySynced(auxiliary.map((entry) => entry.id));
      }
      reconcileBits(result.data.bits_balance);
      const remaining = pendingEventCount();
      setSyncState({
        status: remaining === 0 ? "synced" : "pending",
        pending: remaining,
      });
    } catch (caught) {
      setSyncState({
        status: "error",
        pending: pending.length,
        message: caught instanceof Error ? caught.message : "Network error",
      });
    }
  }, [reconcileAttempts]);

  useEffect(() => {
    if (phase !== "summary" || !progress?.finished || completed.current) {
      return;
    }
    completed.current = true;

    // Completion is derived server-side during sync from accepted evidence, so
    // no separate completion request is needed.
    void sync();
    // Notify the app that authoritative study state may have changed so the
    // Track Hub can refresh the streak and Daily Mission at this boundary.
    window.dispatchEvent(new Event("adaptive-learn:study-updated"));
  }, [phase, progress, sync]);

  // Returning online is a natural sync boundary. There is deliberately no
  // timer and no per-answer background synchronization.
  useEffect(() => {
    const handleOnline = () => {
      void sync();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [sync]);

  const submit = useCallback(
    async (answer: AnswerPayload) => {
      if (!progress || !question) {
        return;
      }

      recordStudyActivity("answer_submit");
      setSubmitting(true);
      setError(null);

      const attemptNumber =
        progress.attempts.filter(
          (attempt) => attempt.questionId === question.id,
        ).length + 1;
      const eventId = newId();
      const occurredAt = new Date().toISOString();
      const responseMs = timer.elapsedMs();

      try {
        if (!question.canonical_answer) {
          setError(
            "This mission cannot be scored locally. Please start it again.",
          );
          return;
        }

        // Zero network requests: score against the canonical answer that
        // shipped with the mission.
        const scored = scoreQuestion(question, answer);
        const bitsPreview = rewardBits(
          attemptNumber,
          scored.score,
          question.difficulty_prior,
        );

        const record: AttemptRecord = {
          eventId,
          questionId: question.id,
          attemptNumber,
          correct: scored.correct,
          score: scored.score,
          errorCodes: scored.errorCodes,
          hintCount: 0,
          responseMs,
          occurredAt,
          bits: bitsPreview,
        };
        previewBits(bitsPreview);

        // Persist local progress before queuing the raw event so a crash cannot
        // silently lose the attempt.
        persist({
          ...progress,
          attempts: [...progress.attempts, record],
        });
        const persisted = appendPendingEvent({
          eventId,
          missionInstanceId: progress.mission.id,
          questionId: question.id,
          contentVersion: progress.mission.content_version,
          attemptNumber,
          hintCount: 0,
          responseMs,
          occurredAt,
          answer,
        });
        if (!persisted) {
          setError(
            "This attempt could not be saved locally and may be lost if the page closes.",
          );
        }

        setFeedback({
          event_id: eventId,
          question_id: question.id,
          correct: scored.correct,
          score: scored.score,
          error_codes: scored.errorCodes,
          bits_preview: bitsPreview,
          explanation: question.explanation,
          canonical_answer: question.canonical_answer,
          concepts: question.concepts,
        });
        setLastAnswer(answer);
        setPhase("feedback");
        setSyncState((current) => ({
          ...current,
          pending: pendingEventCount(),
        }));
      } catch (caught) {
        if (caught instanceof ScoringError) {
          setError("This answer could not be scored. Please try again.");
        } else {
          setError(caught instanceof Error ? caught.message : "Scoring error");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [progress, question, timer, persist],
  );

  const retry = useCallback(() => {
    recordStudyActivity("question");
    setFeedback(null);
    setLastAnswer(null);
    setError(null);
    setPhase("answering");
  }, []);

  const next = useCallback(() => {
    if (!progress) {
      return;
    }

    recordStudyActivity("mission_next");
    if (progress.currentIndex < progress.mission.questions.length - 1) {
      persist({ ...progress, currentIndex: progress.currentIndex + 1 });
      setFeedback(null);
      setLastAnswer(null);
      setError(null);
      setPhase("answering");
      return;
    }

    persist({ ...progress, finished: true });
    setPhase("summary");
  }, [progress, persist]);

  return {
    phase,
    mission: progress?.mission ?? null,
    question,
    currentIndex: progress?.currentIndex ?? 0,
    total: progress?.mission.questions.length ?? 0,
    attempts: progress?.attempts ?? [],
    feedback,
    lastAnswer,
    submitting,
    error,
    syncState,
    submit,
    retry,
    next,
    sync,
  };
}

/**
 * Surfaces scorer drift in development/test builds only.
 *
 * A mismatch is not an error path: the server result already won and the local
 * cache was reconciled. The diagnostic exists so parity bugs are visible during
 * development instead of silently changing what learners see.
 */
function warnScorerMismatch(
  attempt: AttemptRecord,
  result: SyncEventResult,
): void {
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    console.warn("[scorer-parity] local and server scoring differ", {
      eventId: attempt.eventId,
      questionId: attempt.questionId,
      local: { correct: attempt.correct, score: attempt.score },
      server: { correct: result.correct, score: result.score },
    });
  }
}
