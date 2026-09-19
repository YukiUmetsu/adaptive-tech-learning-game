import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import KnowledgePrompt from "./KnowledgePrompt";

const comparisonReveal = {
  type: "comparison" as const,
  columns: [
    { title: "CloudTrail", items: ["API/audit activity"] },
    { title: "CloudWatch", items: ["metrics, logs, alarms"] },
  ],
};

describe("KnowledgePrompt", () => {
  it("renders a pipe placeholder as aligned column cells", () => {
    const { container } = render(
      <KnowledgePrompt
        prompt={{
          id: "not",
          kind: "not_this",
          label: "🚫 NOT THIS",
          placeholder: "CloudTrail: API/audit activity | CloudWatch: __________",
          required: true,
          reveal: comparisonReveal,
        }}
        revealed={false}
        onReveal={() => {}}
      />,
    );

    const blank = container.querySelector(".knowledge-prompt-blank");
    expect(blank).toHaveClass("knowledge-prompt-blank--columns");
    expect(container.querySelectorAll(".knowledge-prompt-blank-cell")).toHaveLength(2);
    expect(container.querySelector(".comparison-grid")).toHaveClass(
      "comparison-grid--cols-2",
    );
  });

  it("renders many columns with the wrapping grid", () => {
    const segments = Array.from(
      { length: 6 },
      (_, index) => `Option ${index + 1}: __________`,
    ).join(" | ");

    const { container } = render(
      <KnowledgePrompt
        prompt={{
          id: "not",
          kind: "not_this",
          label: "🚫 NOT THIS",
          placeholder: segments,
          required: true,
          reveal: {
            type: "comparison",
            columns: Array.from({ length: 6 }, (_, index) => ({
              title: `Option ${index + 1}`,
              items: ["value"],
            })),
          },
        }}
        revealed={false}
        onReveal={() => {}}
      />,
    );

    expect(container.querySelectorAll(".knowledge-prompt-blank-cell")).toHaveLength(6);
    expect(container.querySelector(".comparison-grid")).toHaveClass(
      "comparison-grid--cols-many",
    );
  });

  it("leaves a plain placeholder as ordinary text", () => {
    const { container } = render(
      <KnowledgePrompt
        prompt={{
          id: "what",
          kind: "what",
          label: "❓ WHAT?",
          placeholder: "CloudTrail is __________",
          required: true,
          reveal: { type: "text", text: "Records AWS API activity." },
        }}
        revealed={false}
        onReveal={() => {}}
      />,
    );

    expect(container.querySelector(".knowledge-prompt-blank--columns")).toBeNull();
    expect(container.querySelectorAll(".knowledge-prompt-blank-cell")).toHaveLength(0);
  });
});
