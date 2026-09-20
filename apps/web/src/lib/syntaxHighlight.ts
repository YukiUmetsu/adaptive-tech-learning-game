/**
 * Client-side syntax highlighting setup.
 *
 * Prism is bundled locally with only the languages this product highlights, so
 * code questions render without any server round trip. The component imports
 * register onto the global instance created by the core import, which is why
 * the core is imported for its side effect first.
 *
 * Tokenization is Prism's; this module only flattens its token stream and
 * applies class names. Colors live in CSS so the palette follows the app.
 */

import "prismjs";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-hcl";

import type * as PrismTypes from "prismjs";

/** The Prism instance with the app's supported languages registered. */
export const prism = (globalThis as { Prism?: typeof PrismTypes }).Prism;

/** One highlighted fragment with its inherited token type chain. */
export interface HighlightToken {
  content: string;
  types: string[];
}

interface PrismTokenLike {
  type?: string;
  alias?: string | string[];
  content: string | PrismTokenLike[];
}

/**
 * Tokenizes `code` and returns a flat token list per line.
 *
 * Unknown languages fall back to uncolored `plain` tokens, so layout and blanks
 * still render. Never evaluates or interprets the code.
 */
export function highlightCode(
  code: string,
  language: string,
): HighlightToken[][] {
  // Normalize CRLF so a stray carriage return never lands in a rendered line.
  const normalized = code.replace(/\r\n?/g, "\n");
  const grammar = prism?.languages?.[language];
  if (!prism || !grammar) {
    return normalized
      .split("\n")
      .map((line) => (line.length > 0 ? [{ content: line, types: ["plain"] }] : []));
  }

  const flat: HighlightToken[] = [];
  const stream = prism.tokenize(normalized, grammar) as unknown as Array<
    string | PrismTokenLike
  >;
  for (const token of stream) {
    flattenToken(token, ["plain"], flat);
  }
  return toLines(flat);
}

/** CSS class list for a token, mirroring Prism's class-name convention. */
export function tokenClassName(types: string[]): string {
  return ["token", ...types].join(" ");
}

function flattenToken(
  token: string | PrismTokenLike,
  inherited: string[],
  out: HighlightToken[],
): void {
  if (typeof token === "string") {
    if (token.length > 0) {
      out.push({ content: token, types: inherited });
    }
    return;
  }

  const types = token.type ? [...inherited, token.type] : inherited;
  const aliases = token.alias
    ? Array.isArray(token.alias)
      ? token.alias
      : [token.alias]
    : [];
  const withAliases = aliases.length > 0 ? [...types, ...aliases] : types;

  if (typeof token.content === "string") {
    if (token.content.length > 0) {
      out.push({ content: token.content, types: withAliases });
    }
    return;
  }

  for (const child of token.content) {
    flattenToken(child, withAliases, out);
  }
}

/** One annotation target resolved by the UI against authored code. */
export interface CodeAnnotationTarget {
  /** Stable identifier persisted with discovery progress. */
  annotationId: string;
  /** 1-based line number the target text occurs on. */
  line: number;
  /** Exact text that must occur on that line. */
  text: string;
  /** 1-based occurrence of `text` on the line. Defaults to the first. */
  occurrence?: number;
}

/** A half-open character range inside one source line. */
export interface AnnotationRange {
  annotationId: string;
  start: number;
  end: number;
}

/** One syntax-highlighted fragment with its inherited token classes. */
export interface CodeTokenPart {
  content: string;
  types: string[];
}

/** One atomic fragment before adjacent annotation fragments are merged. */
export interface AtomicCodeSegment extends CodeTokenPart {
  annotationId?: string;
}

/**
 * A rendered piece of one line: either plain highlighted code, or a clickable
 * annotation that may span several Prism tokens.
 */
export type CodeLineItem =
  | ({ kind: "code" } & CodeTokenPart)
  | { kind: "annotation"; annotationId: string; parts: CodeTokenPart[] };

/**
 * Resolves annotation anchors to character ranges on one line.
 *
 * Targets are matched by text (and optional 1-based occurrence) rather than
 * absolute offsets, so authored content stays robust. A target that does not
 * resolve is skipped: server validation rejects it, and the UI must not crash
 * on stale content.
 */
