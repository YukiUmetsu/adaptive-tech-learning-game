import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { progressiveTextReveal } from "../test/progressiveTextFixture";
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

  it("renders a progressive text reveal immediately with the sentence visible", () => {
    const { container } = render(
      <KnowledgePrompt
        prompt={{
          id: "model",
          kind: "mental_model",
          label: "🧠 MENTAL MODEL",
          placeholder: "Reveal the hidden terms.",
          required: true,
          reveal: progressiveTextReveal,
        }}
        revealed={false}
        revealedElementIds={[]}
        onReveal={() => {}}
        onRevealElement={() => {}}
      />,
    );

    // No whole-prompt blank: the sentence is live from the start.
    expect(container.querySelector(".knowledge-prompt-blank")).toBeNull();
    const paragraph = container.querySelector(".progressive-text");
    expect(paragraph).not.toBeNull();
    expect(paragraph).toHaveTextContent("Security groups are");
    expect(paragraph).toHaveTextContent("while network ACLs are");
    // The hidden phrases are absent until revealed.
    expect(screen.queryByText("stateful")).toBeNull();
    expect(screen.queryByText("stateless")).toBeNull();
    expect(container.querySelectorAll(".progressive-text-reveal")).toHaveLength(
      2,
    );
  });

  it("renders a code_file immediately and keeps explanations hidden", () => {
    const { container } = render(
      <KnowledgePrompt
        prompt={{
          id: "versions",
          kind: "look_for",
          label: "🔍 LOOK FOR",
          placeholder: "Inspect this file.",
          required: true,
          reveal: {
            type: "code_file",
            filename: "versions.tf",
            language: "hcl",
            code: 'terraform {\n  required_version = "~> 1.12.0"\n}',
            line_numbers: true,
            annotations: [
              {
                id: "terraform-version",
                anchor: { line: 2, text: "required_version" },
                title: "Terraform CLI version",
                explanation: "constrains the CLI.",
                required: true,
              },
            ],
          },
        }}
        revealed={false}
        revealedElementIds={[]}
        onReveal={() => {}}
        onRevealElement={() => {}}
      />,
    );

    expect(container.querySelector(".knowledge-prompt-blank")).toBeNull();
    expect(screen.getByText("versions.tf")).toBeInTheDocument();
    expect(screen.queryByText("Terraform CLI version")).toBeNull();
  });
});
