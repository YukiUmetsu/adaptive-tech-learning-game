import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LearningDomainResponse } from "../api/types";
import { deriveLearningState, emptyDomainProgress } from "../state/learningProgress";
import KnowledgeMap from "./KnowledgeMap";

/**
 * One module with a node whose completion comes from two different rules: a
 * code file completed by annotations and a text prompt revealed directly.
 */
const domain: LearningDomainResponse = {
  schema_version: "1.0.0",
  content_version: "test-v1",
  certification_id: "test-cert",
  certification_version: "v1",
  exam_guide_revision: "1.0",
  domain: { id: "d1", name: "Domain", weight: 1 },
  learning_design: {
    progress_label: "Discovery Progress",
    unlock_rule: "All required prompts.",
    mastery_note: "Not mastery.",
  },
  source_refs: [{ title: "Guide", url: "https://example.com" }],
  glossary: [],
  modules: [
    {
      id: "m1",
      title: "Module",
      order: 1,
      task_ids: [],
      skill_ids: [],
      prerequisite_module_ids: [],
      nodes: [
        {
          id: "n1",
          title: "Mixed node",
          concept_ids: ["test.x"],
          prerequisite_node_ids: [],
          map_position: { x: 0.5, y: 0.5 },
          prompts: [
            {
              id: "versions",
              kind: "look_for",
              label: "LOOK FOR",
              placeholder: "",
              required: true,
              reveal: {
                type: "code_file",
                filename: "versions.tf",
                language: "hcl",
                code: 'terraform {\n  required_version = "~> 1.12.0"\n}',
                line_numbers: true,
                annotations: [
                  {
                    id: "annotation-a",
                    anchor: { line: 2, text: "required_version" },
                    title: "A",
                    explanation: "a",
                    required: true,
                  },
                ],
              },
            },
            {
              id: "what",
              kind: "what",
              label: "WHAT",
              placeholder: "",
              required: true,
              reveal: { type: "text", text: "An IaC tool." },
            },
          ],
        },
      ],
    },
  ],
};

describe("KnowledgeMap node progress", () => {
  it("shows full progress for a node unlocked by mixed completion rules", () => {
    const state = deriveLearningState(domain, {
      ...emptyDomainProgress("v1", "d1", "test-v1"),
      revealedPromptIds: { n1: ["what"] },
      revealedElementIds: { n1: { versions: ["annotation:annotation-a"] } },
    });

    render(
      <KnowledgeMap
        domain={domain}
        module={domain.modules[0]}
        state={state}
        justUnlockedNodeId={null}
        onSelectNode={() => {}}
      />,
    );

    expect(state.nodeState.n1).toBe("unlocked");
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.queryByText("1/2")).toBeNull();
  });

  it("shows partial progress while the node is still in progress", () => {
    const state = deriveLearningState(domain, {
      ...emptyDomainProgress("v1", "d1", "test-v1"),
      revealedPromptIds: { n1: ["what"] },
    });

    render(
      <KnowledgeMap
        domain={domain}
        module={domain.modules[0]}
        state={state}
        justUnlockedNodeId={null}
        onSelectNode={() => {}}
      />,
    );

    expect(state.nodeState.n1).toBe("in_progress");
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });
});
