import type { AnswerPayload, MissionResponse } from "../api/types";
import { newId } from "../lib/id";

const DEVICE_KEY = "adaptive-learn.device-id";
const MISSION_KEY = "adaptive-learn.active-mission";
const PENDING_KEY = "adaptive-learn.pending-events";

/** One scored attempt, mirrored locally for the mission summary. */
export interface AttemptRecord {
  eventId: string;
  questionId: string;
  attemptNumber: number;
  correct: boolean;
  score: number;
  errorCodes: string[];
  hintCount: number;
  responseMs: number;
  occurredAt: string;
}

/** Locally persisted mission progress. */
export interface MissionProgress {
  mission: MissionResponse;
  currentIndex: number;
  attempts: AttemptRecord[];
  startedAt: string;
  finished: boolean;
}

/**
 * An evaluated attempt waiting to be reconciled with the server.
 *
 * Synced events are removed from this queue, so everything stored here is
 * pending.
 */
export interface PendingEvent {
  eventId: string;
  missionInstanceId: string;
  questionId: string;
  contentVersion: string;
  attemptNumber: number;
  hintCount: number;
  responseMs: number;
  occurredAt: string;
  answer: AnswerPayload;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Storage can be unavailable (private mode, quota). Callers surface this so
    // evidence is not silently lost.
    return false;
  }
}

/** Returns a stable device id, creating one on first use. */
export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) {
      return existing;
    }
    const created = newId();
    window.localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return newId();
  }
}

export function loadMission(): MissionProgress | null {
  return readJson<MissionProgress>(MISSION_KEY);
}

export function saveMission(progress: MissionProgress): boolean {
  return writeJson(MISSION_KEY, progress);
}

export function loadPendingEvents(): PendingEvent[] {
  return readJson<PendingEvent[]>(PENDING_KEY) ?? [];
}

/** Appends a pending event, returning whether it was durably stored. */
export function appendPendingEvent(event: PendingEvent): boolean {
  const events = [...loadPendingEvents(), event];
  return writeJson(PENDING_KEY, events);
}

/** Removes reconciled events from the pending queue. */
export function markEventsSynced(eventIds: string[]): PendingEvent[] {
  const accepted = new Set(eventIds);
  const remaining = loadPendingEvents().filter(
    (event) => !accepted.has(event.eventId),
  );
  writeJson(PENDING_KEY, remaining);
  return remaining;
}

export function pendingEventCount(): number {
  return loadPendingEvents().length;
}
