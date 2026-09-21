import {
  clearAccountCache,
  loadAccount,
  peekAccount,
  type Streak,
} from "./account";

export type { Streak } from "./account";
export { EMPTY_STREAK } from "./account";

/**
 * Streak accessors over the shared account state.
 *
 * The streak is bundled into `GET /v1/me`, so these delegate to the account
 * loader and share its cache and in-flight deduplication.
 */

/** Loads the account streak, best-effort and deduplicated. */
export async function loadStreak(force = false): Promise<Streak | null> {
  const account = await loadAccount(force);
  return account?.streak ?? null;
}

/** Returns the cached streak without triggering a request, if any. */
export function peekStreak(): Streak | null {
  return peekAccount()?.streak ?? null;
}

/** Clears the cached account state, for tests and explicit refreshes. */
export function clearStreakCache(): void {
  clearAccountCache();
}
