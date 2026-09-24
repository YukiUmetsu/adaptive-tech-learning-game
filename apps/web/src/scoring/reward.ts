/**
 * Display-only Bits preview, mirroring the authoritative Rust reward policy.
 *
 * This exists purely for the immediate reward animation. It is never persisted
 * as settled currency: the wallet is settled server-side during `/v1/sync` and
 * reconciled from the returned balance. A learner cannot mint settled Bits by
 * editing this code.
 *
 * The preview can legitimately differ from the settled amount: the server
 * derives the attempt number from accepted history and uses the canonical
 * difficulty prior, while the browser only knows its local attempt count.
 */

/** Base Bits for a first-attempt, fully-correct answer. */
export const BASE_BITS = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Difficulty bonus in `[0, 6]`, derived from the question's difficulty prior. */
export function difficultyBonus(difficultyPrior: number): number {
  return Math.round(clamp(difficultyPrior, 0, 1) * 6);
}

/**
 * Bits previewed for one locally scored attempt.
 *
 * Non-fully-correct attempts preview nothing; a later fully-correct attempt
 * previews roughly half. Settled Bits are always the server's decision.
 */
export function rewardBits(
  attemptNumber: number,
  score: number,
  difficultyPrior: number,
): number {
  if (score < 1) {
    return 0;
  }
  const full = BASE_BITS + difficultyBonus(difficultyPrior);
  return attemptNumber <= 1 ? full : Math.max(Math.floor(full / 2), 1);
}
