import type {
  DomainDiscoveryInput,
  PlannerAction,
  RecommendationEventKind,
} from "../api/types";
import { newId } from "../lib/id";
import { mergeDiscoveryLists, subtractDiscoveryLists } from "./discovery";

/**
 * Local pending queue for auxiliary work that is batched into `/v1/sync`.
 *
 * Discovery persistence and recommendation telemetry are enhancements, never
 * prerequisites: enqueuing only writes localStorage, and every network failure
 * leaves the queue intact for a later natural sync boundary. Discovery is
 * set-union based, so duplicate batches are harmless; telemetry carries a stable
 * event id so retries are idempotent.
 */

/** Pending raw discovery for one learning track version. */
export interface PendingDiscoveryUpdate {
  trackVersion: string;
  contentVersion: string;
  domains: DomainDiscoveryInput[];
}

/** Pending recommendation lifecycle telemetry. */
export interface PendingAuxiliaryEvent {
  /** Stable dedup key, derived from the event's identity. */
  id: string;
  /** Stable id sent to the server for idempotent retries. */
  eventId: string;
  trackId: string;
  recommendationId: string;
  event: RecommendationEventKind;
  action: PlannerAction | null;
  domainId: string | null;
  nodeId: string | null;
  questionId: string | null;
}

export const PENDING_DISCOVERY_KEY = "adaptive-learn.pending-discovery.v1";
export const PENDING_AUXILIARY_KEY = "adaptive-learn.pending-auxiliary.v1";

/**
 * Upper bound on queued telemetry. Telemetry is non-authoritative, so the oldest
 * events are dropped on overflow rather than letting the queue grow without
 * bound and inflate every future sync request.
 */
export const MAX_PENDING_AUXILIARY_EVENTS = 200;

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
    // Storage can be unavailable (private mode, quota). Auxiliary work is
    // best-effort, so dropping it is acceptable.
    return false;
  }
}

function isDiscoveryDomain(value: unknown): value is DomainDiscoveryInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  return typeof (value as DomainDiscoveryInput).domain_id === "string";
}

/** Loads and sanitizes pending discovery updates. */
export function loadPendingDiscovery(): PendingDiscoveryUpdate[] {
  const raw = readJson<unknown>(PENDING_DISCOVERY_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }
  const updates: PendingDiscoveryUpdate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<PendingDiscoveryUpdate>;
    if (
      typeof candidate.trackVersion !== "string" ||
      typeof candidate.contentVersion !== "string" ||
      !Array.isArray(candidate.domains)
    ) {
      continue;
    }
    updates.push({
      trackVersion: candidate.trackVersion,
      contentVersion: candidate.contentVersion,
      domains: candidate.domains.filter(isDiscoveryDomain),
    });
  }
  return updates;
}

/**
 * Queues a discovery delta, unioning it into any pending entry for the track.
 *
 * Because discovery is set-union based, merging here means repeated reveals of
 * the same prompt/element collapse to one value before any request is made.
 */
export function enqueueDiscovery(update: PendingDiscoveryUpdate): boolean {
  const pending = loadPendingDiscovery();
  const existing = pending.find(
    (entry) => entry.trackVersion === update.trackVersion,
  );
  if (existing) {
    existing.contentVersion = update.contentVersion;
    existing.domains = mergeDiscoveryLists(existing.domains, update.domains);
  } else {
    pending.push({
      trackVersion: update.trackVersion,
      contentVersion: update.contentVersion,
      domains: update.domains,
    });
  }
  return writeJson(PENDING_DISCOVERY_KEY, pending);
}

/** Removes exactly the reveals that were sent, keeping later local reveals. */
export function markDiscoverySent(sent: PendingDiscoveryUpdate[]): void {
  const sentByTrack = new Map(sent.map((entry) => [entry.trackVersion, entry]));
  const remaining: PendingDiscoveryUpdate[] = [];
  for (const entry of loadPendingDiscovery()) {
    const sentEntry = sentByTrack.get(entry.trackVersion);
    if (!sentEntry) {
      remaining.push(entry);
      continue;
    }
    const domains = subtractDiscoveryLists(entry.domains, sentEntry.domains);
    if (domains.length > 0) {
      remaining.push({ ...entry, domains });
    }
  }
  writeJson(PENDING_DISCOVERY_KEY, remaining);
}

/** Loads and sanitizes pending auxiliary telemetry. */
export function loadPendingAuxiliary(): PendingAuxiliaryEvent[] {
  const raw = readJson<unknown>(PENDING_AUXILIARY_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }
  const events: PendingAuxiliaryEvent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<PendingAuxiliaryEvent>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.eventId !== "string" ||
      typeof candidate.trackId !== "string" ||
      typeof candidate.recommendationId !== "string" ||
      typeof candidate.event !== "string"
    ) {
      continue;
    }
    events.push({
      id: candidate.id,
      eventId: candidate.eventId,
      trackId: candidate.trackId,
      recommendationId: candidate.recommendationId,
      event: candidate.event,
      action: candidate.action ?? null,
      domainId: candidate.domainId ?? null,
      nodeId: candidate.nodeId ?? null,
      questionId: candidate.questionId ?? null,
    });
  }
  return events;
}

function auxiliaryKey(
  event: Omit<PendingAuxiliaryEvent, "id" | "eventId">,
): string {
  return [
    event.recommendationId,
    event.event,
    event.nodeId ?? "",
    event.questionId ?? "",
  ].join(":");
}

/**
 * Queues one telemetry event, deduplicating by recommendation/event/node.
 *
 * Deduplication keeps a retried or repeated lifecycle stage from being sent
 * more than once while it is pending.
 */
export function enqueueAuxiliaryEvent(
  event: Omit<PendingAuxiliaryEvent, "id" | "eventId"> & {
    id?: string;
    eventId?: string;
  },
): boolean {
  const id = event.id ?? auxiliaryKey(event);
  const pending = loadPendingAuxiliary();
  if (pending.some((entry) => entry.id === id)) {
    return true;
  }
  pending.push({
    id,
    eventId: event.eventId ?? newId(),
    trackId: event.trackId,
    recommendationId: event.recommendationId,
    event: event.event,
    action: event.action ?? null,
    domainId: event.domainId ?? null,
    nodeId: event.nodeId ?? null,
    questionId: event.questionId ?? null,
  });
  const bounded =
    pending.length > MAX_PENDING_AUXILIARY_EVENTS
      ? pending.slice(pending.length - MAX_PENDING_AUXILIARY_EVENTS)
      : pending;
  return writeJson(PENDING_AUXILIARY_KEY, bounded);
}

/** Removes synced telemetry events from the pending queue. */
export function markAuxiliarySynced(ids: string[]): void {
  const synced = new Set(ids);
  const remaining = loadPendingAuxiliary().filter(
    (entry) => !synced.has(entry.id),
  );
  writeJson(PENDING_AUXILIARY_KEY, remaining);
}
