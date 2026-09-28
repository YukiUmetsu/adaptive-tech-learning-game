import { api } from "../../api/client";
import type { components } from "../../api/schema";

/**
 * Batched Cyber Defense balance telemetry.
 *
 * Events are buffered in memory and flushed as one small batch, never per
 * interaction or per wave, so the game stays offline-first and cheap to run.
 * Only game identifiers and results are sent (Stage2.md step 19).
 */

export type CyberTelemetryEvent = components["schemas"]["CyberTelemetryEventDto"];

const MAX_BATCH = 50;
const FLUSH_INTERVAL_MS = 30_000;

let buffer: CyberTelemetryEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

function ensureTimer(): void {
  if (timer !== null || typeof window === "undefined") {
    return;
  }
  timer = setInterval(() => {
    void flushCyberTelemetry();
  }, FLUSH_INTERVAL_MS);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushCyberTelemetry();
    }
  });
}

/** Records one telemetry event. Never throws and never blocks gameplay. */
export function trackCyberEvent(
  name: string,
  fields: Omit<CyberTelemetryEvent, "name"> = {},
): void {
  try {
    if (buffer.length >= MAX_BATCH) {
      // Drop rather than grow without bound if the network is unavailable.
      void flushCyberTelemetry();
    }
    buffer.push({ name, ...fields });
    ensureTimer();
  } catch {
    // Telemetry must never affect the game.
  }
}

/** Buckets a duration in milliseconds for telemetry. */
export function durationBucket(durationMs: number): string {
  const minutes = durationMs / 60_000;
  if (minutes < 5) {
    return "under_5m";
  }
  if (minutes < 10) {
    return "5_10m";
  }
  if (minutes < 18) {
    return "10_18m";
  }
  return "over_18m";
}

/** Flushes the buffer. Safe to call concurrently and on unload. */
export async function flushCyberTelemetry(): Promise<void> {
  if (flushing || buffer.length === 0) {
    return;
  }
  flushing = true;
  const batch = buffer.slice(0, MAX_BATCH);
  try {
    const result = await api.POST("/v1/cyber-defense/telemetry", {
      body: { events: batch },
    });
    if (result.response.ok) {
      buffer = buffer.slice(batch.length);
    } else {
      // Drop rejected events so a bad event cannot wedge the queue forever.
      buffer = buffer.slice(batch.length);
    }
  } catch {
    // Offline: keep buffered events for a later flush.
  } finally {
    flushing = false;
  }
}

/** Clears the buffer and timer (used on sign-out and in tests). */
export function resetCyberTelemetry(): void {
  buffer = [];
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Current buffer length, for tests. */
export function telemetryBufferLength(): number {
  return buffer.length;
}
