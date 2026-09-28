import { useSyncExternalStore } from "react";

import { api } from "../../api/client";
import type { components } from "../../api/schema";
import { reconcileBits } from "../../state/wallet";
import { GAME_CATALOG } from "../data";
import { getGameProgress } from "../persistence/gameProgress";

/**
 * Server-authoritative Cyber Defense profile store.
 *
 * One place fetches `/v1/cyber-defense/profile` and caches the last snapshot, so
 * many components can render persistent progression without each issuing their
 * own request. Completion responses reconcile the cache and the Bits wallet.
 * See Stage2.md steps 3 and 6.
 */

export type CyberProfile = components["schemas"]["CyberDefenseProfileResponse"];
export type CyberOperationRun = components["schemas"]["CyberOperationRunDto"];
export type CyberOperationCompletion =
  components["schemas"]["CyberOperationCompleteResponse"];
export type CyberCampaignCompletion =
  components["schemas"]["CyberCampaignCompleteResponse"];
export type CyberTowerPurchase =
  components["schemas"]["CyberTowerUpgradePurchaseResponse"];
export type CyberHeroProgress = components["schemas"]["CyberHeroProgressDto"];

/** Uniform result of a Cyber Defense API call. */
export type CyberApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      message: string;
      /** Active run id, when the server reported `active_operation_exists`. */
      activeRunId: string | null;
    };

let profile: CyberProfile | null = null;
let loading = false;
let error: string | null = null;
let inFlight: Promise<CyberProfile | null> | null = null;
let legacyImportInFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Last known profile, or `null` before the first successful load. */
export function getCyberProfile(): CyberProfile | null {
  return profile;
}

export function isCyberProfileLoading(): boolean {
  return loading;
}

export function getCyberProfileError(): string | null {
  return error;
}

function failure<T>(result: { error?: unknown }): CyberApiResult<T> {
  const body = (
    result.error as
      | { error?: { code?: string; message?: string; active_run_id?: string | null } }
      | undefined
  )?.error;
  return {
    ok: false,
    code: body?.code ?? "unknown",
    message: body?.message ?? "The request could not be completed.",
    activeRunId: body?.active_run_id ?? null,
  };
}

/** A transport failure (offline, DNS, aborted request). */
function networkFailure<T>(): CyberApiResult<T> {
  return {
    ok: false,
    code: "network",
    message: "Could not reach the server. Check your connection and try again.",
    activeRunId: null,
  };
}

/**
 * Runs one API call and always resolves to a result.
 *
 * A rejected fetch (offline, timeout, aborted) must never leave a caller's
 * busy state set, so transport errors become an `ok: false` result instead of
 * an exception.
 */
async function run<T>(
  call: () => Promise<{ data?: T; error?: unknown }>,
  onSuccess?: (data: T) => void,
): Promise<CyberApiResult<T>> {
  try {
    const result = await call();
    if (result.data !== undefined) {
      onSuccess?.(result.data);
      return { ok: true, data: result.data };
    }
    return failure<T>(result);
  } catch {
    return networkFailure<T>();
  }
}

function reconcile(profileData: CyberProfile): void {
  profile = profileData;
  reconcileBits(profileData.bits_balance);
  error = null;
}

/**
 * Fetches the profile, sharing one request across concurrent callers.
 *
 * A failure leaves the previous snapshot in place so the game stays playable
 * offline.
 */
export function refreshCyberProfile(): Promise<CyberProfile | null> {
  if (inFlight) {
    return inFlight;
  }

  loading = true;
  emit();
  inFlight = (async () => {
    try {
      const result = await api.GET("/v1/cyber-defense/profile");
      if (result.data) {
        reconcile(result.data);
      } else {
        error = "Could not load your Cyber Defense profile.";
      }
    } catch {
      error = "Could not load your Cyber Defense profile.";
    } finally {
      loading = false;
      inFlight = null;
      emit();
    }
    return profile;
  })();

  return inFlight;
}

/** Replaces the cached profile (used by tests and sign-out). */
export function setCyberProfile(next: CyberProfile | null): void {
  profile = next;
  emit();
}

/** Clears the cached profile, for example on sign-out. */
export function resetCyberProfile(): void {
  profile = null;
  error = null;
  loading = false;
  inFlight = null;
  emit();
}

/** React binding for the cached profile snapshot. */
export function useCyberProfile(): CyberProfile | null {
  return useSyncExternalStore(subscribe, getCyberProfile, getCyberProfile);
}

/** React binding for the profile loading flag. */
export function useCyberProfileLoading(): boolean {
  return useSyncExternalStore(
    subscribe,
    isCyberProfileLoading,
    isCyberProfileLoading,
  );
}

/** React binding for the profile error message. */
export function useCyberProfileError(): string | null {
  return useSyncExternalStore(subscribe, getCyberProfileError, getCyberProfileError);
}

