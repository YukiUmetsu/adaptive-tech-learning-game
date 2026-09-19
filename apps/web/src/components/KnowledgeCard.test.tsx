import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { KnowledgeNode } from "../api/types";
import KnowledgeCard from "./KnowledgeCard";

const node: KnowledgeNode = {
  id: "n-code",
  title: "Terraform versions",
  concept_ids: ["test.terraform"],
  prerequisite_node_ids: [],
  map_position: { x: 0.5, y: 0.5 },
  prompts: [
    {
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
            id: "required-a",
            anchor: { line: 2, text: "required_version" },
            title: "A",
            explanation: "a",
            required: true,
          },
          {
            id: "required-b",
            anchor: { line: 1, text: "terraform" },
            title: "B",
            explanation: "b",
            required: true,
          },
          {
            id: "optional-c",
            anchor: { line: 3, text: "}" },
            title: "C",
            explanation: "c",
            required: false,
          },
        ],
      },
    },
    {
      id: "what",
      kind: "what",
      label: "❓ WHAT?",
      placeholder: "Terraform is __________",
      required: true,
      reveal: { type: "text", text: "An IaC tool." },
    },
  ],
};

function renderCard(revealedAnnotationIds: Record<string, string[]>) {
  return render(
    <KnowledgeCard
      node={node}
      moduleTitle="Foundations"
      state="in_progress"
      revealedPromptIds={["what"]}
      revealedAnnotationIds={revealedAnnotationIds}
      nextNode={null}
      reducedMotion
      onReveal={() => {}}
      onRevealAnnotation={() => {}}
      onClose={() => {}}
      onDiscoverNext={() => {}}
    />,
  );
}

describe("KnowledgeCard charge", () => {
  it("does not count a code file until its required annotations are revealed", () => {
    renderCard({ versions: ["required-a"] });

    expect(
      screen.getByLabelText("1 of 2 prompts revealed"),
    ).toBeInTheDocument();
  });

  it("counts the code file once every required annotation is revealed", () => {
    renderCard({ versions: ["required-a", "required-b"] });

    expect(
      screen.getByLabelText("2 of 2 prompts revealed"),
    ).toBeInTheDocument();
  });

  it("ignores optional annotations when counting completion", () => {
    renderCard({ versions: ["optional-c"] });

    expect(
      screen.getByLabelText("1 of 2 prompts revealed"),
    ).toBeInTheDocument();
  });
});
