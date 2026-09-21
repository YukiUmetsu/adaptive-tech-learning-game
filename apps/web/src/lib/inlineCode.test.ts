import { describe, expect, it } from "vitest";

import { parseInlineCode, parseRichText, stripInlineCode } from "./inlineCode";

describe("parseInlineCode", () => {
  it("returns plain text unchanged", () => {
    expect(parseInlineCode("No code here")).toEqual([
      { text: "No code here", code: false },
    ]);
  });

  it("marks a single backtick span as code", () => {
    expect(parseInlineCode("Use `mem_used_percent` now")).toEqual([
      { text: "Use ", code: false },
      { text: "mem_used_percent", code: true },
      { text: " now", code: false },
    ]);
  });

  it("handles several spans", () => {
    expect(parseInlineCode("`a` and `b`")).toEqual([
      { text: "a", code: true },
      { text: " and ", code: false },
      { text: "b", code: true },
    ]);
  });

  it("keeps an unmatched backtick as literal text", () => {
    expect(parseInlineCode("broken `span")).toEqual([
      { text: "broken `span", code: false },
    ]);
  });

  it("ignores an empty span", () => {
    expect(parseInlineCode("a``b")).toEqual([
      { text: "a", code: false },
      { text: "b", code: false },
    ]);
  });
});

describe("stripInlineCode", () => {
  it("removes every backtick", () => {
    expect(stripInlineCode("Use `a` and `b`.")).toBe("Use a and b.");
  });
});

describe("parseRichText glossary terms", () => {
  const terms = [{ term: "guest memory", definition: "RAM inside the guest OS." }];

  it("marks glossary terms in plain text", () => {
    expect(parseRichText("Check guest memory now", terms)).toEqual([
      { kind: "text", text: "Check " },
      {
        kind: "term",
        text: "guest memory",
        definition: "RAM inside the guest OS.",
      },
      { kind: "text", text: " now" },
    ]);
  });

  it("matches case-insensitively", () => {
    expect(parseRichText("Guest Memory matters", terms)).toEqual([
      {
        kind: "term",
        text: "Guest Memory",
        definition: "RAM inside the guest OS.",
      },
      { kind: "text", text: " matters" },
    ]);
  });

  it("never matches inside a code span", () => {
    expect(parseRichText("`guest memory`", terms)).toEqual([
      { kind: "code", text: "guest memory" },
    ]);
  });

  it("respects word boundaries", () => {
    expect(parseRichText("category", [{ term: "cat", definition: "feline" }])).toEqual(
      [{ kind: "text", text: "category" }],
    );
  });

  it("prefers the longest matching term", () => {
    const overlapping = [
      { term: "memory", definition: "short" },
      { term: "guest memory", definition: "long" },
    ];
    expect(parseRichText("guest memory", overlapping)).toEqual([
      { kind: "term", text: "guest memory", definition: "long" },
    ]);
  });

  it("returns plain text when there is no glossary", () => {
    expect(parseRichText("plain text", [])).toEqual([
      { kind: "text", text: "plain text" },
    ]);
  });
});
