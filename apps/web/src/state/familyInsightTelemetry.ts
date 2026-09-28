import { newId } from "../lib/id";

/**
 * Local, bounded telemetry for Phase 5 family insights.
 *
 * These events are strictly non-authoritative: they never affect concept state,
 * mastery, scheduling, rewards, or scoring, and they are never sent per click.
 * They are queued in `localStorage` so a future sync boundary can deliver them
 * in one batch. Until that delivery is wired, this is a local audit trail only.
 *
 * The payload intentionally contains only identifiers and coarse labels: never
 * a learner profile, an inferred trait, or an answer.
 */

export type FamilyInsightEventKind =
  | "family_insight_shown"
  | "family_insight_opened"
  | "structure_comparison_completed"
  | "confusion_comparison_opened";

export interface PendingFamilyInsightEvent {
  /** Stable dedup key. */
  id: string;
  /** Stable id for idempotent delivery later. */
  eventId: string;
  /** Event kind. */
  event: FamilyInsightEventKind;
  /** Learning track identifier. */
  trackId: string;
  /** Authored family identifier, when relevant. */
  familyId: string | null;
  /** When the event was recorded, ISO-8601. */
  occurredAt: string;
}

export const PENDING_FAMILY_INSIGHT_KEY =
  "adaptive-learn.pending-family-insight.v1";

/** Upper bound on queued events; the oldest are dropped on overflow. */
export const MAX_PENDING_FAMILY_INSIGHT_EVENTS = 200;

function read(): PendingFamilyInsightEvent[] {
  try {
    const raw = window.localStorage.getItem(PENDING_FAMILY_INSIGHT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as PendingFamilyInsightEvent[]) : [];
  } catch {
    return [];
  }
}

function write(events: PendingFamilyInsightEvent[]): boolean {
  try {
    window.localStorage.setItem(
      PENDING_FAMILY_INSIGHT_KEY,
      JSON.stringify(events),
    );
    return true;
  } catch {
    return false;
  }
}

/** Records one event locally, deduplicating by kind/track/family while pending. */
export function recordFamilyInsightEvent(event: {
  event: FamilyInsightEventKind;
  trackId: string;
  familyId?: string | null;
}): boolean {
  const familyId = event.familyId ?? null;
  const id = `${event.event}:${event.trackId}:${familyId ?? ""}`;
  const pending = read();
  if (pending.some((entry) => entry.id === id)) {
    return true;
  }
  pending.push({
    id,
    eventId: newId(),
    event: event.event,
    trackId: event.trackId,
    familyId,
    occurredAt: new Date().toISOString(),
  });
  const bounded =
    pending.length > MAX_PENDING_FAMILY_INSIGHT_EVENTS
      ? pending.slice(pending.length - MAX_PENDING_FAMILY_INSIGHT_EVENTS)
      : pending;
  return write(bounded);
}

/** Returns the queued events without clearing them. */
export function loadFamilyInsightEvents(): PendingFamilyInsightEvent[] {
  return read();
}

/** Removes the delivered event ids from the queue. */
export function markFamilyInsightEventsSynced(ids: string[]): void {
  const synced = new Set(ids);
  write(read().filter((entry) => !synced.has(entry.id)));
}
