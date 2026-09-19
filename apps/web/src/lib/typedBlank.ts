/**
 * Helpers for inline `typed_fill_blank` interactions.
 *
 * Parsing mirrors the authored `{{slot_id}}` syntax, and normalized comparison
 * mirrors the server's deterministic grading so review feedback does not
 * disagree with the score. Scoring itself remains server-authoritative.
 */

export type TypedTextSegment =
  | { kind: "text"; text: string }
  | { kind: "slot"; slotId: string };

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

/**
 * Splits authored text into literal text and slot placeholders, in order.
 *
 * Malformed placeholders (an unclosed `{{`) are left in the literal text; the
 * server rejects those at validation time, so the UI only needs to stay safe.
 */
export function parseTypedText(text: string): TypedTextSegment[] {
  const segments: TypedTextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, index) });
    }
    segments.push({ kind: "slot", slotId: match[1] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Normalizes a typed answer for deterministic comparison.
 *
 * Collapses whitespace (trimming as a side effect), strips harmless trailing
 * punctuation, and lowercases. This is intentionally not fuzzy: `SQS` and
 * `SNS`, or `ALB` and `NLB`, stay distinct.
 */
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