/** Starts an Operation, or reports the active run that blocks it. */
export async function startOperation(request: {
  requested_threat_level: number;
  hero_id?: string;
  template_id?: string;
}): Promise<CyberApiResult<CyberOperationRun>> {
  return run(() =>
    api.POST("/v1/cyber-defense/operations", { body: request }),
  );
}

/** Reads one owned Operation run, restoring an exact run after a refresh. */
export function getOperation(
  runId: string,
): Promise<CyberApiResult<CyberOperationRun>> {
  return run(() =>
    api.GET("/v1/cyber-defense/operations/{run_id}", {
      params: { path: { run_id: runId } },
    }),
  );
}

/**
 * Applies Engineering Lab defense substitutions to an active Operation.
 *
 * The server derives the allowance from the room level and re-validates the
 * resulting loadout, so the client only sends the intended swaps.
 */
export function setOperationLoadout(
  runId: string,
  defenseSwaps: { remove: string; add: string }[],
): Promise<CyberApiResult<CyberOperationRun>> {
  return run(() =>
    api.PUT("/v1/cyber-defense/operations/{run_id}/loadout", {
      params: { path: { run_id: runId } },
      body: { defense_swaps: defenseSwaps },
    }),
  );
}

/** Settles one Operation run and reconciles the profile. */
export function completeOperation(
  runId: string,
  request: {
    completed: boolean;
    stars: number;
    health: number;
    duration_ms: number;
  },
): Promise<CyberApiResult<CyberOperationCompletion>> {
  return run(
    () =>
      api.POST("/v1/cyber-defense/operations/{run_id}/complete", {
        params: { path: { run_id: runId } },
        body: request,
      }),
    (data) => {
      reconcileBits(data.bits_balance);
      void refreshCyberProfile();
    },
  );
}

/** Abandons an active Operation run. */
export function abandonOperation(
  runId: string,
): Promise<CyberApiResult<CyberOperationRun>> {
  return run(
    () =>
      api.POST("/v1/cyber-defense/operations/{run_id}/abandon", {
        params: { path: { run_id: runId } },
      }),
    () => {
      void refreshCyberProfile();
    },
  );
}

/** Settles a Stage 1 campaign mission and reconciles the profile. */
export function completeCampaign(
  missionId: string,
  request: {
    result_id: string;
    stars: number;
    health: number;
    duration_ms: number;
    hero_id?: string | null;
  },
): Promise<CyberApiResult<CyberCampaignCompletion>> {
  return run(
    () =>
      api.POST("/v1/cyber-defense/campaign/{mission_id}/complete", {
        params: { path: { mission_id: missionId } },
        body: request,
      }),
    (data) => {
      reconcileBits(data.bits_balance);
      void refreshCyberProfile();
    },
  );
}

/** Purchases the next level of one Tower room and reconciles the profile. */
export function purchaseTowerUpgrade(
  upgradeId: string,
  eventId: string,
): Promise<CyberApiResult<CyberTowerPurchase>> {
  return run(
    () =>
      api.POST("/v1/cyber-defense/tower/upgrades/{upgrade_id}", {
        params: { path: { upgrade_id: upgradeId } },
        body: { event_id: eventId },
      }),
    (data) => {
      reconcileBits(data.bits_balance);
      void refreshCyberProfile();
    },
  );
}

/** Replaces a hero's talents and reconciles the profile. */
export function setHeroTalents(
  heroId: string,
  talents: Record<string, string>,
): Promise<CyberApiResult<CyberHeroProgress>> {
  return run(
    () =>
      api.PUT("/v1/cyber-defense/heroes/{hero_id}/talents", {
        params: { path: { hero_id: heroId } },
        body: { talents },
      }),
    () => {
      void refreshCyberProfile();
    },
  );
}

/**
 * Imports legacy Stage 1 local progress once, when the profile has not already
 * imported it. Local progress stays a display fallback after import.
 */
export function maybeImportLegacyProgress(): Promise<void> {
  if (legacyImportInFlight) {
    return legacyImportInFlight;
  }
  const current = profile;
  if (!current || current.legacy_progress_imported) {
    return Promise.resolve();
  }

  legacyImportInFlight = (async () => {
    try {
      const local = getGameProgress();
      const missions: Record<
        string,
        { completed: boolean; stars: number; best_health: number; attempts: number }
      > = {};
      for (const mission of GAME_CATALOG.missions) {
        const entry = local.missions[mission.id];
        if (!entry) {
          continue;
        }
        missions[mission.id] = {
          completed: entry.completed,
          stars: entry.stars,
          best_health: entry.bestHealth,
          attempts: entry.attempts,
        };
      }
      const result = await api.POST("/v1/cyber-defense/legacy-progress", {
        body: { missions },
      });
      if (result.data) {
        reconcileBits(result.data.bits_balance);
        await refreshCyberProfile();
      }
    } catch {
      // Offline: retry on a later profile load.
    } finally {
      legacyImportInFlight = null;
    }
  })();

  return legacyImportInFlight;
}
