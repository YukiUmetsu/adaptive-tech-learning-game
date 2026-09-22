import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanonicalAnswer, QuestionView } from "../api/types";
import QuestionCard from "./QuestionCard";

const { runMock, getClientMock, statusMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  getClientMock: vi.fn(),
  statusMock: vi.fn(() => "ready"),
}));

vi.mock("../pythonExecution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pythonExecution")>();
  return {
    ...actual,
    getPythonExecutionClient: getClientMock,
    pythonRuntimeStatus: statusMock,
  };
});

vi.mock("./CodeEditor", () => ({
  default: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (next: string) => void;
    disabled?: boolean;
  }) => (
    <textarea
      aria-label="Python code"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const pythonQuestion: QuestionView = {
  id: "pypc-square-exec-001",
  domain_id: "domain-1",
  task_id: "1.4",
  prompt: "Write `square(x)` so it returns the value of `x` multiplied by itself.",
  interaction_type: "python_code",
  assessment_mode: "application",
  difficulty_prior: 0.28,
  concepts: [],
  hints: [],
  interaction: {
    type: "python_code",
    language: "python",
    entrypoint: "square",
    starter_code: "def square(x):\n    # TODO: return x squared\n    pass\n",
    packages: [],
  },
};

const pythonAnswer: CanonicalAnswer = {
  type: "python_code",
  tests: [
    { type: "call", args: [2], expected: 4 },
    { type: "call", args: [-3], expected: 9 },
    { type: "call", args: [0], expected: 0 },
  ],
};

const multipleChoiceQuestion: QuestionView = {
  id: "mc-1",
  domain_id: "domain-1",
  task_id: "1.1",
  prompt: "Pick one.",
  interaction_type: "multiple_choice",
  assessment_mode: "recognition",
  difficulty_prior: 0.2,
  concepts: [],
  hints: [],
  interaction: {
    type: "multiple_choice",
    choices: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  },
};

afterEach(() => {
  runMock.mockReset();
  getClientMock.mockReset();
  statusMock.mockReturnValue("ready");
});

describe("QuestionCard Python wiring", () => {
  it("starts from starter code and submits reported test counts", async () => {
    const onSubmit = vi.fn();
    getClientMock.mockReturnValue({ run: runMock });
    runMock.mockResolvedValue({
      executionId: "exec-1",
      status: "passed",
      tests: [
        { name: "square(2)", passed: true },
        { name: "square(-3)", passed: true },
        { name: "square(0)", passed: true },
      ],
    });

    render(
      <QuestionCard
        question={pythonQuestion}
        canonicalAnswer={pythonAnswer}
        onSubmit={onSubmit}
      />,
    );

    const editor = await screen.findByLabelText("Python code");
    expect(editor).toHaveValue(
      pythonQuestion.interaction.type === "python_code"
        ? pythonQuestion.interaction.starter_code
        : "",
    );

    const submit = screen.getByRole("button", { name: /submit answer/i });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /run tests/i }));
    expect(await screen.findByText(/All 3 tests passed/)).toBeInTheDocument();
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({
      python_results: { passed: 3, total: 3 },
    });
  });

  it("lets the learner continue when the Python runtime fails", async () => {
    const onSubmit = vi.fn();
    getClientMock.mockReturnValue({ run: runMock });
    runMock.mockResolvedValue({
      executionId: "exec-err",
      status: "runner_error",
      error: { type: "RunnerError", message: "sandbox did not respond" },
    });

    render(
      <QuestionCard
        question={pythonQuestion}
        canonicalAnswer={pythonAnswer}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /run tests/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /continue without running/i }),
    );

    // Recorded as a zero-pass attempt for the authored test count.
    expect(onSubmit).toHaveBeenCalledWith({
      python_results: { passed: 0, total: 3 },
    });
  });

  it("does not load the Python runtime for non-Python questions", () => {
    const onSubmit = vi.fn();
    render(<QuestionCard question={multipleChoiceQuestion} onSubmit={onSubmit} />);

    expect(getClientMock).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
