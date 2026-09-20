import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the learning readability rule: primary learning content is at least
 * 1rem (with headings and chips slightly smaller), while only secondary
 * metadata stays small.
 */
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function fontSizeOf(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) {
    throw new Error(`selector not found: ${selector}`);
  }
  const size = match[1].match(/font-size:\s*([\d.]+)rem/);
  if (!size) {
    throw new Error(`no rem font-size on ${selector}`);
  }
  return Number.parseFloat(size[1]);
}

describe("learning CSS readability", () => {
  it.each([
    [".knowledge-prompt-context", 1],
    [".learning-table", 1],
    [".learning-code", 1],
    [".code-annotation-explanation p", 1],
    [".reveal-comparison-column ul", 1],
    [".knowledge-prompt-blank-cell", 1],
    [".learning-table-reveal-label", 1],
  ])("%s is at least 1rem", (selector, minimum) => {
    expect(fontSizeOf(selector)).toBeGreaterThanOrEqual(minimum);
  });

  it.each([
    [".learning-table th", 0.9],
    [".code-annotation-explanation h4", 0.95],
    [".reveal-comparison-column h4", 0.95],
    [".reveal-chip", 0.95],
  ])("%s stays legible (>= %s rem)", (selector, minimum) => {
    expect(fontSizeOf(selector)).toBeGreaterThanOrEqual(minimum);
  });

  it("keeps only metadata small", () => {
    expect(fontSizeOf(".knowledge-card-kicker")).toBeLessThanOrEqual(0.8);
    expect(fontSizeOf(".learning-code-file-bar")).toBeLessThanOrEqual(0.8);
  });
});
