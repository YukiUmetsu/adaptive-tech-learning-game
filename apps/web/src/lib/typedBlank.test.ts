import { describe, expect, it } from "vitest";

import {
  normalizeTypedAnswer,
  parseTypedText,
  typedAnswerMatches,
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
