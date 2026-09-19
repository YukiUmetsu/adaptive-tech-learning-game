import { describe, expect, it } from "vitest";

import { highlightCode, prism, tokenClassName } from "./syntaxHighlight";

describe("syntaxHighlight", () => {
  it("registers the languages the app highlights", () => {
    expect(prism).toBeTruthy();
    for (const language of [
      "python",
      "rust",
      "bash",
      "json",
      "yaml",
      "javascript",
      "typescript",
      "sql",
    ]) {
      expect(prism?.languages?.[language]).toBeTruthy();
    }
  });

  it("tokenizes Python into semantic token types per line", () => {
    const lines = highlightCode("def step(optimizer):\n    return optimizer", "python");

    expect(lines).toHaveLength(2);
    const firstLineTypes = lines[0].flatMap((token) => token.types);
    expect(firstLineTypes).toContain("keyword");
    expect(lines[1][0].content.startsWith("    ")).toBe(true);
  });

  it("falls back to plain tokens for an unknown language", () => {
    const lines = highlightCode("x = 1\ny = 2", "not-a-language");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([{ content: "x = 1", types: ["plain"] }]);
  });

  it("builds a Prism-style class list", () => {
    expect(tokenClassName(["plain", "keyword"])).toBe("token plain keyword");
  });
});