export function findAnnotationRanges(
  line: string,
  targets: readonly Pick<
    CodeAnnotationTarget,
    "annotationId" | "text" | "occurrence"
  >[],
): AnnotationRange[] {
  const ranges: AnnotationRange[] = [];
  for (const target of targets) {
    const occurrence = target.occurrence ?? 1;
    if (target.text.length === 0 || occurrence < 1) {
      continue;
    }
    let start = -1;
    let searchFrom = 0;
    for (let found = 0; found < occurrence; found += 1) {
      const index = line.indexOf(target.text, searchFrom);
      if (index === -1) {
        start = -1;
        break;
      }
      start = index;
      searchFrom = index + target.text.length;
    }
    if (start >= 0) {
      ranges.push({
        annotationId: target.annotationId,
        start,
        end: start + target.text.length,
      });
    }
  }
  // Earlier ranges win overlaps; sort by start, then widest first.
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Splits one line's highlighted tokens at annotation boundaries.
 *
 * Every emitted fragment keeps the Prism token classes of the token it came
 * from, so annotated fragments look identical to the surrounding code while
 * becoming clickable. Adjacent fragments that share an annotation are merged
 * into one item whose parts preserve the original token classes.
 */
export function splitTokenLine(
  tokens: readonly HighlightToken[],
  ranges: readonly AnnotationRange[],
): CodeLineItem[] {
  const segments: AtomicCodeSegment[] = [];
  let offset = 0;
  for (const token of tokens) {
    const tokenStart = offset;
    const tokenEnd = tokenStart + token.content.length;
    offset = tokenEnd;

    const boundaries = new Set<number>([tokenStart, tokenEnd]);
    for (const range of ranges) {
      if (range.start > tokenStart && range.start < tokenEnd) {
        boundaries.add(range.start);
      }
      if (range.end > tokenStart && range.end < tokenEnd) {
        boundaries.add(range.end);
      }
    }
    const sorted = [...boundaries].sort((a, b) => a - b);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const start = sorted[index];
      const end = sorted[index + 1];
      if (end <= start) {
        continue;
      }
      const annotation = ranges.find(
        (range) => range.start <= start && start < range.end,
      );
      segments.push({
        content: token.content.slice(start - tokenStart, end - tokenStart),
        types: token.types,
        annotationId: annotation?.annotationId,
      });
    }
  }

  return mergeAnnotationSegments(segments);
}

/** Merges adjacent fragments that belong to the same annotation. */
export function mergeAnnotationSegments(
  segments: readonly AtomicCodeSegment[],
): CodeLineItem[] {
  const items: CodeLineItem[] = [];
  for (const segment of segments) {
    const last = items[items.length - 1];
    if (segment.annotationId) {
      if (
        last &&
        last.kind === "annotation" &&
        last.annotationId === segment.annotationId
      ) {
        last.parts.push({ content: segment.content, types: segment.types });
      } else {
        items.push({
          kind: "annotation",
          annotationId: segment.annotationId,
          parts: [{ content: segment.content, types: segment.types }],
        });
      }
    } else {
      items.push({ kind: "code", content: segment.content, types: segment.types });
    }
  }
  return items;
}

/**
 * Highlights `code` and folds annotations into the token stream, line by line.
 *
 * The returned structure keeps the raw source intact and copyable while
 * exposing which fragments are interactive.
 */
export function annotateCodeLines(
  code: string,
  language: string,
  annotations: readonly CodeAnnotationTarget[],
): CodeLineItem[][] {
  const lines = highlightCode(code, language);
  return lines.map((tokens, lineIndex) => {
    const lineNumber = lineIndex + 1;
    const lineTargets = annotations.filter(
      (annotation) => annotation.line === lineNumber,
    );
    if (lineTargets.length === 0) {
      return tokens.map((token) => ({
        kind: "code" as const,
        content: token.content,
        types: token.types,
      }));
    }
    const lineText = tokens.map((token) => token.content).join("");
    const ranges = findAnnotationRanges(lineText, lineTargets);
    return splitTokenLine(tokens, ranges);
  });
}

function toLines(tokens: HighlightToken[]): HighlightToken[][] {
  const lines: HighlightToken[][] = [[]];

  for (const token of tokens) {
    const segments = token.content.split("\n");
    for (let index = 0; index < segments.length; index += 1) {
      if (index > 0) {
        lines.push([]);
      }
      const segment = segments[index];
      if (segment.length > 0) {
        lines[lines.length - 1].push({
          content: segment,
          types: token.types,
        });
      }
    }
  }

  return lines;
}
