import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Interaction } from "../api/types";
import type {
  PythonExecutionResult,
  PythonExecutionStatus,
  PythonTest,
} from "../pythonExecution";
import PythonCodeInteraction from "./PythonCodeInteraction";

const { runMock, statusMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  statusMock: vi.fn(() => "ready"),
}));

vi.mock("../pythonExecution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pythonExecution")>();
  return {
    ...actual,
    getPythonExecutionClient: () => ({ run: runMock }),
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

const interaction: Extract<Interaction, { type: "python_code" }> = {
  type: "python_code",
  language: "python",
  entrypoint: "square",
  starter_code: "def square(x):\n    pass\n",
  packages: [],
};

const tests: PythonTest[] = [
  { type: "call", args: [2], expected: 4 },
  { type: "call", args: [3], expected: 9 },
];

function result(
  overrides: Partial<PythonExecutionResult> & { status: PythonExecutionStatus },
): PythonExecutionResult {
  return { executionId: "exec-1", ...overrides };
}

afterEach(() => {
  runMock.mockReset();
  statusMock.mockReturnValue("ready");
});

function renderInteraction(overrides: Partial<Parameters<typeof PythonCodeInteraction>[0]> = {}) {
  const onChange = vi.fn();
  const onResult = vi.fn();
  render(
    <PythonCodeInteraction
      interaction={interaction}
      tests={tests}
      value={"def square(x):\n    return x * x\n"}
      onChange={onChange}
      onResult={onResult}
      {...overrides}
    />,
  );
  return { onChange, onResult };
}

describe("PythonCodeInteraction", () => {
  it("runs the authored tests and reports per-test success", async () => {
    runMock.mockResolvedValue(
      result({
        status: "passed",
        tests: [
          { name: "square(2)", passed: true, expected: "4", actual: "4" },
          { name: "square(3)", passed: true, expected: "9", actual: "9" },
        ],
      }),
    );
    const { onResult } = renderInteraction();

    await userEvent.click(screen.getByRole("button", { name: /run tests/i }));

    expect(await screen.findByText(/All 2 tests passed/)).toBeInTheDocument();
    const call = runMock.mock.calls[0]?.[0] as {
      source: string;
      entrypoint: string;
      tests: unknown;
      packages: unknown;
    };
    expect(call.entrypoint).toBe("square");
    expect(call.source).toBe("def square(x):\n    return x * x\n");
    expect(call.tests).toEqual(tests);
    expect(call.packages).toEqual([]);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "passed" }),
    );
  });

  it("passes declared runtime packages to the execution client", async () => {
    runMock.mockResolvedValue(
      result({ status: "passed", tests: [{ name: "mean(2, 4)", passed: true }] }),
    );
    renderInteraction({ interaction: { ...interaction, packages: ["numpy"] } });

    await userEvent.click(screen.getByRole("button", { name: /run tests/i }));
    await screen.findByText(/All 1 tests passed/);

    expect(runMock.mock.calls[0]?.[0]).toMatchObject({ packages: ["numpy"] });
  });

  it("reports each failed test with expected and actual values", async () => {
    runMock.mockResolvedValue(
      result({
        status: "failed",
        tests: [
          { name: "square(2)", passed: true, expected: "4", actual: "4" },
          { name: "square(3)", passed: false, expected: "9", actual: "0" },
        ],
      }),
    );
    renderInteraction();

    await userEvent.click(screen.getByRole("button", { name: /run tests/i }));

    expect(await screen.findByText(/1 \/ 2 tests passed/)).toBeInTheDocument();
    expect(screen.getByText(/Expected: 9 · Got: 0/)).toBeInTheDocument();
  });

  it("explains a syntax error without raw internals", async () => {
    runMock.mockResolvedValue(
      result({
        status: "syntax_error",
        error: {
          type: "SyntaxError",
          message: "expected ':'",
          line: 2,
          sourceLine: "if age >= 18",
        },
      }),
    );
    renderInteraction();

    await userEvent.click(screen.getByRole("button", { name: /run tests/i }));

    expect(await screen.findByText(/syntax error/i)).toBeInTheDocument();
    expect(screen.getByText(/if age >= 18/)).toBeInTheDocument();
  });

  it("shows a timeout message", async () => {
    runMock.mockResolvedValue(result({ status: "timeout", durationMs: 5000 }));
    renderInteraction();

    await userEvent.click(screen.getByRole("button", { name: /run tests/i }));

    expect(await screen.findByText(/ran for too long/i)).toBeInTheDocument();
  });

  it("lets the learner continue when the runtime is unavailable", async () => {
    runMock.mockResolvedValue(
      result({
        status: "runner_error",
        error: { type: "RunnerError", message: "sandbox did not respond" },
      }),
    );
    const onUnavailable = vi.fn();
    renderInteraction({ onUnavailable });

    await userEvent.click(screen.getByRole("button", { name: /run tests/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /continue without running/i }),
    );

    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("offers retry when the environment fails to start", async () => {
    runMock.mockResolvedValueOnce(
      result({
        status: "runner_error",
        error: { type: "RunnerError", message: "failed to load pyodide.asm.wasm" },
      }),
    );
    renderInteraction();

    await userEvent.click(screen.getByRole("button", { name: /run tests/i }));
    expect(await screen.findByText(/couldn't start/i)).toBeInTheDocument();

    runMock.mockResolvedValueOnce(
      result({ status: "passed", tests: [{ name: "square(2)", passed: true }] }),
    );
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/All 1 tests passed/)).toBeInTheDocument();
  });

  it("degrades gracefully in unsupported browsers", () => {
    statusMock.mockReturnValue("unsupported");
    renderInteraction();

    expect(screen.getByRole("alert")).toHaveTextContent(/can't run Python/i);
    expect(screen.queryByRole("button", { name: /run tests/i })).toBeNull();
  });


});
