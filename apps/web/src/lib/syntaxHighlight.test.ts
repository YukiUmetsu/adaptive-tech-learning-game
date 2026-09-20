import { describe, expect, it } from "vitest";

import {
  annotateCodeLines,
  findAnnotationRanges,
  highlightCode,
  prism,
  splitTokenLine,
  tokenClassName,
  type CodeLineItem,
  type HighlightToken,
} from "./syntaxHighlight";

const tokens = (...entries: HighlightToken[]): HighlightToken[] => entries;
const token = (content: string, types: string[] = ["plain"]): HighlightToken => ({
  content,
  types,
});

function annotationItems(items: CodeLineItem[]) {
  return items.filter(
    (item): item is Extract<CodeLineItem, { kind: "annotation" }> =>
      item.kind === "annotation",
  );
}

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
      "hcl",
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

  it("highlights HCL into semantic tokens", () => {
    const lines = highlightCode(
      'terraform {\n  required_version = "~> 1.12.0"\n}',
      "hcl",
    );

    expect(lines).toHaveLength(3);
    const types = lines.flatMap((line) => line.flatMap((token) => token.types));
    expect(types.some((type) => type !== "plain")).toBe(true);
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

describe("findAnnotationRanges", () => {
  it("uses the requested occurrence of the anchor text", () => {
    const ranges = findAnnotationRanges("version = required_version", [
      { annotationId: "a", text: "version", occurrence: 2 },
    ]);

    expect(ranges).toEqual([{ annotationId: "a", start: 19, end: 26 }]);
  });

  it("defaults to the first occurrence", () => {
    const ranges = findAnnotationRanges("version = required_version", [
      { annotationId: "a", text: "version" },
    ]);

    expect(ranges).toEqual([{ annotationId: "a", start: 0, end: 7 }]);
  });

  it("skips a target that does not exist", () => {
    expect(
      findAnnotationRanges("required_version", [
        { annotationId: "a", text: "missing" },
      ]),
    ).toEqual([]);
  });

  it("skips an occurrence that is out of range", () => {
    expect(
      findAnnotationRanges("version", [
        { annotationId: "a", text: "version", occurrence: 3 },
      ]),
    ).toEqual([]);
  });
});

describe("splitTokenLine", () => {
  it("marks an annotation that occupies a whole token", () => {
    const items = splitTokenLine(tokens(token("required_version", ["plain", "attr-name"])), [
      { annotationId: "a", start: 0, end: 16 },
    ]);

    expect(items).toEqual([
      {
        kind: "annotation",
        annotationId: "a",
        parts: [{ content: "required_version", types: ["plain", "attr-name"] }],
      },
    ]);
  });

  it("marks an annotation that occupies part of a token", () => {
    const items = splitTokenLine(tokens(token("abcdef", ["string"])), [
      { annotationId: "a", start: 2, end: 4 },
    ]);

    expect(items).toEqual([
      { kind: "code", content: "ab", types: ["string"] },
      {
        kind: "annotation",
        annotationId: "a",
        parts: [{ content: "cd", types: ["string"] }],
      },
      { kind: "code", content: "ef", types: ["string"] },
    ]);
  });

  it("merges an annotation that spans several tokens while keeping classes", () => {
    const items = splitTokenLine(
      tokens(
        token("foo", ["attr-name"]),
        token(" = ", ["operator"]),
        token('"bar"', ["string"]),
      ),
      [{ annotationId: "a", start: 0, end: 11 }],
    );

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("annotation");
    if (items[0].kind === "annotation") {
      expect(items[0].parts).toEqual([
        { content: "foo", types: ["attr-name"] },
        { content: " = ", types: ["operator"] },
        { content: '"bar"', types: ["string"] },
      ]);
    }
  });

  it("supports two independent annotations on one line", () => {
    const items = splitTokenLine(tokens(token("abcdef", ["plain"])), [
      { annotationId: "a", start: 0, end: 2 },
      { annotationId: "b", start: 4, end: 6 },
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      "annotation",
      "code",
      "annotation",
    ]);
    expect(annotationItems(items).map((item) => item.annotationId)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("annotateCodeLines", () => {
  it("folds annotations into the highlighted HCL token stream", () => {
    const code = 'terraform {\n  required_version = "~> 1.12.0"\n}';
    const lines = annotateCodeLines(code, "hcl", [
      { annotationId: "terraform-version", line: 2, text: "required_version" },
    ]);

    expect(lines).toHaveLength(3);
    const annotations = annotationItems(lines[1]);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].annotationId).toBe("terraform-version");
    // The annotated text keeps Prism token classes.
    expect(
      annotations[0].parts.some((part) =>
        part.types.some((type) => type !== "plain"),
      ),
    ).toBe(true);
  });

  it("supports annotations on different lines independently", () => {
    const lines = annotateCodeLines("a = 1\nb = 2", "hcl", [
      { annotationId: "one", line: 1, text: "a" },
      { annotationId: "two", line: 2, text: "b" },
    ]);

    expect(annotationItems(lines[0]).map((item) => item.annotationId)).toEqual([
      "one",
    ]);
    expect(annotationItems(lines[1]).map((item) => item.annotationId)).toEqual([
      "two",
    ]);
  });

  it("still annotates when the language is unknown", () => {
    const lines = annotateCodeLines("x = 1", "not-a-language", [
      { annotationId: "a", line: 1, text: "x" },
    ]);

    const annotations = annotationItems(lines[0]);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].parts).toEqual([{ content: "x", types: ["plain"] }]);
  });

  it("ignores an annotation whose target does not exist", () => {
    const lines = annotateCodeLines("x = 1", "hcl", [
      { annotationId: "a", line: 1, text: "missing" },
    ]);

    expect(annotationItems(lines[0])).toHaveLength(0);
  });
});
