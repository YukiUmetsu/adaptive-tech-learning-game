import type { GlossaryTerm } from "../api/types";

/** One run of authored text, split on backtick code spans. */
export interface InlineCodeSegment {
  text: string;
  code: boolean;
}

/** One run of authored text, after code and glossary highlighting. */
export type RichTextSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "term"; text: string; definition: string };

/**
 * Splits authored text into plain and inline-code segments.
 *
 * A single pair of backticks marks a code term, for example
 * `` `mem_used_percent` `` or `` `/var/log/app.log` ``. An unmatched backtick is
 * kept as literal text so malformed content never disappears or throws.
 */
export function parseInlineCode(text: string): InlineCodeSegment[] {
  if (!text || !text.includes("`")) {
    return [{ text, code: false }];
  }

  const segments: InlineCodeSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf("`", cursor);
    if (open === -1) {
      segments.push({ text: text.slice(cursor), code: false });
      break;
    }
    const close = text.indexOf("`", open + 1);
    if (close === -1) {
      // Unterminated backtick: treat the remainder as plain text.
      segments.push({ text: text.slice(cursor), code: false });
      break;
    }
    if (open > cursor) {
      segments.push({ text: text.slice(cursor, open), code: false });
    }
    const code = text.slice(open + 1, close);
    if (code.length > 0) {
      segments.push({ text: code, code: true });
    }
    cursor = close + 1;
  }

  return segments.length > 0 ? segments : [{ text, code: false }];
}

/**
 * Removes backticks for contexts that cannot render markup, such as accessible
 * labels and `<option>` text.
 */
export function stripInlineCode(text: string): string {
  return text.replaceAll("`", "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-bounds a term so `memory` does not match inside `memories`. */
function termPattern(term: string): string {
  const start = /^\w/.test(term) ? "\\b" : "";
  const end = /\w$/.test(term) ? "\\b" : "";
  return `${start}${escapeRegExp(term)}${end}`;
}

function splitTerms(
  text: string,
  terms: readonly GlossaryTerm[],
): RichTextSegment[] {
  if (text.length === 0 || terms.length === 0) {
    return text.length > 0 ? [{ kind: "text", text }] : [];
  }

  // Longest term first so `guest OS memory` wins over `memory`.
  const ordered = [...terms]
    .filter((term) => term.term.trim().length > 0)
    .sort((a, b) => b.term.length - a.term.length);
  if (ordered.length === 0) {
    return [{ kind: "text", text }];
  }

  const byLower = new Map(
    ordered.map((term) => [term.term.trim().toLowerCase(), term]),
  );
  const pattern = ordered.map((term) => termPattern(term.term.trim())).join("|");
  const regex = new RegExp(pattern, "gi");

  const segments: RichTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > last) {
      segments.push({ kind: "text", text: text.slice(last, index) });
    }
    const matched = match[0];
    const term = byLower.get(matched.toLowerCase());
    if (term) {
      segments.push({ kind: "term", text: matched, definition: term.definition });
    } else {
      segments.push({ kind: "text", text: matched });
    }
    last = index + matched.length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) });
  }
  return segments;
}

/**
 * Splits authored text into plain, inline-code, and glossary-term segments.
 *
 * Code spans are never searched for glossary terms, so a term inside backticks
 * stays code. Terms are matched case-insensitively on word boundaries.
 */
export function parseRichText(
  text: string,
  terms: readonly GlossaryTerm[] = [],
): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  for (const segment of parseInlineCode(text)) {
    if (segment.code) {
      segments.push({ kind: "code", text: segment.text });
    } else {
      segments.push(...splitTerms(segment.text, terms));
    }
  }
  return segments;
}
