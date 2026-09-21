import { api } from "../api/client";

/**
 * Account state loaded from `GET /v1/me`: the account-wide study streak and the
 * learner's study settings.
 *
 * Bundling both into the existing account response keeps the Track Hub to one
 * request. Everything is best-effort: a failure resolves to `null` and the UI
 * simply omits the streak or falls back to the guided default.
 */

/** Account-wide streak, independent of any single learning track. */
export interface Streak {
  current: number;
  longest: number;
  activeToday: boolean;
  lastActiveDay: string | null;
}

/** Learner study settings. */
export interface UserSettings {
  /** Unlock all study materials instead of the guided, in-order path. */
  unlockAllMaterials: boolean;
}

/** The neutral streak shown when data is unavailable. */
export const EMPTY_STREAK: Streak = {
  current: 0,
  longest: 0,
  activeToday: false,
  lastActiveDay: null,
};

/** The default settings used when the account request fails. */
export const DEFAULT_SETTINGS: UserSettings = {
  unlockAllMaterials: false,
};

/** Combined account state. */
export interface AccountState {
  streak: Streak;
  settings: UserSettings;
}

let cached: AccountState | null = null;
let inflight: Promise<AccountState | null> | null = null;

/** Loads account state, best-effort and deduplicated. */
export async function loadAccount(force = false): Promise<AccountState | null> {
  if (!force && cached) {
    return cached;
  }
  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const result = await api.GET("/v1/me");
      if (result.error || !result.data) {
        return null;
      }
      const account: AccountState = {
        streak: {
          current: result.data.streak.current,
          longest: result.data.streak.longest,
          activeToday: result.data.streak.active_today,
          lastActiveDay: result.data.streak.last_active_day ?? null,
        },
        settings: {
          unlockAllMaterials: result.data.settings.unlock_all_materials,
        },
      };
      cached = account;
      return account;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Returns the cached account state without triggering a request, if any. */
export function peekAccount(): AccountState | null {
  return cached;
}

/** Clears the cached account state, for tests and explicit refreshes. */
export function clearAccountCache(): void {
  cached = null;
  inflight = null;
}

/**
 * Persists the unlock-all setting and updates the cache.
 *
 * Returns the stored settings, or `null` on failure so callers can keep the
 * previous value.
 */
export async function saveUnlockAllMaterials(
  unlockAllMaterials: boolean,
): Promise<UserSettings | null> {
  try {
    const result = await api.PUT("/v1/me/settings", {
      body: { unlock_all_materials: unlockAllMaterials },
    });
    if (result.error || !result.data) {
      return null;
    }
    const settings: UserSettings = {
      unlockAllMaterials: result.data.unlock_all_materials,
    };
    if (cached) {
      cached = { ...cached, settings };
    } else {
      cached = { streak: EMPTY_STREAK, settings };
    }
    return settings;
  } catch {
    return null;
  }
}
