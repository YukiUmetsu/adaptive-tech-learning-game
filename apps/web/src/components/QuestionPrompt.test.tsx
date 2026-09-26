import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import QuestionPrompt, { parseQuestionPrompt } from "./QuestionPrompt";

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
