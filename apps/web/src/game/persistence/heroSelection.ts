/**
 * Local convenience memory for the player's last chosen operator.
 *
 * This is a convenience only: the server validates the hero id on every
 * Operation start, so a stale or tampered value falls back safely. It is never
 * authoritative progression.
 */

const KEY = "cyber-defense-last-hero-v1";

/** Reads the last selected hero id, or `null` when absent or invalid. */
export function readLastHeroId(validIds: readonly string[]): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw && validIds.includes(raw)) {
      return raw;
    }
  } catch {
    // Storage may be unavailable; fall back to the default operator.
  }
  return null;
}

/** Remembers the selected hero id for next time. */
export function writeLastHeroId(heroId: string): void {
  try {
    window.localStorage.setItem(KEY, heroId);
  } catch {
    // Storage may be unavailable; selection still applies for this session.
  }
}
