import { describe, expect, it } from "vitest";

import type { CanonicalAnswer, QuestionView } from "../api/types";
import { reviewDetails } from "./feedback";

const base: QuestionView = {
  id: "q",
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
});
