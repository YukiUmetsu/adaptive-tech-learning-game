/**
 * First-run tutorial state.
 *
 * A single flag so the how-to-play popup shows once, with a manual "?" button
 * to reopen it later. Kept separate from mission progress.
 */

const KEY = "adaptive-learn.cyber-defense-tutorial.v1";

export function hasSeenTutorial(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Storage may be unavailable; the popup simply shows again next time.
  }
}

export function resetTutorial(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
