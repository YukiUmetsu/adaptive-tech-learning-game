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
