import { describe, expect, it } from "vitest";

import {
  buildSentinelCode,
  normalizeLanguage,
  normalizeTypedAnswer,
  parseTypedText,
  splitSentinels,
  typedAnswerMatches,
  typedBlankStatuses,
} from "./typedBlank";

describe("parseTypedText", () => {
  it("splits a single placeholder into text and slot segments", () => {
    expect(
      parseTypedText("An explicit {{result}} overrides an Allow."),
    ).toEqual([
      { kind: "text", text: "An explicit " },
      { kind: "slot", slotId: "result" },
      { kind: "text", text: " overrides an Allow." },
    ]);
  });

  it("keeps multiple placeholders in sentence order", () => {
    const segments = parseTypedText(
      "Security groups are {{sg}}, while network ACLs are {{nacl}}.",
    );

    expect(segments).toEqual([
      { kind: "text", text: "Security groups are " },
      { kind: "slot", slotId: "sg" },
      { kind: "text", text: ", while network ACLs are " },
      { kind: "slot", slotId: "nacl" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves malformed placeholders as literal text", () => {
    expect(parseTypedText("Broken {{slot text")).toEqual([
      { kind: "text", text: "Broken {{slot text" },
    ]);
  });
});

describe("normalizeTypedAnswer", () => {
  it("trims, lowercases, collapses whitespace, and drops trailing punctuation", () => {
    expect(normalizeTypedAnswer("  Deny ")).toBe("deny");
    expect(normalizeTypedAnswer("DENY")).toBe("deny");
    expect(normalizeTypedAnswer("deny.")).toBe("deny");
    expect(normalizeTypedAnswer("deny?!")).toBe("deny");
    expect(normalizeTypedAnswer("deny  .")).toBe("deny");
    expect(normalizeTypedAnswer("amazon   simple queue service")).toBe(
      "amazon simple queue service",
    );
    expect(normalizeTypedAnswer("   ")).toBe("");
  });
});

describe("typedAnswerMatches", () => {
  it("matches authored aliases after normalization", () => {
    const accepted = ["SQS", "Amazon SQS", "Amazon Simple Queue Service"];

    expect(typedAnswerMatches(" amazon   sqs. ", accepted)).toBe(true);
    expect(typedAnswerMatches("Amazon Simple Queue Service", accepted)).toBe(
      true,
    );
  });

  it("does not fuzzy-match similar service names", () => {
    expect(typedAnswerMatches("SNS", ["SQS", "Amazon SQS"])).toBe(false);
    expect(typedAnswerMatches("NLB", ["ALB"])).toBe(false);
  });

  it("does not match an empty answer", () => {
    expect(typedAnswerMatches("   ", ["deny"])).toBe(false);
  });
});

describe("buildSentinelCode", () => {
  it("replaces each placeholder with a unique sentinel and maps it back", () => {
    const { code, slotsBySentinel } = buildSentinelCode(
      "optimizer.{{zero}}()\nloss.{{backward}}()",
    );

    expect(code).not.toContain("{{");
    expect(code).toContain("__TYPED_FILL_SLOT_0__");
    expect(code).toContain("__TYPED_FILL_SLOT_1__");
    expect([...slotsBySentinel.values()]).toEqual(["zero", "backward"]);
  });

  it("splits a token around an embedded sentinel", () => {
    const { slotsBySentinel } = buildSentinelCode("optimizer.{{zero}}()");
    const parts = splitSentinels("optimizer.__TYPED_FILL_SLOT_0__", slotsBySentinel);

    expect(parts).toEqual([
      { kind: "text", text: "optimizer." },
      { kind: "slot", slotId: "zero" },
    ]);
  });

  it("keeps text-only content intact", () => {
    const { slotsBySentinel } = buildSentinelCode("plain text");
    expect(splitSentinels("plain text", slotsBySentinel)).toEqual([
      { kind: "text", text: "plain text" },
    ]);
  });
});

describe("normalizeLanguage", () => {
  it("maps common aliases to engine language ids", () => {
    expect(normalizeLanguage("Python")).toBe("python");
    expect(normalizeLanguage("py")).toBe("python");
    expect(normalizeLanguage("sh")).toBe("bash");
    expect(normalizeLanguage("yml")).toBe("yaml");
    expect(normalizeLanguage("TS")).toBe("typescript");
    expect(normalizeLanguage("rust")).toBe("rust");
  });
});

describe("typedBlankStatuses", () => {
  const slots = [
    { id: "zero", label: "Clear gradients", placeholder: "method" },
    { id: "step", label: "Update parameters", placeholder: "method" },
  ];

  it("returns nothing before submission", () => {
    expect(typedBlankStatuses(slots, { zero: "zero_grad" }, null)).toEqual({});
  });

  it("marks each blank from the canonical feedback", () => {
    const statuses = typedBlankStatuses(
      slots,
      { zero: " zero_grad ", step: "backword" },
      {
        event_id: "e",
        question_id: "q",
        correct: false,
        score: 0.5,
        error_codes: ["typed_fill_blank_incorrect"],
        bits_preview: 0,
        explanation: "",
        canonical_answer: {
          type: "typed_fill_blank",
          answers: {
            zero: { accepted_answers: ["zero_grad"] },
            step: { accepted_answers: ["step"] },
          },
        },
        concepts: [],
      },
    );

    expect(statuses).toEqual({ zero: "correct", step: "incorrect" });
  });
});
