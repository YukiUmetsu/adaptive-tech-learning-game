/**
 * Display-only reward constants.
 *
 * These mirror the server-authoritative reward policy in
 * `crates/domain/src/reward.rs`. The server always settles Bits; this file only
 * lets the UI preview a plausible reward range so exploring feels worthwhile.
 */

/** Base Bits for a first-attempt, fully-correct answer. Mirrors `BASE_BITS`. */
export const BASE_BITS = 10;

/** Maximum difficulty bonus. Mirrors `difficulty_bonus` (prior * 6). */
export const MAX_DIFFICULTY_BONUS = 6;

/** Daily Mission completion bonus. Mirrors `DAILY_MISSION_BONUS_BITS`. */
export const DAILY_MISSION_BONUS_BITS = 25;

/** Learner-facing reward range for one correct answer. */
export const ANSWER_REWARD_RANGE = `${BASE_BITS}–${BASE_BITS + MAX_DIFFICULTY_BONUS}`;
