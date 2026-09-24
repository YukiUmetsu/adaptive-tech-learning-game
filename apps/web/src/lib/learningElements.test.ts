import { describe, expect, it } from "vitest";

import { deriveProgressiveText, elementId } from "./learningElements";
import {
  optionalProgressiveTextReveal,
  progressiveTextReveal,
} from "../test/progressiveTextFixture";

describe("elementId.span", () => {
  it("namespaces a span id without touching the other element namespaces", () => {
    expect(elementId.span("sg-state")).toBe("span:sg-state");
    expect(elementId.annotation("a1")).toBe("annotation:a1");
    expect(elementId.row("r1")).toBe("row:r1");
    expect(elementId.column("c1")).toBe("column:c1");
    expect(elementId.cell("r1", "c1")).toBe("cell:r1:c1");
  });
});

describe("deriveProgressiveText", () => {
  it("keeps the sentence and replaces only the authored spans", () => {
    const segments = deriveProgressiveText(progressiveTextReveal);

    expect(segments.map((segment) => segment.kind)).toEqual([
      "text",
      "span",
      "text",
      "span",
      "text",
    ]);
    expect(segments[1]).toMatchObject({
      kind: "span",
      spanId: "sg-state",
      text: "stateful",
      required: true,
    });
    expect(segments[3]).toMatchObject({
      kind: "span",
      spanId: "nacl-state",
      text: "stateless",
      required: true,
    });
    // Reassembling every piece reproduces the original sentence exactly.
    expect(segments.map((segment) => segment.text).join("")).toBe(
      progressiveTextReveal.text,
    );
  });

  it("supports a multi-word phrase as one span", () => {
    const segments = deriveProgressiveText(optionalProgressiveTextReveal);
    const span = segments.find((segment) => segment.kind === "span");

    expect(span?.text).toBe("outbound internet access");
    expect(span?.required).toBe(false);
  });

  it("resolves repeated text by the authored occurrence", () => {
    const segments = deriveProgressiveText({
      type: "text",
      text: "the cat sat on the mat",
      progressive_reveal: {
        spans: [{ id: "second-the", text: "the", occurrence: 2 }],
      },
    });

    // The hidden span is the second `the`, immediately before `mat`.
    expect(segments).toEqual([
      { kind: "text", text: "the cat sat on " },
      {
        kind: "span",
        text: "the",
        spanId: "second-the",
        required: true,
      },
      { kind: "text", text: " mat" },
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "the cat sat on the mat",
    );
  });

  it("falls back to plain prose when configuration is absent", () => {
    const segments = deriveProgressiveText({
      type: "text",
      text: "Records AWS API activity.",
    });

    expect(segments).toEqual([{ kind: "text", text: "Records AWS API activity." }]);
  });
});
