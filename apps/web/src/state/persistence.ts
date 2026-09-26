import type { AnswerPayload, MissionResponse } from "../api/types";
import { newId } from "../lib/id";

const DEVICE_KEY = "adaptive-learn.device-id";
const MISSION_KEY = "adaptive-learn.active-mission";
const PENDING_KEY = "adaptive-learn.pending-events";
const BITS_KEY = "adaptive-learn.bits-cache";
const PENDING_SPENDS_KEY = "adaptive-learn.pending-bit-spends";

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
  /** Bits previewed for this attempt (settled later during sync). */
  bits?: number;
}

/** Locally persisted mission progress. */
export interface MissionProgress {
  mission: MissionResponse;
  /** Question index for ordinary missions. */
  currentIndex: number;
  /**
   * Stage index for a challenge mission.
   *
   * Present only when `mission.challenge` is set. Node and question stages share
   * one ordered index so a challenge resumes exactly where the learner left it.
   */
  stageIndex?: number;
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

/**
 * Removes every queued event that belongs to one of the given missions.
 *
 * Used when the server permanently rejects an event because the mission was
 * issued from content that has since changed. Such events can never be
 * accepted, so keeping them would retry forever.
 */
export function discardPendingEventsForMissions(
  missionIds: Iterable<string>,
): PendingEvent[] {
  const discard = new Set(missionIds);
  const remaining = loadPendingEvents().filter(
    (event) => !discard.has(event.missionInstanceId),
  );
  writeJson(PENDING_KEY, remaining);
  return remaining;
}

/** Clears the persisted active mission. */
export function clearMission(): void {
  try {
    window.localStorage.removeItem(MISSION_KEY);
  } catch {
    // Storage unavailable; there is nothing to clear.
  }
}

/**
 * Cached settled Bits balance, for instant display before the wallet loads.
 *
 * The server is authoritative; this is only a display cache that is reconciled
 * on every wallet fetch and sync.
 */
export function loadCachedBits(): number {
  const value = readJson<number>(BITS_KEY);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function saveCachedBits(bits: number): boolean {
  return writeJson(BITS_KEY, bits);
}

/**
 * One Bits spend that has been applied locally but not yet settled by the
 * server.
 *
 * The `eventId` is the server-side idempotency key, so a queued spend can be
 * retried after a reload or a dropped response without debiting twice.
 */
export interface PendingBitSpend {
  eventId: string;
  runId: string;
  defenseId: string;
  fromLevel: number;
  amount: number;
}

/** Pending Bits spends, oldest first. */
export function loadPendingBitSpends(): PendingBitSpend[] {
  const value = readJson<PendingBitSpend[]>(PENDING_SPENDS_KEY);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (spend): spend is PendingBitSpend =>
      !!spend &&
      typeof spend.eventId === "string" &&
      typeof spend.runId === "string" &&
      typeof spend.defenseId === "string" &&
      typeof spend.fromLevel === "number" &&
      typeof spend.amount === "number" &&
      spend.amount > 0,
  );
}

export function savePendingBitSpends(spends: PendingBitSpend[]): boolean {
  return writeJson(PENDING_SPENDS_KEY, spends);
}
