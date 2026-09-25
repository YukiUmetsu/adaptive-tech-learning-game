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

describe("focus widget CSS", () => {
  it("reveals the panel from widget state, not raw CSS hover", () => {
    expect(css).toContain(".focus-widget--open .focus-widget-panel");
    expect(css).toContain(".focus-widget--reduced .focus-widget-panel");
    // The fragile pointer-only hover rule must not come back.
    expect(css).not.toContain(".focus-widget:hover .focus-widget-panel");
  });
});

describe("mobile learning table cards", () => {
  it("stacks the column label above its value on very narrow phones", () => {
    const narrow = css.slice(css.lastIndexOf("@media (max-width: 420px)"));
    expect(narrow).toContain(".learning-table td:not(:first-child)::before");
    expect(narrow).toContain(".learning-table-value");
    expect(narrow).toContain("display: block");
  });
});

describe("mobile node detail sheet CSS", () => {
  it("pins the node panel and its action above the tab bar on phones", () => {
    expect(css).toContain(".track-hub-side .node-panel");
    expect(css).toContain(".track-hub-side .node-panel-explore");
    expect(css).toContain("node-sheet-in");
  });
});

describe("mobile layout guards", () => {
  it("clears the fixed tab bar for practice-test controls", () => {
    expect(css).toContain(
      ".practice-test-footer {\n    bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px) + 0.75rem);",
    );
    expect(css).toContain(
      ".practice-test-confirm {\n    bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px) + 1rem);",
    );
  });

  it("keeps typed answers at 1rem so iOS does not zoom on focus", () => {
    expect(css).toMatch(
      /\.typed-code \.typed-blank-input,[\s\S]*?\.typed-blank-textarea \{\s*font-size: 1rem;/,
    );
  });

  it("gives small controls a 44px touch-target floor", () => {
    expect(css).toContain(".settings-link {\n    width: 2.75rem;");
    expect(css).toContain(".reconstruction-handle::before {");
  });

  it("does not trap page scroll on the reconstruction map", () => {
    expect(css).toMatch(/\.reconstruction-map \{[\s\S]*?touch-action: pan-y;/);
  });

  it("caps the focus panel so it stays on screen", () => {
    expect(css).toMatch(/\.focus-widget-panel \{[\s\S]*?max-height: min\(70dvh/);
  });
});
