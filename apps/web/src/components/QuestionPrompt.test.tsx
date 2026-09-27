import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import QuestionPrompt, {
  parseQuestionPrompt,
  splitPrompt,
} from "./QuestionPrompt";

describe("QuestionPrompt", () => {
  it("keeps an ordinary prompt as one heading", () => {
    render(<QuestionPrompt text="Which structure fits?" level={2} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Which structure fits?" }),
    ).toBeInTheDocument();
    expect(document.querySelector("pre")).toBeNull();
  });

  it("renders fenced Python as a syntax-highlighted block", () => {
    render(
      <QuestionPrompt
        level={2}
        text={[
          "Why can this binary search stop making progress?",
          "",
          "```python",
          "while left <= right:",
          "    mid = (left + right) // 2",
          "    left = mid",
          "```",
        ].join("\n")}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Why can this binary search stop making progress?",
      }),
    ).toBeInTheDocument();

    const code = screen.getByLabelText("python code");
    expect(code).toHaveTextContent("while left <= right:");
    expect(code).toHaveTextContent("left = mid");
    expect(code.querySelectorAll(".token-line")).toHaveLength(3);
  });

  it("supports prose after a code block", () => {
    render(
      <QuestionPrompt
        text={[
          "Inspect this code.",
          "",
          "```python",
          "x = 1",
          "```",
          "",
          "Choose the line that breaks the invariant.",
        ].join("\n")}
      />,
    );

    expect(
      screen.getByText("Choose the line that breaks the invariant."),
    ).toBeInTheDocument();
  });

  it("treats an unmatched fence as prose", () => {
    const blocks = parseQuestionPrompt("Broken ```python fence");
    expect(blocks).toEqual([{ kind: "text", text: "Broken ```python fence" }]);
  });
});

describe("splitPrompt", () => {
  it("splits off the lead sentence from the detail prose", () => {
    expect(
      splitPrompt(
        "Complete `range_sum(prefix, left, right)`. The range is half-open. Fill the two indexes.",
      ),
    ).toEqual({
      lead: "Complete `range_sum(prefix, left, right)`.",
      details: "The range is half-open. Fill the two indexes.",
    });
  });

  it("does not split inside inline code", () => {
    const parts = splitPrompt("Return `values[i]` for the boundary. Use 0-based indexing.");
    expect(parts.lead).toBe("Return `values[i]` for the boundary.");
    expect(parts.details).toBe("Use 0-based indexing.");
  });

  it("keeps a one-sentence prompt whole", () => {
    expect(splitPrompt("Complete the PyTorch code.")).toEqual({
      lead: "Complete the PyTorch code.",
      details: "",
    });
  });

  it("does not split when the next sentence is lowercase", () => {
    const prompt = "Use the shown input and expected result. e.g. the first row.";
    expect(splitPrompt(prompt)).toEqual({ lead: prompt, details: "" });
  });
});

describe("QuestionPrompt parts", () => {
  it("renders only the lead sentence for part=lead", () => {
    render(
      <QuestionPrompt
        level={1}
        part="lead"
        text="Complete `f(x)`. The contract is long and would not fit a header."
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Complete f(x).",
    );
    expect(screen.queryByText(/The contract is long/)).toBeNull();
  });

  it("renders only the detail prose for part=details", () => {
    render(
      <QuestionPrompt
        part="details"
        text="Complete `f(x)`. The contract is long."
      />,
    );

    expect(screen.getByText("The contract is long.")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders nothing for part=details when there are no details", () => {
    const { container } = render(
      <QuestionPrompt part="details" text="Complete the code." />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
