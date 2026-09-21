import type { LearningDomainResponse } from "../api/types";

/** The Terraform example used across the code-file tests, line for line. */
export const TERRAFORM_CODE = [
  "terraform {",
  '  required_version = "~> 1.12.0"',
  "",
  "  required_providers {",
  "    aws = {",
  '      source  = "hashicorp/aws"',
  '      version = "~> 5.80"',
  "    }",
  "  }",
  "}",
].join("\n");

const sourceRef = { title: "Official test guide", url: "https://example.com/guide" };

/**
 * A small learning domain exercising table and code-file reveals.
 *
 * `n-code` is completed by its required code annotations, `n-read` has a file
 * with no annotations (explicit mark-as-reviewed), and `n-table` uses a real
 * table reveal.
 */
export const codeLearningFixture: LearningDomainResponse = {
  schema_version: "1.0.0",
  content_version: "test-code-v1",
  certification_id: "test-cert",
  certification_version: "v1",
  exam_guide_revision: "1.0",
  domain: { id: "domain-code", name: "Code Domain", weight: 1 },
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
      title: "Files",
      order: 1,
      task_ids: [],
      skill_ids: [],
      prerequisite_module_ids: [],
      nodes: [
        {
          id: "n-code",
          title: "Terraform versions",
          concept_ids: ["test.terraform"],
          prerequisite_node_ids: [],
          map_position: { x: 0.2, y: 0.3 },
          prompts: [
            {
              id: "versions",
              kind: "look_for",
              label: "🔍 LOOK FOR",
              placeholder:
                "Inspect this file. What does each highlighted part control?",
              required: true,
              reveal: {
                type: "code_file",
                filename: "versions.tf",
                language: "hcl",
                code: TERRAFORM_CODE,
                line_numbers: true,
                annotations: [
                  {
                    id: "terraform-version",
                    anchor: { line: 2, text: "required_version" },
                    title: "Terraform CLI version",
                    explanation:
                      "required_version constrains the Terraform CLI, not the provider.",
                    required: true,
                  },
                  {
                    id: "provider-source",
                    anchor: { line: 6, text: "source" },
                    title: "Provider source address",
                    explanation: "This tells Terraform where the plugin comes from.",
                    required: true,
                  },
                  {
                    id: "provider-version",
                    anchor: { line: 7, text: "version" },
                    title: "Provider version constraint",
                    explanation: "This constrains the provider plugin version.",
                    required: false,
                  },
                ],
              },
            },
          ],
        },
        {
          id: "n-read",
          title: "Read the module file",
          concept_ids: ["test.terraform"],
          prerequisite_node_ids: ["n-code"],
          map_position: { x: 0.6, y: 0.3 },
          prompts: [
            {
              id: "main",
              kind: "what",
              label: "❓ WHAT?",
              placeholder: "Skim this file to see the provider requirement.",
              required: true,
              reveal: {
                type: "code_file",
                filename: "main.tf",
                language: "hcl",
                code: 'provider "aws" {\n  region = "us-east-1"\n}',
                line_numbers: false,
                annotations: [],
              },
            },
          ],
        },
      ],
    },
    {
      id: "m2",
      title: "Constraints",
      order: 2,
      task_ids: [],
      skill_ids: [],
      prerequisite_module_ids: ["m1"],
      nodes: [
        {
          id: "n-table",
          title: "Version constraints",
          concept_ids: ["test.terraform"],
          prerequisite_node_ids: [],
          map_position: { x: 0.4, y: 0.6 },
          prompts: [
            {
              id: "constraints",
              kind: "mental_model",
              label: "🧠 MENTAL MODEL",
              placeholder: "Match each constraint to what it allows.",
              required: true,
              reveal: {
                type: "table",
                columns: [
                  { id: "constraint", label: "Constraint" },
                  { id: "allows", label: "Allows" },
                  { id: "rejects", label: "Rejects" },
                  { id: "meaning", label: "Meaning" },
                ],
                rows: [
                  {
                    cells: {
                      constraint: "~> 1.2.3",
                      allows: "1.2.9",
                      rejects: "1.3.0",
                      meaning: "Patch updates within 1.2",
                    },
                  },
                  {
                    cells: {
                      constraint: "= 1.2.3",
                      allows: "1.2.3",
                      rejects: "1.2.4",
                      meaning: "Exact version",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};
