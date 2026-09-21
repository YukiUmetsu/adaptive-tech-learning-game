import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FeedbackResponse, QuestionView } from "../api/types";
import QuestionCard from "./QuestionCard";

function base(overrides: Partial<QuestionView>): QuestionView {
  return {
    id: "q",
    domain_id: "domain-1",
    task_id: "1.1",
    prompt: "Prompt",
    interaction_type: "classification",
    assessment_mode: "application",
    difficulty_prior: 0.3,
    concepts: [],
    hints: [],
    interaction: { type: "classification", items: [], categories: [] },
    ...overrides,
  };
}

async function submit() {
  await userEvent.click(
    screen.getByRole("button", { name: "Submit answer" }),
  );
}

describe("QuestionCard", () => {
  it("submits an evidence selection payload", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "evidence_selection",
      interaction: {
        type: "evidence_selection",
        evidence: [
          { id: "cloudtrail", label: "CloudTrail event history" },
          { id: "cpu", label: "EC2 CPUUtilization" },
        ],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    await userEvent.click(
      screen.getByRole("button", { name: /CloudTrail event history/ }),
    );
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({ evidence_ids: ["cloudtrail"] });
  });

  it("submits a spot the fault payload", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "spot_the_fault",
      interaction: {
        type: "spot_the_fault",
        elements: [
          { id: "target", label: "Target internet gateway" },
          { id: "association", label: "Associated subnet" },
        ],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Target internet gateway/ }),
    );
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({ faulty_ids: ["target"] });
  });

  it("submits a multiple choice payload", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "multiple_choice",
      instruction: "Choose ONE.",
      interaction: {
        type: "multiple_choice",
        choices: [
          { id: "A", label: "First option" },
          { id: "B", label: "Second option" },
        ],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    expect(screen.getByText("Choose ONE.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Second option/ }));
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({ choice_id: "B" });
  });

  it("submits a multiple response payload", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "multiple_response",
      instruction: "Choose TWO.",
      interaction: {
        type: "multiple_response",
        choices: [
          { id: "A", label: "First option" },
          { id: "B", label: "Second option" },
          { id: "C", label: "Third option" },
        ],
        required_selections: 2,
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /First option/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Third option/ }));
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({ choice_ids: ["A", "C"] });
  });

  it("submits a fill slots payload", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "fill_slots",
      assessment_mode: "recall",
      interaction: {
        type: "fill_slots",
        slots: [{ id: "target", label: "Target" }],
        options: [{ id: "nat", label: "NAT gateway" }],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "NAT gateway" }));
    await userEvent.click(screen.getByRole("button", { name: /Target:/ }));
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({ slot_values: { target: "nat" } });
  });

  it("submits a reconstruction payload", async () => {
    const onSubmit = vi.fn();
    const question = base({
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
          { id: "cloudtrail", label: "CloudTrail" },
        ],
        slots: [{ id: "slot_1" }, { id: "slot_2" }],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);

    await userEvent.click(
      screen.getByRole("button", { name: "CloudWatch alarm" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Slot 1: empty" }));
    await userEvent.click(screen.getByRole("button", { name: "SNS topic" }));
    await userEvent.click(screen.getByRole("button", { name: "Slot 2: empty" }));
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({
      reconstruction: {
        placements: { slot_1: "alarm", slot_2: "sns" },
        edges: [],
      },
    });
  });

  it("shuffles ordering items so the authored order is not pre-filled", () => {
    const onSubmit = vi.fn();
    const items = [
      { id: "a", label: "First" },
      { id: "b", label: "Second" },
      { id: "c", label: "Third" },
      { id: "d", label: "Fourth" },
    ];
    const question = base({
      interaction_type: "ordering",
      assessment_mode: "procedural_recall",
      interaction: { type: "ordering", items },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);

    const list = screen.getByRole("list", { name: "Ordered steps" });
    const labels = Array.from(list.querySelectorAll(".ordering-label")).map(
      (element) => element.textContent,
    );

    // All items are present exactly once...
    expect([...labels].sort()).toEqual([
      "First",
      "Fourth",
      "Second",
      "Third",
    ]);
    // ...and the authored (answer) order is not shown as-is.
    expect(labels).not.toEqual(["First", "Second", "Third", "Fourth"]);
  });

  it("submits a troubleshooting choice path", async () => {
    const onSubmit = vi.fn();
    const question = base({
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
              { id: "targets", label: "Target health" },
              { id: "rds", label: "RDS metrics" },
            ],
            next_step_by_choice: {},
          },
        ],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Target health" }));
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({ choice_path: ["targets"] });
  });

  it("submits configuration assignments", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "configuration_builder",
      interaction: {
        type: "configuration_builder",
        slots: [{ id: "route", label: "Default route target" }],
        pieces: [{ id: "nat", label: "NAT gateway" }],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "NAT gateway" }));
    await userEvent.click(
      screen.getByRole("button", { name: /Default route target:/ }),
    );
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({ assignments: { route: "nat" } });
  });

  it("submits command assembly tokens", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "command_assembly",
      assessment_mode: "procedural_recall",
      interaction: {
        type: "command_assembly",
        slots: [{ id: "action", label: "Action" }],
        tokens: [{ id: "presign", label: "aws s3 presign" }],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    await userEvent.click(
      screen.getByRole("button", { name: "aws s3 presign" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Action:/ }));
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({ token_values: { action: "presign" } });
  });

  it("submits two-dimensional positions", async () => {
    const onSubmit = vi.fn();
    const question = base({
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
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    // Drag/tap the item from the palette onto the map before submitting.
    await userEvent.click(
      screen.getByRole("button", { name: "Backup and restore" }),
    );
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({
      positions: { backup: { x: 0.5, y: 0.5 } },
    });
  });

  it("keeps submitting the original classification payload", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction: {
        type: "classification",
        items: [{ id: "cpu", label: "CPU" }],
        categories: [{ id: "metric", label: "Metric" }],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "CPU" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: "Metric" })).getByRole("button", {
        name: "Place here",
      }),
    );
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({ placements: { cpu: "metric" } });
  });

  it("submits typed fill blank answers inline", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "typed_fill_blank",
      assessment_mode: "recall",
      interaction: {
        type: "typed_fill_blank",
        content: {
          type: "text",
          template:
            "Security groups are {{sg}}, while network ACLs are {{nacl}}.",
        },
        slots: [
          { id: "sg", label: "Security group behavior", placeholder: "Type..." },
          { id: "nacl", label: "NACL behavior", placeholder: "Type..." },
        ],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);

    // Submit is blocked until every blank is filled.
    const submitButton = screen.getByRole("button", { name: "Submit answer" });
    expect(submitButton).toBeDisabled();

    await userEvent.type(
      screen.getByRole("textbox", { name: "Security group behavior" }),
      "stateful",
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "NACL behavior" }),
      "stateless",
    );
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({
      typed_answers: { sg: "stateful", nacl: "stateless" },
    });
  });

  it("does not submit a typed code answer on Enter", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "typed_fill_blank",
      assessment_mode: "recall",
      interaction: {
        type: "typed_fill_blank",
        content: {
          type: "code",
          language: "python",
          template: "loss.{{method}}()",
        },
        slots: [{ id: "method", label: "Loss method", placeholder: "method" }],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Loss method" }),
      "backward{Enter}",
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Submit answer" }),
    ).toBeEnabled();
  });

  it("submits typed answers from table cells", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "typed_fill_blank",
      assessment_mode: "recall",
      interaction: {
        type: "typed_fill_blank",
        content: {
          type: "table",
          columns: [
            { id: "goal", label: "Goal" },
            { id: "api", label: "PyTorch code" },
          ],
          rows: [
            {
              id: "clear",
              cells: {
                goal: { type: "text", template: "Clear gradients" },
                api: {
                  type: "code",
                  language: "python",
                  template: "optimizer.{{zero}}()",
                },
              },
            },
          ],
        },
        slots: [{ id: "zero", label: "Clear gradients", placeholder: "method" }],
      },
    });

    render(<QuestionCard question={question} onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Clear gradients" }),
      "zero_grad",
    );
    await submit();

    expect(onSubmit).toHaveBeenCalledWith({
      typed_answers: { zero: "zero_grad" },
    });
  });

  it("shows per-blank correctness from server feedback", async () => {
    const onSubmit = vi.fn();
    const question = base({
      interaction_type: "typed_fill_blank",
      assessment_mode: "recall",
      interaction: {
        type: "typed_fill_blank",
        content: {
          type: "code",
          language: "python",
          template: "optimizer.{{zero}}()\noptimizer.{{step}}()",
        },
        slots: [
          { id: "zero", label: "Clear gradients", placeholder: "method" },
          { id: "step", label: "Update parameters", placeholder: "method" },
        ],
      },
    });

    const feedback: FeedbackResponse = {
      event_id: "e",
      question_id: "q",
      correct: false,
      score: 0.5,
      error_codes: ["typed_fill_blank_incorrect"],
      bits_preview: 0,
      explanation: "",
      canonical_answer: {
        type: "typed_fill_blank",
        answers: {
          zero: { accepted_answers: ["zero_grad"] },
          step: { accepted_answers: ["step"] },
        },
      },
      concepts: [],
    };

    const { container, rerender } = render(
      <QuestionCard question={question} onSubmit={onSubmit} />,
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "Clear gradients" }),
      "zero_grad",
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Update parameters" }),
      "backword",
    );

    // The learner's own values persist while the feedback prop arrives.
    rerender(
      <QuestionCard
        question={question}
        disabled
        feedback={feedback}
        onSubmit={onSubmit}
      />,
    );

    expect(container.querySelector(".typed-blank.correct")).not.toBeNull();
    expect(container.querySelector(".typed-blank.incorrect")).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Update parameters" })).toHaveValue(
      "backword",
    );
  });
});
