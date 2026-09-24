/**
 * Local scoring library for ordinary study missions.
 *
 * Pure and framework-free so it can be unit-tested against the same golden
 * fixtures as the authoritative Rust scorer. See `scorer.ts` for the
 * non-authoritative trust model.
 */

export {
  scoreQuestion,
  scoreSubmitted,
  toSubmitted,
  ScoringError,
  type ScoreableQuestion,
  type ScoredAnswer,
  type SubmittedAnswer,
} from "./scorer";
export { normalizeTypedAnswer, typedAnswerMatches } from "./normalize";
