/**
 * Deterministic answer normalization shared by local scoring and review UI.
 *
 * This is a deliberate mirror of `normalize_typed_answer` in the Rust scorer so
 * the browser and the server never disagree about whether two typed answers are
 * the same. It is intentionally not fuzzy: `SQS` and `SNS`, or `ALB` and `NLB`,
 * stay distinct because correctness requires an exact normalized match.
 */

/** Collapses whitespace, strips harmless trailing punctuation, and lowercases. */
export function normalizeTypedAnswer(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(" ")
    .replace(/[.,;:!?]+$/, "")
    .trim()
    .toLowerCase();
}

/** Whether a typed answer matches any explicitly authored alias. */
export function typedAnswerMatches(
  raw: string,
  accepted: readonly string[],
): boolean {
  const normalized = normalizeTypedAnswer(raw);
  if (normalized.length === 0) {
    return false;
  }
  return accepted.some((answer) => normalizeTypedAnswer(answer) === normalized);
}
