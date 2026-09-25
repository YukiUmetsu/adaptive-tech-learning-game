import type { GameState } from "../engine/simulation";

/**
 * Temporary in-progress mission cache.
 *
 * Only the current mission snapshot is stored so an accidental refresh (or a
 * phone locking) can be recovered without losing the run. Persisted economy
 * state never lives here — Bits stay server-authoritative (spec sections 29
 * and 30).
 *
 * The schema is versioned: a snapshot written by an older game build is
 * discarded rather than restored, because a partial/legacy state would crash
 * the board (missing arrays) and blank the page.
 */

const KEY = "adaptive-learn.cyber-defense-session.v1";
const VERSION = 4;

interface CachedSession {
  version: number;
  missionId: string;
  savedAt: string;
  state: GameState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shape check: every field the running board reads must be present. */
function isRestorableState(value: unknown, missionId: string): value is GameState {
  if (!isRecord(value)) {
    return false;
  }
  if (value.missionId !== missionId || typeof value.phase !== "string") {
    return false;
  }
  if (
    typeof value.health !== "number" ||
    typeof value.maxHealth !== "number" ||
    typeof value.budget !== "number"
  ) {
    return false;
  }
  if (!isRecord(value.stats)) {
    return false;
  }
  for (const key of [
    "placed",
    "enemies",
    "heroes",
    "engagements",
    "heroUnits",
    "heroEngagements",
    "effects",
    "spawnQueue",
  ]) {
    if (!Array.isArray(value[key])) {
      return false;
    }
  }
  return true;
}

export function saveSession(state: GameState): void {
  const payload: CachedSession = {
    version: VERSION,
    missionId: state.missionId,
    savedAt: new Date().toISOString(),
    state,
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable; the run continues in memory.
  }
}

/** Loads a cached run for a mission, or null when none is valid. */
export function loadSession(missionId: string): GameState | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== VERSION) {
      return null;
    }
    if (parsed.missionId !== missionId) {
      return null;
    }
    return isRestorableState(parsed.state, missionId) ? parsed.state : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
