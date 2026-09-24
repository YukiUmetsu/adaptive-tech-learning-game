/**
 * Helpers for inline `typed_fill_blank` interactions.
 *
 * Parsing mirrors the authored `{{slot_id}}` syntax, and normalized comparison
 * mirrors the server's deterministic grading so review feedback does not
 * disagree with the score. Scoring itself remains server-authoritative; the
 * shared normalization also backs the local optimistic scorer.
 */

import type {
  FeedbackResponse,
  TypedBlankSlot,
} from "../api/types";
import {
  normalizeTypedAnswer,
  typedAnswerMatches,
} from "../scoring/normalize";

export { normalizeTypedAnswer, typedAnswerMatches };

export type TypedTextSegment =
  | { kind: "text"; text: string }
  | { kind: "slot"; slotId: string };

/** Per-blank presentation status after scoring. */
export type TypedBlankStatus = "correct" | "incorrect";

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
 * Derives per-blank presentation status from the server's feedback.
 *
 * This is presentation only: the authoritative score comes from the server.
 * It returns an empty map before submission or for a different interaction.
 */
export function typedBlankStatuses(
  slots: TypedBlankSlot[],
  values: Record<string, string>,
  feedback: FeedbackResponse | null | undefined,
): Record<string, TypedBlankStatus> {
  const statuses: Record<string, TypedBlankStatus> = {};
  if (!feedback || feedback.canonical_answer.type !== "typed_fill_blank") {
    return statuses;
  }

  const answers = feedback.canonical_answer.answers;
  for (const slot of slots) {
    const accepted = answers[slot.id]?.accepted_answers ?? [];
    statuses[slot.id] = typedAnswerMatches(values[slot.id] ?? "", accepted)
      ? "correct"
      : "incorrect";
  }
  return statuses;
}

/** A highlighted token part, split around an embedded blank sentinel. */
export type SentinelPart =
  | { kind: "text"; text: string }
  | { kind: "slot"; slotId: string };

export interface SentinelCode {
  /** Code with every `{{slot_id}}` replaced by a unique sentinel. */
  code: string;
  /** Sentinel token text to the slot id it represents. */
  slotsBySentinel: Map<string, string>;
}

const SENTINEL_PREFIX = "__TYPED_FILL_SLOT_";
const SENTINEL_SUFFIX = "__";

/**
 * Replaces `{{slot_id}}` placeholders with unique sentinel identifiers so the
 * complete code sample can be tokenized with full syntax context, then split
 * back apart during rendering.
 */
export function buildSentinelCode(template: string): SentinelCode {
  const slotsBySentinel = new Map<string, string>();
  let index = 0;

  const code = template.replace(PLACEHOLDER, (_match, slotId: string) => {
    const sentinel = `${SENTINEL_PREFIX}${index}${SENTINEL_SUFFIX}`;
    slotsBySentinel.set(sentinel, slotId);
    index += 1;
    return sentinel;
  });

  return { code, slotsBySentinel };
}

/** Splits one highlighted token's text around any sentinels it contains. */
export function splitSentinels(
  content: string,
  slotsBySentinel: Map<string, string>,
): SentinelPart[] {
  if (slotsBySentinel.size === 0) {
    return content.length > 0 ? [{ kind: "text", text: content }] : [];
  }

  const pattern = new RegExp(
    `(${[...slotsBySentinel.keys()].map(escapeRegExp).join("|")})`,
    "g",
  );

  const parts: SentinelPart[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ kind: "text", text: content.slice(lastIndex, index) });
    }
    const slotId = slotsBySentinel.get(match[0]);
    if (slotId !== undefined) {
      parts.push({ kind: "slot", slotId });
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ kind: "text", text: content.slice(lastIndex) });
  }

  return parts;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  py: "python",
  python3: "python",
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  rs: "rust",
};

/** Maps common language aliases to the highlighting engine's language ids. */
export function normalizeLanguage(language: string): string {
  const key = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[key] ?? key;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
