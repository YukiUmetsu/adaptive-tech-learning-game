import { useSyncExternalStore } from "react";

/**
 * Lightweight bridge between the Daily Mission surfaces and the floating Focus
 * widget.
 *
 * This is a *display projection* only. Daily Mission progress remains owned by
 * the Daily Mission persistence and API; Focus never reads or writes mission
 * state. When no mission is active the summary is cleared, and the widget
 * degrades to a plain focus timer.
 */
export const FOCUS_DAILY_KEY = "adaptive-learn.focus-daily.v1";

export interface FocusDailySummary {
  trackId: string;
  completed: number;
  total: number;
  nextTitle: string | null;
  nextMinutes: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function parseSummary(raw: unknown): FocusDailySummary | null {
  if (!isRecord(raw) || typeof raw.trackId !== "string" || raw.trackId === "") {
    return null;
  }
  return {
    trackId: raw.trackId,
    completed: asCount(raw.completed),
    total: asCount(raw.total),
    nextTitle: typeof raw.nextTitle === "string" ? raw.nextTitle : null,
    nextMinutes:
      typeof raw.nextMinutes === "number" && Number.isFinite(raw.nextMinutes)
        ? raw.nextMinutes
        : null,
  };
}

function read(): FocusDailySummary | null {
  try {
    const raw = window.sessionStorage.getItem(FOCUS_DAILY_KEY);
    return raw ? parseSummary(JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

let summary: FocusDailySummary | null = read();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Publishes the current Daily Mission projection, or clears it with `null`. */
export function publishFocusDaily(next: FocusDailySummary | null): void {
  const normalized = next ? parseSummary(next) : null;
  summary = normalized;
  try {
    if (normalized) {
      window.sessionStorage.setItem(FOCUS_DAILY_KEY, JSON.stringify(normalized));
    } else {
      window.sessionStorage.removeItem(FOCUS_DAILY_KEY);
    }
  } catch {
    // Storage may be unavailable; the in-memory value still applies.
  }
  emit();
}

/** The current projection, without subscribing. */
export function getFocusDaily(): FocusDailySummary | null {
  return summary;
}

export function subscribeFocusDaily(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding for the projection. */
export function useFocusDaily(): FocusDailySummary | null {
  return useSyncExternalStore(subscribeFocusDaily, getFocusDaily, getFocusDaily);
}

/** Clears the projection. Used by tests. */
export function resetFocusDaily(): void {
  summary = null;
  try {
    window.sessionStorage.removeItem(FOCUS_DAILY_KEY);
  } catch {
    // ignore
  }
  emit();
}

/** Re-reads the projection from session storage (tests/refresh). */
export function restoreFocusDaily(): FocusDailySummary | null {
  summary = read();
  emit();
  return summary;
}
