import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  TypedBlankSlot,
  TypedFillContent,
} from "../api/types";
import type { TypedBlankStatus } from "../lib/typedBlank";
import TypedBlankInput from "./TypedBlankInput";
import TypedFillBlankInteraction from "./TypedFillBlankInteraction";

const textSlots: TypedBlankSlot[] = [
  {
    id: "sg_behavior",
    label: "Security group behavior",
    placeholder: "Type...",
  },
  {
    id: "nacl_behavior",
    label: "Network ACL behavior",
    placeholder: "Type...",
  },
];

const codeSlots: TypedBlankSlot[] = [
  { id: "zero", label: "Clear gradients", placeholder: "method" },
  { id: "step", label: "Update parameters", placeholder: "method" },
];

const tableSlots: TypedBlankSlot[] = [
  { id: "zero", label: "Clear gradients", placeholder: "method" },
  { id: "backward", label: "Backward method", placeholder: "method" },
  { id: "step", label: "Optimizer step", placeholder: "method" },
];

/** Joins a code line's children, marking each blank in place. */
function lineLayout(line: Element): string {
  const parts: string[] = [];
  let buffer = "";

  for (const child of Array.from(line.children)) {
    if (child.classList.contains("typed-blank")) {
      if (buffer.length > 0) {
        parts.push(buffer);
        buffer = "";
      }
      parts.push("[blank]");
    } else {
      buffer += child.textContent ?? "";
    }
  }

  if (buffer.length > 0) {
    parts.push(buffer);
  }
  return parts.join("");
}

function lines(): Element[] {
  return Array.from(document.querySelectorAll(".typed-code .token-line"));
}

