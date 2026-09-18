import { describe, expect, it } from "vitest";

import type { CanonicalAnswer, QuestionView } from "../api/types";
import { reviewDetails } from "./feedback";

const base: QuestionView = {
  id: "q",
  domain_id: "domain-1",
  task_id: "1.1",
  prompt: "Prompt",
  interaction_type: "classification",
  assessment_mode: "recognition",
  difficulty_prior: 0.2,
  concepts: [],
  hints: [],
  interaction: {
    type: "classification",
    items: [
      { id: "cpu", label: "CPU" },
      { id: "api", label: "API call" },
    ],
    categories: [
      { id: "metric", label: "Metric" },
      { id: "log", label: "Log" },
    ],
  },
};

describe("reviewDetails", () => {
  it("returns nothing when the answer is correct", () => {
    const canonical: CanonicalAnswer = {
      type: "classification",
      placements: { cpu: "metric", api: "log" },
    };

    expect(
      reviewDetails(base, { placements: { cpu: "metric", api: "log" } }, canonical),
    ).toEqual([]);
  });

  it("names misplaced classification items", () => {
    const canonical: CanonicalAnswer = {
      type: "classification",
      placements: { cpu: "metric", api: "log" },
    };

    const details = reviewDetails(
      base,
      { placements: { cpu: "log", api: "log" } },
      canonical,
    );

    expect(details).toHaveLength(1);
    expect(details[0].kind).toBe("wrong");
    expect(details[0].text).toContain("CPU");
    expect(details[0].text).toContain("Metric");
  });

  it("names wrong ordering positions", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "ordering",
      interaction: {
        type: "ordering",
        items: [
          { id: "a", label: "First" },
          { id: "b", label: "Second" },
        ],
      },
    };

    const details = reviewDetails(
      question,
      { ordered_ids: ["b", "a"] },
      { type: "ordering", ordered_ids: ["a", "b"] },
    );

    expect(details.map((detail) => detail.text)).toEqual([
      "Position 1: “Second” should be “First”",
      "Position 2: “First” should be “Second”",
    ]);
  });

  it("distinguishes missing and invalid connections", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "node_connection",
      assessment_mode: "relationship_recall",
      interaction: {
        type: "node_connection",
        nodes: [
          { id: "alarm", label: "CloudWatch alarm", x: 0, y: 0 },
          { id: "sns", label: "SNS topic", x: 1, y: 0 },
          { id: "operator", label: "Operator", x: 1, y: 1 },
        ],
      },
    };

    const details = reviewDetails(
      question,
      { edges: [["sns", "operator"]] },
      { type: "node_connection", edges: [["alarm", "sns"]] },
    );

    expect(details).toEqual([
      {
        kind: "missing",
        text: "Missing connection: CloudWatch alarm → SNS topic",
      },
      {
        kind: "invalid",
        text: "Not a valid connection: SNS topic → Operator",
      },
    ]);
  });

  it("describes reconstruction slot mistakes", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "reconstruction",
      assessment_mode: "structural_reconstruction",
      interaction: {
        type: "reconstruction",
        layout: "linear",
        fixed_nodes: [
          {
            id: "metric",
            label: "Metric crosses threshold",
            position: "start",
          },
        ],
        pieces: [
          { id: "alarm", label: "CloudWatch alarm" },
          { id: "sns", label: "SNS topic" },
          { id: "operator", label: "Operator notification" },
          { id: "cloudtrail", label: "CloudTrail" },
        ],
        slots: [
          { id: "slot_1" },
          { id: "slot_2" },
          { id: "slot_3" },
        ],
      },
    };

    const details = reviewDetails(
      question,
      {
        reconstruction: {
          placements: { slot_1: "alarm", slot_2: "cloudtrail" },
          edges: [],
        },
      },
      {
        type: "reconstruction",
        placements: {
          slot_1: "alarm",
          slot_2: "sns",
          slot_3: "operator",
        },
        edges: [],
      },
    );

    expect(details).toEqual([
      {
        kind: "invalid",
        text: "Step 2: “CloudTrail” is not part of the structure",
      },
      { kind: "missing", text: "Step 3: “Operator notification”" },
      { kind: "missing", text: "Missing component: SNS topic" },
      { kind: "missing", text: "Missing component: Operator notification" },
    ]);
  });

  it("describes missing graph relationships", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "reconstruction",
      assessment_mode: "structural_reconstruction",
      interaction: {
        type: "reconstruction",
        layout: "graph",
        fixed_nodes: [
          { id: "alarm", label: "CloudWatch alarm", position: "start" },
        ],
        pieces: [
          { id: "sns", label: "SNS topic" },
          { id: "operator", label: "Operator notification" },
          { id: "eventbridge", label: "EventBridge rule" },
        ],
        slots: [
          { id: "sns_slot", x: 0.25, y: 0.3 },
          { id: "operator_slot", x: 0.25, y: 0.8 },
          { id: "eventbridge_slot", x: 0.75, y: 0.3 },
        ],
      },
    };

    const details = reviewDetails(
      question,
      {
        reconstruction: {
          // Graph slot identity is not meaningful: these two pieces are swapped
          // between slots but all required components are present.
          placements: {
            sns_slot: "sns",
            operator_slot: "eventbridge",
            eventbridge_slot: "operator",
          },
          edges: [["alarm", "sns"]],
        },
      },
      {
        type: "reconstruction",
        placements: {
          sns_slot: "sns",
          operator_slot: "operator",
          eventbridge_slot: "eventbridge",
        },
        edges: [
          ["alarm", "sns"],
          ["sns", "operator"],
          ["alarm", "eventbridge"],
        ],
      },
    );

    expect(details).toEqual([
      {
        kind: "missing",
        text: "Missing relationship: SNS topic → Operator notification",
      },
      {
        kind: "missing",
        text: "Missing relationship: CloudWatch alarm → EventBridge rule",
      },
    ]);
  });

  it("lists missed and irrelevant evidence", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "evidence_selection",
      interaction: {
        type: "evidence_selection",
        evidence: [
          { id: "cloudtrail", label: "CloudTrail event history" },
          { id: "cpu", label: "EC2 CPUUtilization" },
        ],
      },
    };

    const details = reviewDetails(
      question,
      { evidence_ids: ["cpu"] },
      { type: "evidence_selection", relevant_ids: ["cloudtrail"] },
    );

    expect(details).toEqual([
      { kind: "missing", text: "Missing evidence: CloudTrail event history" },
      { kind: "invalid", text: "Not relevant here: EC2 CPUUtilization" },
    ]);
  });

  it("lists missed and false-positive faults", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "spot_the_fault",
      interaction: {
        type: "spot_the_fault",
        elements: [
          { id: "target", label: "Target internet gateway" },
          { id: "association", label: "Associated subnet" },
        ],
      },
    };

    const details = reviewDetails(
      question,
      { faulty_ids: ["association"] },
      { type: "spot_the_fault", faulty_ids: ["target"] },
    );

    expect(details).toEqual([
      { kind: "missing", text: "Fault missed: Target internet gateway" },
      { kind: "invalid", text: "Not faulty: Associated subnet" },
    ]);
  });

  it("lists wrong and empty fill slots", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "fill_slots",
      assessment_mode: "recall",
      interaction: {
        type: "fill_slots",
        slots: [
          { id: "destination", label: "Destination" },
          { id: "target", label: "Target" },
        ],
        options: [
          { id: "all_ipv4", label: "0.0.0.0/0" },
          { id: "nat", label: "NAT gateway" },
        ],
      },
    };

    const details = reviewDetails(
      question,
      { slot_values: { destination: "nat" } },
      { type: "fill_slots", values: { destination: "all_ipv4", target: "nat" } },
    );

    expect(details).toEqual([
      {
        kind: "wrong",
        text: "Destination — “NAT gateway”, should be “0.0.0.0/0”",
      },
      { kind: "missing", text: "Target — “empty”, should be “NAT gateway”" },
    ]);
  });

  it("describes branching decisions against the expected path", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "troubleshooting",
      interaction: {
        type: "troubleshooting",
        start_step_id: "start",
        steps: [
          {
            id: "start",
            prompt: "What do you inspect first?",
            stage: "diagnosis",
            choices: [
              { id: "a", label: "Target health" },
              { id: "b", label: "RDS metrics" },
            ],
            next_step_by_choice: { a: "next", b: "next" },
          },
          {
            id: "next",
            prompt: "What next?",
            stage: "remediation",
            choices: [{ id: "c", label: "Fix the health path" }],
            next_step_by_choice: {},
          },
        ],
      },
    };

    const details = reviewDetails(
      question,
      { choice_path: ["b"] },
      {
        type: "troubleshooting",
        correct_choice_ids: { start: ["a"], next: ["c"] },
        expected_path: ["a", "c"],
      },
    );

    expect(details).toEqual([
      {
        kind: "wrong",
        text: "Decision 1: “RDS metrics” should be “Target health”",
      },
      {
        kind: "missing",
        text: "Missing decision 2: “Fix the health path”",
      },
    ]);
  });

  it("describes configuration role assignments", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "configuration_builder",
      interaction: {
        type: "configuration_builder",
        slots: [
          { id: "route", label: "Default route target" },
          { id: "subnet", label: "Host subnet" },
        ],
        pieces: [
          { id: "nat", label: "NAT gateway" },
          { id: "igw", label: "Internet gateway" },
        ],
      },
    };

    const details = reviewDetails(
      question,
      { assignments: { route: "igw" } },
      { type: "configuration_builder", assignments: { route: "nat", subnet: "nat" } },
    );

    expect(details).toEqual([
      {
        kind: "wrong",
        text: "Default route target — “Internet gateway”, should be “NAT gateway”",
      },
      { kind: "missing", text: "Host subnet — “empty”, should be “NAT gateway”" },
    ]);
  });

  it("flags items outside their placement region", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "two_dimensional_placement",
      interaction: {
        type: "two_dimensional_placement",
        x_axis: {
          id: "cost",
          label: "Cost",
          low_label: "Lower",
          high_label: "Higher",
        },
        y_axis: {
          id: "recovery",
          label: "Recovery",
          low_label: "Slower",
          high_label: "Faster",
        },
        items: [{ id: "backup", label: "Backup and restore" }],
      },
    };

    const details = reviewDetails(
      question,
      { positions: { backup: { x: 0.9, y: 0.9 } } },
      {
        type: "two_dimensional_placement",
        regions: { backup: { x: [0, 0.3], y: [0, 0.3] } },
      },
    );

    expect(details).toEqual([
      { kind: "wrong", text: "Backup and restore — check its position on Cost" },
      {
        kind: "wrong",
        text: "Backup and restore — check its position on Recovery",
      },
    ]);
  });

  it("describes command assembly tokens", () => {
    const question: QuestionView = {
      ...base,
      interaction_type: "command_assembly",
      interaction: {
        type: "command_assembly",
        slots: [{ id: "action", label: "Action" }],
        tokens: [
          { id: "presign", label: "aws s3 presign" },
          { id: "delete", label: "aws s3 rm" },
        ],
      },
    };

    const details = reviewDetails(
      question,
      { token_values: { action: "delete" } },
      { type: "command_assembly", values: { action: "presign" } },
    );

    expect(details).toEqual([
      {
        kind: "wrong",
        text: "Action — “aws s3 rm”, should be “aws s3 presign”",
      },
    ]);
  });
});
