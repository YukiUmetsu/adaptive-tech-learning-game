import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FeedbackResponse, QuestionView } from "../api/types";
import FeedbackPanel from "./FeedbackPanel";

const question: QuestionView = {
  id: "q1",
  prompt: "Classify the signals.",
  interaction_type: "classification",
  assessment_mode: "recognition",
  difficulty_prior: 0.2,
  concepts: [],
  hints: [],
  interaction: {
    type: "classification",
    items: [{ id: "a", label: "Item A" }],
    categories: [{ id: "x", label: "Category X" }],
  },
};

const base: FeedbackResponse = {
  event_id: "event",
  question_id: "q1",
  correct: false,
  score: 0.5,
  error_codes: ["classification_misplaced"],
  explanation: "Metrics are numeric time series.",
  canonical_answer: { type: "classification", placements: { a: "x" } },
  concepts: [],
};

describe("FeedbackPanel", () => {
  it("shows explanatory feedback and a retry path for an incorrect attempt", () => {
    render(
      <FeedbackPanel
        feedback={base}
        question={question}
        submitted={null}
        isLast={false}
        onRetry={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(screen.getByText("Not quite")).toBeInTheDocument();
    expect(
      screen.getByText("Metrics are numeric time series."),
    ).toBeInTheDocument();
    expect(screen.getByText("classification misplaced")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next question" }),
    ).toBeInTheDocument();
  });

  it("does not offer retry after a correct attempt", () => {
    render(
      <FeedbackPanel
        feedback={{ ...base, correct: true, score: 1, error_codes: [] }}
        question={question}
        submitted={null}
        isLast
        onRetry={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(screen.getByText("Correct")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Finish mission" }),
    ).toBeInTheDocument();
  });

  it("names missing and invalid connections", () => {
    const connectionQuestion: QuestionView = {
      ...question,
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

    render(
      <FeedbackPanel
        feedback={{
          ...base,
          canonical_answer: {
            type: "node_connection",
            edges: [["alarm", "sns"]],
          },
        }}
        question={connectionQuestion}
        submitted={{ edges: [["sns", "operator"]] }}
        isLast={false}
        onRetry={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Missing connection: CloudWatch alarm → SNS topic"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not a valid connection: SNS topic → Operator"),
    ).toBeInTheDocument();
  });
});
