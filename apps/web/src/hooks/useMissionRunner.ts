import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type {
  AnswerPayload,
  FeedbackResponse,
  MissionResponse,
  QuestionView,
} from "../api/types";
import { newId } from "../lib/id";
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
  question: QuestionView | null;
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
 * Answers are scored by the API, then stored locally as pending events and
 * reconciled in a single batch when the mission finishes.
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

      const accepted = result.data.results
        .filter((entry) => entry.accepted)
        .map((entry) => entry.event_id);
      markEventsSynced(accepted);
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
  }, []);

  useEffect(() => {
    if (phase !== "summary" || !progress?.finished || completed.current) {
      return;
    }
    completed.current = true;

    void api.POST("/v1/missions/{mission_id}/complete", {
      params: { path: { mission_id: progress.mission.id } },
      body: { device_id: getDeviceId() },
    });
    void sync();
  }, [phase, progress, sync]);

  const submit = useCallback(
    async (answer: AnswerPayload) => {
      if (!progress || !question) {
        return;
      }

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
        const result = await api.POST(
          "/v1/missions/{mission_id}/answers",
          {
            params: { path: { mission_id: progress.mission.id } },
            body: {
              device_id: getDeviceId(),
              event_id: eventId,
              question_id: question.id,
              content_version: progress.mission.content_version,
              attempt_number: attemptNumber,
              hint_count: 0,
              response_ms: responseMs,
              occurred_at: occurredAt,
              answer,
            },
          },
        );

        if (result.error || !result.data) {
          setError(`Scoring failed with HTTP ${result.response.status}`);
          return;
        }

        const scored = result.data;
        const record: AttemptRecord = {
          eventId,
          questionId: question.id,
          attemptNumber,
          correct: scored.correct,
          score: scored.score,
          errorCodes: scored.error_codes,
          hintCount: 0,
          responseMs,
          occurredAt,
          bits: scored.bits_preview,
        };
        previewBits(scored.bits_preview);

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

        setFeedback(scored);
        setLastAnswer(answer);
        setPhase("feedback");
        setSyncState((current) => ({
          ...current,
          pending: pendingEventCount(),
        }));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Network error");
      } finally {
        setSubmitting(false);
      }
    },
    [progress, question, timer, persist],
  );

  const retry = useCallback(() => {
    setFeedback(null);
    setLastAnswer(null);
    setError(null);
    setPhase("answering");
  }, []);

  const next = useCallback(() => {
    if (!progress) {
      return;
    }

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
