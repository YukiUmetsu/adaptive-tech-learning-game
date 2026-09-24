import type { LearningDomainResponse } from "../api/types";
import type { LearningTextReveal } from "../lib/learningElements";

const sourceRef = { title: "Official test guide", url: "https://example.com/guide" };

/** The canonical two-span sentence from the feature request. */
export const progressiveTextReveal: LearningTextReveal = {
  type: "text",
  text: "Security groups are stateful, while network ACLs are stateless.",
  progressive_reveal: {
    spans: [
      { id: "sg-state", text: "stateful", required: true },
      { id: "nacl-state", text: "stateless", required: true },
    ],
  },
};

/** A multi-word span whose reveal is optional. */
export const optionalProgressiveTextReveal: LearningTextReveal = {
  type: "text",
  text: "A NAT gateway commonly provides outbound internet access for private IPv4 workloads.",
  progressive_reveal: {
    spans: [
      {
        id: "nat-out",
        text: "outbound internet access",
        required: false,
      },
    ],
  },
};

/**
 * One learning domain with a single progressive-text node.
 *
 * The node has one required prompt, so node completion equals prompt completion:
 * both required spans must be revealed.
 */
export const progressiveTextFixture: LearningDomainResponse = {
  schema_version: "1.0.0",
  content_version: "test-text-v1",
  certification_id: "test-cert",
  certification_version: "v1",
  exam_guide_revision: "1.0",
  domain: { id: "domain-text", name: "Progressive Text", weight: 1 },
  learning_design: {
    progress_label: "Discovery Progress",
    unlock_rule: "A node unlocks after all required prompts are completed.",
    mastery_note: "Exploration progress is not mastery evidence.",
  },
  source_refs: [sourceRef],
  glossary: [],
  modules: [
    {
      id: "m1",
      title: "Discoveries",
      order: 1,
      task_ids: [],
      skill_ids: [],
      prerequisite_module_ids: [],
      nodes: [
        {
          id: "n-text",
          title: "Stateful vs stateless",
          concept_ids: ["test.progressive.text"],
          prerequisite_node_ids: [],
          map_position: { x: 0.4, y: 0.4 },
          prompts: [
            {
              id: "sentence",
              kind: "mental_model",
              label: "🧠 MENTAL MODEL",
              placeholder: "Reveal the hidden terms.",
              required: true,
              reveal: progressiveTextReveal,
            },
          ],
        },
      ],
    },
  ],
};
