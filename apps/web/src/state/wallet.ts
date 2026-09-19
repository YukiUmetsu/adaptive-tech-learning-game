import { useSyncExternalStore } from "react";

import { api } from "../api/client";
import { getDeviceId, loadCachedBits, saveCachedBits } from "./persistence";

/**
 * Shared Bits balance store.
 *
 * The server is authoritative. The local cache exists so the HUD can render
 * instantly and preview rewards in the moment; it is reconciled on every wallet
 * fetch and on every sync response.
 */
let settled = loadCachedBits();
let pendingPreview = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Settled balance only. */
export function getSettledBits(): number {
  return settled;
}

/** Settled balance plus rewards previewed but not yet reconciled. */
export function getDisplayBits(): number {
  return settled + pendingPreview;
}

/** Adds an immediate reward preview (for example after a correct answer). */
export function previewBits(amount: number): void {
  if (amount <= 0) {
    return;
  }
  pendingPreview += amount;
  emit();
}

/** Replaces the local state with the authoritative server balance. */
export function reconcileBits(serverBalance: number): void {
  settled = Math.max(0, Math.floor(serverBalance));
  pendingPreview = 0;
  saveCachedBits(settled);
  emit();
}

let inFlight: Promise<void> | null = null;

/**
 * Fetches the authoritative balance. Failures leave the cache untouched.
 *
 * Concurrent callers (for example the app shell and a dashboard mounting
 * together) share a single request.
 */
export function refreshWallet(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const result = await api.GET("/v1/wallet", {
        params: { query: { device_id: getDeviceId() } },
      });
      if (result.data) {
        reconcileBits(result.data.bits_balance);
      }
    } catch {
      // Offline: keep showing the cached balance.
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding for the displayed Bits balance. */
export function useBitsBalance(): number {
  return useSyncExternalStore(subscribe, getDisplayBits, getDisplayBits);
}

/**
 * React binding for the settled, server-authoritative balance only.
 *
 * Used to celebrate increases that survived reconciliation rather than
 * optimistic client previews.
 */
export function useSettledBits(): number {
  return useSyncExternalStore(subscribe, getSettledBits, getSettledBits);
}
