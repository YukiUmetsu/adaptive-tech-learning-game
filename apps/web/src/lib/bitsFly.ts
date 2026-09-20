/**
 * Bits-earned event bus.
 *
 * A tiny decoupled channel: any component that earns Bits announces the amount
 * and an optional origin element, and a single overlay animates the reward into
 * the wallet HUD. This keeps the animation out of the components that trigger it
 * and lets every reward source (an answer, a mission, a Daily Mission) share one
 * experience.
 */

export const BITS_EARNED_EVENT = "adaptive-learn:bits-earned";

/** Attribute on the wallet element Bits fly into. */
export const BITS_TARGET_ATTR = "data-bits-target";

/** Payload carried by a Bits-earned event. */
export interface BitsEarnedDetail {
  amount: number;
  /** Viewport coordinates the reward flies from. */
  x: number;
  y: number;
}

/** Viewport center of the wallet HUD, or `null` when it is not mounted. */
export function bitsTargetCenter(): { x: number; y: number } | null {
  if (typeof document === "undefined") {
    return null;
  }
  const element = document.querySelector<HTMLElement>(`[${BITS_TARGET_ATTR}]`);
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Announces earned Bits from an optional origin element.
 *
 * Safe to call anywhere: a non-positive amount is ignored, and a missing origin
 * falls back to the viewport center.
 */
export function emitBitsEarned(amount: number, origin?: Element | null): void {
  if (!Number.isFinite(amount) || amount <= 0 || typeof window === "undefined") {
    return;
  }
  const rect = origin?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const detail: BitsEarnedDetail = { amount, x, y };
  window.dispatchEvent(new CustomEvent(BITS_EARNED_EVENT, { detail }));
}
