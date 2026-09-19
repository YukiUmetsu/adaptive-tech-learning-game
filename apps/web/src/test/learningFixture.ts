import type { LearningDomainResponse } from "../api/types";

/**
 * A small, deliberately vendor-neutral learning domain used by tests.
 *
 * Two modules with a module prerequisite and a node prerequisite. Nothing here
 * is AWS-specific, which proves the map renderer is driven by content shape
 * rather than hard-coded service names.
 */
export const learningFixture: LearningDomainResponse = {
  schema_version: "1.0.0",
  content_version: "test-content-v1",
  certification_id: "test-cert",
  certification_version: "v1",
  exam_guide_revision: "1.0",
  domain: { id: "domain-1", name: "Test Domain", weight: 1 },
  learning_design: {
    progress_label: "Discovery Progress",
    unlock_rule: "A knowledge node unlocks after all required prompts are revealed.",
    mastery_note: "Exploration progress is not mastery evidence.",
  },
  source_refs: [{ title: "Official test guide", url: "https://example.com/guide" }],
  modules: [
    {
      id: "m1",
      title: "Foundations",
      order: 1,
      task_ids: ["1.1"],
      skill_ids: ["1.1.1"],
      prerequisite_module_ids: [],
      nodes: [
        {
          id: "n1",
          title: "Alpha",
          concept_ids: ["test.alpha"],
          prerequisite_node_ids: [],
          map_position: { x: 0.1, y: 0.2 },
          prompts: [
            {
              id: "what",
              kind: "what",
              label: "❓ WHAT?",
              placeholder: "Alpha is __________",
              required: true,
              reveal: { type: "text", text: "Alpha records activity." },
            },
            {
              id: "look",
              kind: "look_for",
              label: "🔍 LOOK FOR",
              placeholder: "Look for __________",
              required: true,
              reveal: { type: "keywords", items: ["who changed it", "API call"] },
            },
          ],
          source_refs: [{ title: "Alpha docs", url: "https://example.com/alpha" }],
        },
        {
          id: "n2",
          title: "Beta",
          concept_ids: ["test.beta"],
          prerequisite_node_ids: ["n1"],
          map_position: { x: 0.6, y: 0.2 },
          prompts: [
            {
              id: "sequence",
              kind: "connects_to",
              label: "🔗 CONNECTS TO?",
              placeholder: "Alpha → __________",
              required: true,
              reveal: { type: "sequence", items: ["Alpha", "Beta", "Gamma"] },
            },
          ],
        },
      ],
    },
    {
      id: "m2",
      title: "Advanced",
      order: 2,
      task_ids: ["1.2"],
      skill_ids: ["1.2.1"],
      prerequisite_module_ids: ["m1"],
      nodes: [
        {
          id: "n3",
          title: "Gamma",
          concept_ids: ["test.gamma"],
          prerequisite_node_ids: [],
          map_position: { x: 0.3, y: 0.5 },
          prompts: [
            {
              id: "compare",
              kind: "mental_model",
              label: "🧠 MENTAL MODEL",
              placeholder: "Beta versus Gamma",
              required: true,
              reveal: {
                type: "comparison",
                columns: [
                  { title: "Beta", items: ["first"] },
                  { title: "Gamma", items: ["second"] },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};
