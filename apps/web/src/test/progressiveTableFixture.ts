import type { LearningDomainResponse } from "../api/types";
import type { LearningTableReveal } from "../lib/learningElements";

const sourceRef = { title: "Official test guide", url: "https://example.com/guide" };

/** Row-mode table: the service column is given; each row is a reveal unit. */
export const rowTableReveal: LearningTableReveal = {
  type: "table",
  columns: [
    { id: "service", label: "Service" },
    { id: "purpose", label: "Best for" },
    { id: "evidence", label: "What it tells you" },
  ],
  rows: [
    {
      id: "cloudwatch",
      cells: {
        service: "CloudWatch",
        purpose: "Operational monitoring",
        evidence: "Metrics, logs, alarms",
      },
    },
    {
      id: "cloudtrail",
      cells: {
        service: "CloudTrail",
        purpose: "API auditing",
        evidence: "Who performed which AWS API action",
      },
    },
  ],
  progressive_reveal: {
    mode: "row",
    initially_visible: { column_ids: ["service"], row_ids: [], cell_ids: [] },
  },
};

/** Column-mode table: two columns are given; each remaining column is a unit. */
export const columnTableReveal: LearningTableReveal = {
  type: "table",
  columns: [
    { id: "control", label: "Control" },
    { id: "stateful", label: "Stateful?" },
    { id: "rules", label: "Rules" },
    { id: "scope", label: "Scope" },
  ],
  rows: [
    {
      id: "sg",
      cells: {
        control: "Security group",
        stateful: "Yes",
        rules: "Allow rules only",
        scope: "ENI / resource",
      },
    },
    {
      id: "nacl",
      cells: {
        control: "Network ACL",
        stateful: "No",
        rules: "Allow and deny rules",
        scope: "Subnet",
      },
    },
  ],
  progressive_reveal: {
    mode: "column",
    initially_visible: {
      column_ids: ["control", "scope"],
      row_ids: [],
      cell_ids: [],
    },
  },
};

/** Cell-mode table: policy column plus one explicit cell are given. */
export const cellTableReveal: LearningTableReveal = {
  type: "table",
  columns: [
    { id: "policy", label: "Routing policy" },
    { id: "basis", label: "Selection basis" },
    { id: "health", label: "Health checks" },
    { id: "use", label: "Typical use" },
  ],
  rows: [
    {
      id: "weighted",
      cells: {
        policy: "Weighted",
        basis: "Configured weights",
        health: "Supported",
        use: "Traffic splitting",
      },
    },
    {
      id: "latency",
      cells: {
        policy: "Latency",
        basis: "Lowest AWS network latency",
        health: "Supported",
        use: "Multi-Region performance",
      },
    },
  ],
  progressive_reveal: {
    mode: "cell",
    initially_visible: {
      column_ids: ["policy"],
      row_ids: [],
      cell_ids: ["weighted:use"],
    },
  },
};

/**
 * One learning domain exercising all three progressive table modes.
 *
 * Each node has a single required prompt, so node completion equals prompt
 * completion: every non-given reveal unit must be explored.
 */
export const progressiveTableFixture: LearningDomainResponse = {
  schema_version: "1.0.0",
  content_version: "test-progressive-v1",
  certification_id: "test-cert",
  certification_version: "v1",
  exam_guide_revision: "1.0",
  domain: { id: "domain-progressive", name: "Progressive Domain", weight: 1 },
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
      title: "Tables",
      order: 1,
      task_ids: [],
      skill_ids: [],
      prerequisite_module_ids: [],
      nodes: [
        {
          id: "n-row",
          title: "Row reveal",
          concept_ids: ["test.progressive"],
          prerequisite_node_ids: [],
          map_position: { x: 0.2, y: 0.3 },
          prompts: [
            {
              id: "rows",
              kind: "mental_model",
              label: "🧠 MENTAL MODEL",
              placeholder: "Reveal each service.",
              required: true,
              reveal: rowTableReveal,
            },
          ],
        },
        {
          id: "n-column",
          title: "Column reveal",
          concept_ids: ["test.progressive"],
          prerequisite_node_ids: ["n-row"],
          map_position: { x: 0.5, y: 0.3 },
          prompts: [
            {
              id: "cols",
              kind: "mental_model",
              label: "🧠 MENTAL MODEL",
              placeholder: "Reveal each control attribute.",
              required: true,
              reveal: columnTableReveal,
            },
          ],
        },
        {
          id: "n-cell",
          title: "Cell reveal",
          concept_ids: ["test.progressive"],
          prerequisite_node_ids: ["n-column"],
          map_position: { x: 0.8, y: 0.3 },
          prompts: [
            {
              id: "cells",
              kind: "mental_model",
              label: "🧠 MENTAL MODEL",
              placeholder: "Reveal each routing policy detail.",
              required: true,
              reveal: cellTableReveal,
            },
          ],
        },
      ],
    },
  ],
};
