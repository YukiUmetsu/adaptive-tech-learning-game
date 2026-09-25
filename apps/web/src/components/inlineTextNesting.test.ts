import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `InlineText` renders glossary terms as a `<button>`. A `<button>` (or the
 * label of a form control) must never contain another button, so call sites
 * inside interactive controls pass `terms={[]}` to render plain text. This
 * guard scans component sources so a new nesting regression is caught without
 * having to render every interaction.
 */
interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  raw: string;
  index: number;
}

function scanTags(src: string): Tag[] {
  const tags: Tag[] = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      break;
    }
    let j = lt + 1;
    let closing = false;
    if (src[j] === "/") {
      closing = true;
      j += 1;
    }
    if (!/[A-Za-z]/.test(src[j] ?? "")) {
      i = lt + 1;
      continue;
    }
    const nameStart = j;
    while (j < src.length && /[A-Za-z0-9._$-]/.test(src[j] ?? "")) {
      j += 1;
    }
    const name = src.slice(nameStart, j);

    // Walk attributes to the matching ">", honoring quotes and {...} so a
    // "=>" inside a handler never ends the tag early.
    let brace = 0;
    let quote: string | null = null;
    let selfClosing = false;
    let end = -1;
    for (; j < src.length; j += 1) {
      const ch = src[j];
      if (quote) {
        if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") {
        brace += 1;
        continue;
      }
      if (ch === "}") {
        if (brace > 0) {
          brace -= 1;
        }
        continue;
      }
      if (ch === ">" && brace === 0) {
        selfClosing = src[j - 1] === "/";
        end = j;
        break;
      }
    }
    if (end === -1) {
      break;
    }
    tags.push({ name, closing, selfClosing, raw: src.slice(lt, end + 1), index: lt });
    i = end + 1;
  }
  return tags;
}

function nestedInlineTextLines(src: string): number[] {
  const stack: string[] = [];
  const lines: number[] = [];
  for (const tag of scanTags(src)) {
    const name = tag.name.toLowerCase();
    if (name === "inlinetext") {
      const insideControl = stack.some((t) => t === "button" || t === "label");
      if (insideControl && !/\bterms\s*=/.test(tag.raw)) {
        lines.push(src.slice(0, tag.index).split("\n").length);
      }
      if (!tag.selfClosing) {
        stack.push(name);
      }
      continue;
    }
    if (tag.closing) {
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k] === name) {
          stack.length = k;
          break;
        }
      }
    } else if (!tag.selfClosing) {
      stack.push(name);
    }
  }
  return lines;
}

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsx(path, out);
    } else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      out.push(path);
    }
  }
  return out;
}

describe("InlineText glossary nesting", () => {
  it("never renders a glossary-term button inside another control", () => {
    const root = resolve(process.cwd(), "src");
    const offenders: string[] = [];
    for (const file of collectTsx(root)) {
      for (const line of nestedInlineTextLines(readFileSync(file, "utf8"))) {
        offenders.push(`${file.slice(root.length + 1)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
