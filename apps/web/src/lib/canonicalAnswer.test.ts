import { describe, expect, it } from "vitest";

import type { Interaction } from "../api/types";
import { formatCanonicalAnswer, labelIndex } from "./canonicalAnswer";

const interaction = {
  type: "classification",
  items: [
    { id: "metric_cpu", label: "CPU utilization" },
    { id: "log_api", label: "API call record" },
  ],
  categories: [
    { id: "metric", label: "Metric" },
    { id: "log", label: "Log" },
  ],
} as unknown as Interaction;

describe("labelIndex", () => {
  it("collects id/label pairs recursively", () => {
    const labels = labelIndex(interaction);
    expect(labels.metric_cpu).toBe("CPU utilization");
    expect(labels.log).toBe("Log");
  });
});

describe("formatCanonicalAnswer", () => {
  it("renders a classification answer with labels", () => {
    const lines = formatCanonicalAnswer(
      { type: "classification", placements: { metric_cpu: "metric" } },
      labelIndex(interaction),
    );
    expect(lines).toEqual([{ label: "CPU utilization", value: "Metric" }]);
  });

  it("falls back to raw ids when no label is known", () => {
    const lines = formatCanonicalAnswer(
      { type: "ordering", ordered_ids: ["unknown"] },
      {},
    );
    expect(lines).toEqual([{ label: "1", value: "unknown" }]);
  });

  it("renders typed fill blanks with accepted answers", () => {
    const lines = formatCanonicalAnswer(
      {
        type: "typed_fill_blank",
        answers: { policy_result: { accepted_answers: ["Deny", "deny"] } },
      },
      {},
    );
    expect(lines).toEqual([{ label: "policy_result", value: "Deny / deny" }]);
  });

  it("orders a command assembly by the authored slot order, not map order", () => {
    const commandInteraction = {
      type: "command_assembly",
      slots: [
        { id: "service", label: "Service" },
        { id: "operation", label: "Operation" },
        { id: "state_filter", label: "State filter" },
        { id: "state_value", label: "State value" },
      ],
      tokens: [
        { id: "cloudwatch", label: "cloudwatch" },
        { id: "describe", label: "describe-alarms" },
        { id: "flag", label: "--state-value" },
        { id: "alarm", label: "ALARM" },
      ],
    } as unknown as Interaction;

    const lines = formatCanonicalAnswer(
      {
        type: "command_assembly",
        // Deliberately not in command order.
        values: {
          state_value: "alarm",
          service: "cloudwatch",
          operation: "describe",
          state_filter: "flag",
        },
      },
      labelIndex(commandInteraction),
      commandInteraction,
    );

    expect(lines).toEqual([
      { label: "Service", value: "cloudwatch" },
      { label: "Operation", value: "describe-alarms" },
      { label: "State filter", value: "--state-value" },
      { label: "State value", value: "ALARM" },
    ]);
  });
});
