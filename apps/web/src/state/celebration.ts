/**
 * Once-per-mission celebration guard.
 *
 * The completion sound and Bits count-up must fire exactly once per mission,
 * even if React re-renders, the component remounts after navigation, or
 * StrictMode double-invokes effects. The guard is mirrored to session storage so
 * refreshing a finished summary does not replay the celebration, while a fresh
 * tab starts clean.
 */
const STORAGE_KEY = "adaptive-learn.celebrated-missions";
const MAX_REMEMBERED = 50;

function read(): string[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

const celebratedMissions = new Set<string>(read());

function persist(): void {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...celebratedMissions]),
    );
  } catch {
    // Storage can be unavailable; in-memory tracking still applies.
  }
}

/** Claims a celebration, returning true only for the first caller per mission. */
export function claimMissionCelebration(missionId: string): boolean {
  if (!missionId || celebratedMissions.has(missionId)) {
    return false;
  }

  celebratedMissions.add(missionId);
  if (celebratedMissions.size > MAX_REMEMBERED) {
    const keep = [...celebratedMissions].slice(-MAX_REMEMBERED);
    celebratedMissions.clear();
    for (const id of keep) {
      celebratedMissions.add(id);
    }
  }
  persist();
  return true;
}

/** Clears the guard. Used by tests. */
export function resetMissionCelebrations(): void {
  celebratedMissions.clear();
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}
