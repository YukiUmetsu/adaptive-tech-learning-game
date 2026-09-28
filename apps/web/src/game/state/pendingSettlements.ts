import { newId } from "../../lib/id";
import {
  completeCampaign,
  completeOperation,
  type CyberApiResult,
} from "./cyberProfile";

/**
 * Durable pending reward settlements.
 *
 * A finished battle must never lose its reward because the network dropped.
 * Before a completion request is sent, the caller persists a pending record
 * here; it is removed only after the server settles it. Retries reuse the exact
 * same identifiers (`result_id` for a campaign, the server-issued run id for an
 * Operation) so the server's idempotency prevents a double reward.
 *
 * The store is deliberately tiny and local: no new cloud dependency, and the
 * dashboard retries it on load and when the browser comes back online.
 */

const KEY = "cyber-defense-pending-settlements-v1";

/** Result evidence for one Operation completion. */
export interface PendingOperationPayload {
  completed: boolean;
  stars: number;
  health: number;
  duration_ms: number;
}

/** Result evidence for one campaign completion. */
export interface PendingCampaignPayload {
  stars: number;
  health: number;
  duration_ms: number;
  hero_id: string | null;
}

export interface PendingOperationSettlement {
  kind: "operation";
  id: string;
  runId: string;
  payload: PendingOperationPayload;
  createdAt: string;
}

export interface PendingCampaignSettlement {
  kind: "campaign";
  id: string;
  missionId: string;
  resultId: string;
  payload: PendingCampaignPayload;
  createdAt: string;
}

export type PendingSettlement =
  | PendingOperationSettlement
  | PendingCampaignSettlement;

/** Input accepted by {@link enqueuePendingSettlement}. */
export type PendingSettlementInput =
  | {
      kind: "operation";
      runId: string;
      payload: PendingOperationPayload;
    }
  | {
      kind: "campaign";
      missionId: string;
      resultId: string;
      payload: PendingCampaignPayload;
    };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: unknown): PendingSettlement | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  if (value.kind === "operation" && typeof value.runId === "string") {
    const payload = value.payload;
    if (!isRecord(payload)) {
      return null;
    }
    return {
      kind: "operation",
      id: value.id,
      runId: value.runId,
      createdAt,
      payload: {
        completed: payload.completed === true,
        stars: Number(payload.stars) || 0,
        health: Number(payload.health) || 0,
        duration_ms: Number(payload.duration_ms) || 0,
      },
    };
  }
  if (
    value.kind === "campaign" &&
    typeof value.missionId === "string" &&
    typeof value.resultId === "string"
  ) {
    const payload = value.payload;
    if (!isRecord(payload)) {
      return null;
    }
    return {
      kind: "campaign",
      id: value.id,
      missionId: value.missionId,
      resultId: value.resultId,
      createdAt,
      payload: {
        stars: Number(payload.stars) || 0,
        health: Number(payload.health) || 0,
        duration_ms: Number(payload.duration_ms) || 0,
        hero_id:
          typeof payload.hero_id === "string" ? payload.hero_id : null,
      },
    };
  }
  return null;
}

/** Reads every pending settlement, dropping malformed entries. */
export function readPendingSettlements(): PendingSettlement[] {
  const store = storage();
  if (!store) {
    return [];
  }
  try {
    const raw = store.getItem(KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(parseRecord)
      .filter((entry): entry is PendingSettlement => entry !== null);
  } catch {
    return [];
  }
}

function write(records: PendingSettlement[]): void {
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.setItem(KEY, JSON.stringify(records));
  } catch {
    // Storage may be unavailable; the caller still shows a pending state.
  }
}

function sameIdentity(a: PendingSettlement, b: PendingSettlement): boolean {
  if (a.kind === "operation" && b.kind === "operation") {
    return a.runId === b.runId;
  }
  if (a.kind === "campaign" && b.kind === "campaign") {
    return a.missionId === b.missionId && a.resultId === b.resultId;
  }
  return false;
}

/** Persists a pending settlement, de-duplicating an identical retry. */
export function enqueuePendingSettlement(
  record: { kind: "operation"; runId: string; payload: PendingOperationPayload },
): PendingOperationSettlement;
export function enqueuePendingSettlement(
  record: {
    kind: "campaign";
    missionId: string;
    resultId: string;
    payload: PendingCampaignPayload;
  },
): PendingCampaignSettlement;
export function enqueuePendingSettlement(
  record: PendingSettlementInput,
): PendingSettlement {
  const full = {
    ...record,
    id: newId(),
    createdAt: new Date().toISOString(),
  } as PendingSettlement;
  const existing = readPendingSettlements().filter(
    (entry) => !sameIdentity(entry, full),
  );
  write([...existing, full]);
  return full;
}

/** Removes one pending settlement by local record id. */
export function removePendingSettlement(id: string): void {
  write(readPendingSettlements().filter((entry) => entry.id !== id));
}

/** Clears all pending settlements (tests and sign-out). */
export function clearPendingSettlements(): void {
  write([]);
}

/** Number of records currently queued, for tests and UI. */
export function pendingSettlementCount(): number {
  return readPendingSettlements().length;
}

/**
 * Whether a failed completion should be retried.
 *
 * Transport failures and server-unavailable errors are retryable; an
 * application rejection (unknown run, malformed result) is permanent and must
 * not retry forever.
 */
export function isRetryableFailure<T>(result: CyberApiResult<T>): boolean {
  return (
    !result.ok &&
    (result.code === "network" ||
      result.code === "internal_error" ||
      result.code === "unavailable")
  );
}

async function settle(record: PendingSettlement): Promise<boolean> {
  if (record.kind === "operation") {
    const result = await completeOperation(record.runId, record.payload);
    return result.ok || !isRetryableFailure(result);
  }
  const result = await completeCampaign(record.missionId, {
    result_id: record.resultId,
    ...record.payload,
  });
  return result.ok || !isRetryableFailure(result);
}

let flushing = false;

/**
 * Retries every pending settlement in order.
 *
 * Returns the number settled or permanently dropped. A network failure keeps
 * the record for the next attempt.
 */
export async function flushPendingSettlements(): Promise<number> {
  if (flushing) {
    return 0;
  }
  flushing = true;
  let resolved = 0;
  try {
    for (const record of readPendingSettlements()) {
      const done = await settle(record).catch(() => false);
      if (done) {
        removePendingSettlement(record.id);
        resolved += 1;
      }
    }
  } finally {
    flushing = false;
  }
  return resolved;
}

let installed = false;

/**
 * Flushes once now and again whenever the browser reconnects.
 *
 * Idempotent, so it is safe to call from every dashboard mount.
 */
export function initPendingSettlementSync(): void {
  void flushPendingSettlements();
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  window.addEventListener("online", () => {
    void flushPendingSettlements();
  });
}
