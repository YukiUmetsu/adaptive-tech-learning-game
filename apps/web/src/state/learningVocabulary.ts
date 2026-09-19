import type { KnowledgePrompt, PromptKind } from "../api/types";

/**
 * Shared prompt vocabulary.
 *
 * Content authors the label and placeholder; the UI owns the icon and styling
 * so every certification renders consistently. Keeping the mapping in one place
 * means a new prompt kind is a one-line change, not a new component.
 */
export interface PromptKindMeta {
  kind: PromptKind;
  /** Shared icon vocabulary. */
  icon: string;
  /** Accessible name used when the authored label is unavailable. */
  name: string;
  /** Stable class name suffix for per-kind styling. */
  className: string;
}

export const PROMPT_KIND_META: Record<PromptKind, PromptKindMeta> = {
  what: { kind: "what", icon: "❓", name: "What", className: "what" },
  when: { kind: "when", icon: "⏱️", name: "When", className: "when" },
  connects_to: {
    kind: "connects_to",
    icon: "🔗",
    name: "Connects to",
    className: "connects-to",
  },
  not_this: { kind: "not_this", icon: "🚫", name: "Not this", className: "not-this" },
  exam_clue: {
    kind: "exam_clue",
    icon: "🎯",
    name: "Exam clue",
    className: "exam-clue",
  },
  mental_model: {
    kind: "mental_model",
    icon: "🧠",
    name: "Mental model",
    className: "mental-model",
  },
  action: { kind: "action", icon: "⚡", name: "Action", className: "action" },
  look_for: {
    kind: "look_for",
    icon: "🔍",
    name: "Look for",
    className: "look-for",
  },
};

// Strip a leading pictograph so the UI can supply the canonical icon without
// duplicating it when content authors already prefixed the label.
const LEADING_ICON = /^[^\p{L}\p{N}]+/u;

/** The learner-facing words of a prompt, without a duplicated leading icon. */
export function promptWords(prompt: Pick<KnowledgePrompt, "label" | "kind">): string {
  const trimmed = prompt.label.trim();
  const words = trimmed.replace(LEADING_ICON, "").trim();
  if (words.length > 0) {
    return words;
  }
  return PROMPT_KIND_META[prompt.kind].name;
}

/** Accessible name for a prompt, used for screen-reader labels. */
export function promptAccessibleName(
  prompt: Pick<KnowledgePrompt, "label" | "kind">,
): string {
  return promptWords(prompt);
}
