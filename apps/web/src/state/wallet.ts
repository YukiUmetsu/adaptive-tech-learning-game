import { useSyncExternalStore } from "react";

import { api } from "../api/client";
import {
  loadCachedBits,
  loadPendingBitSpends,
  saveCachedBits,
  savePendingBitSpends,
  type PendingBitSpend,
} from "./persistence";

export type { PendingBitSpend } from "./persistence";

/**
 * Shared Bits balance store.
 *
 * The server is authoritative. Two local layers sit on top of the settled
 * balance: a display-only reward preview, and a queue of spends that have been
 * applied locally but not yet confirmed by the server. Subtracting the pending
 * spends keeps an optimistic debit from being silently refunded by the next
 * reconciliation before the server has recorded it.
 */
let settled = loadCachedBits();
let pendingPreview = 0;
let pendingSpends: PendingBitSpend[] = loadPendingBitSpends();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function pendingSpendTotal(): number {
  return pendingSpends.reduce((sum, spend) => sum + spend.amount, 0);
}

/** Settled balance only, minus spends the server has not confirmed yet. */
export function getSettledBits(): number {
  return settled - pendingSpendTotal();
}

/** Settled balance plus rewards previewed but not yet reconciled. */
export function getDisplayBits(): number {
  return settled - pendingSpendTotal() + pendingPreview;
}

/** Adds an immediate reward preview (for example after a correct answer). */
export function previewBits(amount: number): void {
  if (amount <= 0) {
    return;
  }
  pendingPreview += amount;
  emit();
}

/** Replaces the local balance with the authoritative server balance. */
export function reconcileBits(serverBalance: number): void {
  settled = Math.max(0, Math.floor(serverBalance));
  pendingPreview = 0;
  saveCachedBits(settled);
  emit();
}

/**
 * Clears the cached wallet and any queued spends, for example on sign-out.
 *
 * The next signed-in session fetches its own authoritative balance.
 */
export function resetWallet(): void {
  settled = 0;
  pendingPreview = 0;
  pendingSpends = [];
  saveCachedBits(0);
  savePendingBitSpends([]);
  emit();
}

/** Spends awaiting server settlement, oldest first. */
export function getPendingBitSpends(): PendingBitSpend[] {
  return pendingSpends;
}

/**
 * Records an optimistic Bits spend and reports whether the cached balance can
 * cover it.
 *
 * The server stays authoritative: this reserves the amount locally and queues it
 * for settlement by `flushBitSpends`. A re-queue of the same `eventId` replaces
 * the earlier attempt rather than stacking a second debit.
 */
export function spendBits(spend: PendingBitSpend): boolean {
  if (!Number.isFinite(spend.amount) || spend.amount <= 0) {
    return true;
  }
  if (settled - pendingSpendTotal() < spend.amount) {
    return false;
  }
  pendingSpends = [
    ...pendingSpends.filter((item) => item.eventId !== spend.eventId),
    spend,
  ];
  savePendingBitSpends(pendingSpends);
  emit();
  return true;
}

/**
 * Drops a queued spend without touching the settled balance.
 *
 * Used when the action failed locally, or when the server rejected the spend
 * (for example insufficient Bits or no account), so the optimistic debit is
 * undone.
 */
export function refundBits(eventId: string): void {
  const next = pendingSpends.filter((spend) => spend.eventId !== eventId);
  if (next.length === pendingSpends.length) {
    return;
  }
  pendingSpends = next;
  savePendingBitSpends(next);
  emit();
}

/**
 * Confirms a spend that the server settled and adopts its authoritative balance.
 *
 * The returned balance already includes the debit, so the pending entry is
 * dropped at the same time.
 */
export function settleSpend(eventId: string, serverBalance: number): void {
  pendingSpends = pendingSpends.filter((spend) => spend.eventId !== eventId);
  settled = Math.max(0, Math.floor(serverBalance));
  savePendingBitSpends(pendingSpends);
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
      const result = await api.GET("/v1/wallet");
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