describe("TypedFillBlankInteraction — text", () => {
  const content: TypedFillContent = {
    type: "text",
    template:
      "Security groups are {{sg_behavior}}, while network ACLs are {{nacl_behavior}}.",
  };

  it("renders the sentence with one inline input per slot", () => {
    render(
      <TypedFillBlankInteraction
        content={content}
        slots={textSlots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByText(/Security groups are/)).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(
      screen.getByRole("textbox", { name: "Security group behavior" }),
    ).toBeInTheDocument();
  });

  it("keeps the learner's text after submission", () => {
    render(
      <TypedFillBlankInteraction
        content={{ type: "text", template: "An explicit {{result}}." }}
        slots={[{ id: "result", label: "Result", placeholder: "Type..." }]}
        value={{ result: "Deny" }}
        disabled
        onChange={() => undefined}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Result" });
    expect(input).toHaveValue("Deny");
    expect(input).toBeDisabled();
  });
});

describe("TypedFillBlankInteraction — code", () => {
  const content: TypedFillContent = {
    type: "code",
    language: "python",
    template: "optimizer.{{zero}}()\nloss.backward()\noptimizer.{{step}}()",
  };

  it("renders highlighted code, not markdown fences", () => {
    const { container } = render(
      <TypedFillBlankInteraction
        content={content}
        slots={codeSlots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    const pre = container.querySelector("pre.typed-code");
    expect(pre).not.toBeNull();
    expect(pre?.querySelector("code")).not.toBeNull();
    expect(container.textContent).not.toContain("```");
    // Semantic highlighting structure, not exact colors.
    expect(container.querySelectorAll(".typed-code .token").length).toBeGreaterThan(0);
  });

  it("preserves newlines and indentation", () => {
    render(
      <TypedFillBlankInteraction
        content={{
          type: "code",
          language: "python",
          template: "def step(optimizer):\n    optimizer.{{zero}}()",
        }}
        slots={[{ id: "zero", label: "Clear gradients", placeholder: "method" }]}
        value={{}}
        onChange={() => undefined}
      />,
    );

    const rendered = lines();
    expect(rendered).toHaveLength(2);
    expect(rendered[1].textContent?.startsWith("    ")).toBe(true);
    // Python keywords are tokenized as keywords.
    expect(document.querySelector(".typed-code .token.keyword")).not.toBeNull();
  });

  it("places the blank between the surrounding code on its line", () => {
    render(
      <TypedFillBlankInteraction
        content={content}
        slots={codeSlots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(lineLayout(lines()[0])).toBe("optimizer.[blank]()");
    expect(lineLayout(lines()[1])).toBe("loss.backward()");
    expect(lineLayout(lines()[2])).toBe("optimizer.[blank]()");
  });

  it("supports multiple blanks with independent values", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<Record<string, string>>({
        step: "step",
      });
      return (
        <TypedFillBlankInteraction
          content={content}
          slots={codeSlots}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);

    const zero = screen.getByRole("textbox", { name: "Clear gradients" });
    const step = screen.getByRole("textbox", { name: "Update parameters" });
    expect(zero).toHaveValue("");
    expect(step).toHaveValue("step");

    await user.type(zero, "zero_grad");
    expect(zero).toHaveValue("zero_grad");
    expect(step).toHaveValue("step");
  });

  it("tabs through blanks in source order", async () => {
    const user = userEvent.setup();
    render(
      <TypedFillBlankInteraction
        content={content}
        slots={codeSlots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    await user.tab();
    expect(screen.getByRole("textbox", { name: "Clear gradients" })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("textbox", { name: "Update parameters" }),
    ).toHaveFocus();
  });

  it("renders correct and incorrect status without relying on color alone", () => {
    const statuses: Record<string, TypedBlankStatus> = {
      zero: "correct",
      step: "incorrect",
    };
    const { container } = render(
      <TypedFillBlankInteraction
        content={content}
        slots={codeSlots}
        value={{ zero: "zero_grad", step: "backword" }}
        disabled
        statuses={statuses}
        onChange={() => undefined}
      />,
    );

    expect(container.querySelector(".typed-blank.correct")).not.toBeNull();
    expect(container.querySelector(".typed-blank.incorrect")).not.toBeNull();
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.getByText("✕")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Update parameters" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("scrolls long code inside the code surface", () => {
    const { container } = render(
      <TypedFillBlankInteraction
        content={{
          type: "code",
          language: "python",
          template:
            "very_long_result = some.module.and_function_call(argument_one, argument_two, {{value}})",
        }}
        slots={[{ id: "value", label: "Value", placeholder: "value" }]}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(container.querySelector("pre.typed-code")).not.toBeNull();
  });

  it("falls back to plain code for an unknown language", () => {
    const { container } = render(
      <TypedFillBlankInteraction
        content={{
          type: "code",
          language: "not-a-language",
          template: "x = {{value}}",
        }}
        slots={[{ id: "value", label: "Value", placeholder: "value" }]}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(container.querySelector("pre.typed-code")).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Value" })).toBeInTheDocument();
  });

  it("keeps literal closing braces in code while rendering the blank", () => {
    render(
      <TypedFillBlankInteraction
        content={{
          type: "code",
          language: "python",
          template: 'd = {"a": {"b": {{value}}}}',
        }}
        slots={[{ id: "value", label: "Value", placeholder: "value" }]}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Value" })).toBeInTheDocument();
    expect(lineLayout(lines()[0])).toBe('d = {"a": {"b": [blank]}}');
  });

  it("renders an authored multiline blank inside highlighted code", () => {
    const { container } = render(
      <TypedFillBlankInteraction
        content={{
          type: "code",
          language: "python",
          template: "{{training_step}}",
        }}
        slots={[
          {
            id: "training_step",
            label: "Training step",
            placeholder: "Type the training code...",
            width_chars: 55,
            multiline: true,
            rows: 4,
          },
        ]}
        value={{}}
        onChange={() => undefined}
      />,
    );

    const field = screen.getByRole("textbox", { name: "Training step" });
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("rows", "4");
    // The surrounding code surface is preserved.
    expect(container.querySelector("pre.typed-code")).not.toBeNull();
  });

  it("submits multiline values through the same typed_answers payload", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const answer = "optimizer.zero_grad()\nloss.backward()\noptimizer.step()";

    function Harness() {
      const [value, setValue] = useState<Record<string, string>>({});
      return (
        <TypedFillBlankInteraction
          content={{
            type: "code",
            language: "python",
            template: "{{training_step}}",
          }}
          slots={[
            {
              id: "training_step",
              label: "Training step",
              placeholder: "code",
              multiline: true,
              rows: 4,
            },
          ]}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getByRole("textbox", { name: "Training step" }));
    await user.paste(answer);

    expect(onChange).toHaveBeenLastCalledWith({ training_step: answer });
  });
});

describe("TypedFillBlankInteraction — table", () => {
  const content: TypedFillContent = {
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
      {
        id: "backward",
        cells: {
          goal: { type: "text", template: "Backpropagate the loss" },
          api: {
            type: "code",
            language: "python",
            template: "loss.{{backward}}()",
          },
        },
      },
      {
        id: "step",
        cells: {
          goal: { type: "text", template: "Update parameters" },
          api: {
            type: "code",
            language: "python",
            template: "optimizer.{{step}}()",
          },
        },
      },
    ],
  };

  it("renders real table semantics with headers in order", () => {
    render(
      <TypedFillBlankInteraction
        content={content}
        slots={tableSlots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Goal",
      "PyTorch code",
    ]);

    const bodyRows = within(screen.getByRole("table")).getAllByRole("row");
    // One header row plus three data rows.
    expect(bodyRows).toHaveLength(4);
  });

  it("renders rows in authored order with code cells using the code renderer", () => {
    const { container } = render(
      <TypedFillBlankInteraction
        content={content}
        slots={tableSlots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    const goalCells = Array.from(
      container.querySelectorAll("tbody tr td:first-child"),
    ).map((cell) => cell.textContent);
    expect(goalCells).toEqual([
      "Clear gradients",
      "Backpropagate the loss",
      "Update parameters",
    ]);

    // Code cells reuse the shared highlighted renderer.
    const codeCells = container.querySelectorAll("tbody td pre.typed-code");
    expect(codeCells).toHaveLength(3);
    expect(
      container.querySelectorAll("tbody pre.typed-code .token").length,
    ).toBeGreaterThan(0);
  });

  it("places each input inside the intended cell", () => {
    const { container } = render(
      <TypedFillBlankInteraction
        content={content}
        slots={tableSlots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    const firstApiCell = container.querySelector(
      "tbody tr:first-child td:nth-child(2)",
    );
    expect(firstApiCell).not.toBeNull();
    expect(
      within(firstApiCell as HTMLElement).getByRole("textbox", {
        name: "Clear gradients",
      }),
    ).toBeInTheDocument();
  });

  it("supports several independent blanks across the table", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState<Record<string, string>>({});
      return (
        <TypedFillBlankInteraction
          content={content}
          slots={tableSlots}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);

    await user.type(
      screen.getByRole("textbox", { name: "Backward method" }),
      "backward",
    );
    expect(
      screen.getByRole("textbox", { name: "Backward method" }),
    ).toHaveValue("backward");
    expect(screen.getByRole("textbox", { name: "Clear gradients" })).toHaveValue(
      "",
    );
    expect(screen.getByRole("textbox", { name: "Optimizer step" })).toHaveValue(
      "",
    );
  });

  it("tabs through table blanks in row-major order", async () => {
    const user = userEvent.setup();
    render(
      <TypedFillBlankInteraction
        content={content}
        slots={tableSlots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    await user.tab();
    expect(screen.getByRole("textbox", { name: "Clear gradients" })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("textbox", { name: "Backward method" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Optimizer step" })).toHaveFocus();
  });

  it("wraps the table for narrow screens", () => {
    const { container } = render(
      <TypedFillBlankInteraction
        content={content}
        slots={tableSlots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(container.querySelector(".typed-fill-table-wrap")).not.toBeNull();
  });
});

describe("TypedBlankInput", () => {
  it("announces correctness to assistive technology", () => {
    render(
      <TypedBlankInput
        slot={{ id: "x", label: "Method", placeholder: "method" }}
        value="backward"
        disabled
        status="correct"
        onChange={() => undefined}
      />,
    );

    expect(screen.getByText("Method is correct")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Method" })).toHaveAttribute(
      "size",
      "9",
    );
  });

  it("caps how wide the input grows", () => {
    render(
      <TypedBlankInput
        slot={{ id: "x", label: "Method", placeholder: "method" }}
        value={"a".repeat(200)}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Method" })).toHaveAttribute(
      "size",
      "24",
    );
  });

  it("renders a single-line input when no presentation hints are authored", () => {
    render(
      <TypedBlankInput
        slot={{ id: "x", label: "Method", placeholder: "method" }}
        value=""
        onChange={() => undefined}
      />,
    );

    const field = screen.getByRole("textbox", { name: "Method" });
    expect(field.tagName).toBe("INPUT");
    expect(field).toHaveAttribute("type", "text");
    // Historical default minimum width.
    expect(field).toHaveAttribute("size", "6");
  });

  it("starts wider when width_chars is authored", () => {
    render(
      <TypedBlankInput
        slot={{
          id: "x",
          label: "Expression",
          placeholder: "expression",
          width_chars: 36,
        }}
        value=""
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveAttribute(
      "size",
      "36",
    );
  });

  it("still grows past an authored width as the learner types", () => {
    const { rerender } = render(
      <TypedBlankInput
        slot={{
          id: "x",
          label: "Expression",
          placeholder: "expression",
          width_chars: 12,
        }}
        value=""
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveAttribute(
      "size",
      "12",
    );

    rerender(
      <TypedBlankInput
        slot={{
          id: "x",
          label: "Expression",
          placeholder: "expression",
          width_chars: 12,
        }}
        value={"a".repeat(20)}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveAttribute(
      "size",
      "21",
    );
  });

  it("renders a textarea when multiline is authored", () => {
    render(
      <TypedBlankInput
        slot={{
          id: "x",
          label: "Training step",
          placeholder: "code",
          multiline: true,
        }}
        value=""
        onChange={() => undefined}
      />,
    );

    const field = screen.getByRole("textbox", { name: "Training step" });
    expect(field.tagName).toBe("TEXTAREA");
    // A sensible default row count when rows is omitted.
    expect(field).toHaveAttribute("rows", "3");
  });

  it("uses authored rows for a multiline blank", () => {
    render(
      <TypedBlankInput
        slot={{
          id: "x",
          label: "Training step",
          placeholder: "code",
          width_chars: 55,
          multiline: true,
          rows: 4,
        }}
        value=""
        onChange={() => undefined}
      />,
    );

    const field = screen.getByRole("textbox", { name: "Training step" });
    expect(field).toHaveAttribute("rows", "4");
    expect(field).toHaveAttribute("cols", "55");
  });

  it("keeps the correct/incorrect treatment on a multiline blank", () => {
    render(
      <TypedBlankInput
        slot={{
          id: "x",
          label: "Training step",
          placeholder: "code",
          multiline: true,
          rows: 3,
        }}
        value="optimizer.step()"
        disabled
        status="incorrect"
        onChange={() => undefined}
      />,
    );

    const field = screen.getByRole("textbox", { name: "Training step" });
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Training step is incorrect")).toBeInTheDocument();
    expect(screen.getByText("✕")).toBeInTheDocument();
  });

  it("disables a multiline blank", () => {
    render(
      <TypedBlankInput
        slot={{
          id: "x",
          label: "Training step",
          placeholder: "code",
          multiline: true,
        }}
        value="optimizer.step()"
        disabled
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Training step" })).toBeDisabled();
  });
});
