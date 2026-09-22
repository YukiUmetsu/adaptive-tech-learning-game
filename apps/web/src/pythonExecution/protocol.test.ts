import { describe, expect, it } from "vitest";

import {
  isClientMessage,
  isRunnerMessage,
  toRuntimeTests,
  type PythonExecutionResult,
} from "./protocol";

describe("sandbox protocol validation", () => {
  const runMessage = {
    type: "PYTHON_RUN",
    requestId: "req-1",
    source: "def square(x):\n    return x * x\n",
    entrypoint: "square",
    tests: [{ type: "call", args: [2], expected: 4 }],
    packages: [],
    limits: {
      timeoutMs: 5000,
      maxSourceBytes: 20000,
      maxStdoutBytes: 16000,
      maxTests: 50,
      maxResultBytes: 512000,
      maxMemoryBytes: 384 * 1024 * 1024,
    },
  };

  it("accepts a well-formed run request", () => {
    expect(isClientMessage(runMessage)).toBe(true);
  });

  it("rejects malformed client messages", () => {
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage("PYTHON_RUN")).toBe(false);
    expect(isClientMessage({})).toBe(false);
    expect(isClientMessage({ type: "UNKNOWN" })).toBe(false);
    expect(
      isClientMessage({ ...runMessage, tests: [{ type: "call", args: "nope" }] }),
    ).toBe(false);
    expect(isClientMessage({ ...runMessage, limits: undefined })).toBe(false);
    expect(
      isClientMessage({ ...runMessage, limits: { ...runMessage.limits, timeoutMs: 0 } }),
    ).toBe(false);
    expect(isClientMessage({ ...runMessage, packages: "numpy" })).toBe(false);
    expect(isClientMessage({ ...runMessage, packages: [1] })).toBe(false);
  });

  it("carries a package allowlist field as data, not code", () => {
    expect(isClientMessage({ ...runMessage, packages: ["numpy"] })).toBe(true);
    expect(
      isClientMessage({ ...runMessage, packages: new Array(64).fill("numpy") }),
    ).toBe(false);
  });

  it("rejects executable JavaScript smuggled through fields", () => {
    // The channel carries source as an inert string, never a function.
    expect(
      isClientMessage({ ...runMessage, source: () => "alert(1)" }),
    ).toBe(false);
    expect(
      isClientMessage({ ...runMessage, entrypoint: { toString: () => "x" } }),
    ).toBe(false);
  });

  it("accepts valid runner messages and rejects malformed ones", () => {
    const result: PythonExecutionResult = {
      executionId: "req-1",
      status: "passed",
      tests: [{ name: "square(2)", passed: true }],
    };
    expect(isRunnerMessage({ type: "PYTHON_READY" })).toBe(true);
    expect(
      isRunnerMessage({ type: "PYTHON_RESULT", requestId: "req-1", result }),
    ).toBe(true);
    expect(
      isRunnerMessage({
        type: "PYTHON_RUNNER_ERROR",
        requestId: "req-1",
        error: { type: "RunnerError", message: "boom" },
      }),
    ).toBe(true);

    expect(isRunnerMessage({ type: "PYTHON_RESULT", requestId: "req-1" })).toBe(
      false,
    );
    expect(
      isRunnerMessage({
        type: "PYTHON_RESULT",
        requestId: "req-1",
        result: { executionId: "req-1", status: "not-a-status" },
      }),
    ).toBe(false);
    expect(isRunnerMessage({ type: "PYTHON_READY_EXTRA" })).toBe(false);
  });

  it("narrows untrusted test arrays and drops malformed entries", () => {
    expect(toRuntimeTests("nope")).toEqual([]);
    expect(
      toRuntimeTests([
        { type: "call", args: [1], expected: 1 },
        { type: "raises", args: [], exception: "ValueError" },
        { type: "stdout", expected: "hi" },
        { type: "call" },
        { type: "unknown" },
      ]),
    ).toEqual([
      { type: "call", args: [1], expected: 1 },
      { type: "raises", args: [], exception: "ValueError" },
      { type: "stdout", expected: "hi" },
    ]);
  });
});
