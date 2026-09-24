/**
 * Structured messages for the Python sandbox boundary.
 *
 * Every message crossing the `postMessage` boundary is untrusted until it is
 * validated by one of the guards below. No arbitrary JavaScript is ever sent
 * through this channel: only learner source, data-driven tests, and execution
 * configuration.
 */
import type { ExecutionLimits } from "./limits";

/** A data-driven authored test, mirrored from the content schema. */
export type PythonTest =
  | { type: "call"; args: unknown[]; expected: unknown }
  | { type: "raises"; args: unknown[]; exception: string }
  | { type: "stdout"; expected: string };

/** Terminal status of one execution. */
export type PythonExecutionStatus =
  | "passed"
  | "failed"
  | "syntax_error"
  | "runtime_error"
  | "timeout"
  | "runner_error";

/** One test's observable outcome. */
export interface PythonTestResult {
  /** Stable, learner-facing test name, for example `square(2)`. */
  name: string;
  /** Whether this test passed. */
  passed: boolean;
  /** Authored expectation, rendered as a string. */
  expected?: string;
  /** What the learner's program produced, rendered as a string. */
  actual?: string;
  /** Optional short note, for example `raised` or `no exception`. */
  error?: string;
}

/** Structured, learner-facing error information. */
export interface PythonExecutionError {
  /** Python exception name, for example `NameError`. */
  type: string;
  /** Python exception message (or a runner-safe message). */
  message: string;
  /** 1-based line in the learner's source, when known. */
  line?: number;
  /** 1-based column, when known. */
  column?: number;
  /** The offending source line, when known. */
  sourceLine?: string;
  /** Filtered traceback limited to learner frames. */
  traceback?: string;
  /** A safely derived hint, for example a close variable name. */
  suggestion?: string;
}

/** The complete result of one execution. */
export interface PythonExecutionResult {
  executionId: string;
  status: PythonExecutionStatus;
  stdout?: string;
  stderr?: string;
  tests?: PythonTestResult[];
  error?: PythonExecutionError;
  outputTruncated?: boolean;
  durationMs?: number;
}

/** A validated request to run learner code. */
export interface RunRequest {
  requestId: string;
  source: string;
  entrypoint: string;
  tests: PythonTest[];
  /** Approved runtime packages the question declares. Never learner-supplied. */
  packages: string[];
  limits: ExecutionLimits;
}

/** Messages sent from the app to the sandbox. */
export type ClientMessage =
  | ({ type: "PYTHON_RUN" } & RunRequest)
  | { type: "PYTHON_RESET"; requestId: string };

/** Messages sent from the sandbox back to the app. */
export type RunnerMessage =
  | { type: "PYTHON_READY" }
  | { type: "PYTHON_RESULT"; requestId: string; result: PythonExecutionResult }
  | { type: "PYTHON_RUNNER_ERROR"; requestId: string; error: PythonExecutionError };

const STATUSES: readonly PythonExecutionStatus[] = [
  "passed",
  "failed",
  "syntax_error",
  "runtime_error",
  "timeout",
  "runner_error",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isTest(value: unknown): value is PythonTest {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.type) {
    case "call":
      return Array.isArray(value.args);
    case "raises":
      return Array.isArray(value.args) && isString(value.exception);
    case "stdout":
      return isString(value.expected);
    default:
      return false;
  }
}

function isLimits(value: unknown): value is ExecutionLimits {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.timeoutMs === "number" &&
    Number.isFinite(value.timeoutMs) &&
    value.timeoutMs > 0 &&
    typeof value.maxSourceBytes === "number" &&
    typeof value.maxStdoutBytes === "number" &&
    typeof value.maxTests === "number" &&
    typeof value.maxResultBytes === "number" &&
    typeof value.maxMemoryBytes === "number" &&
    Number.isFinite(value.maxMemoryBytes) &&
    value.maxMemoryBytes > 0
  );
}

/**
 * Narrows an untrusted array (for example a canonical answer's `tests`) to the
 * runtime test union, dropping anything malformed.
 */
export function toRuntimeTests(value: unknown): PythonTest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isTest);
}

/** Validates a message received by the sandbox from the app. */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }
  switch (value.type) {
    case "PYTHON_RUN":
      return (
        isString(value.requestId) &&
        isString(value.source) &&
        isString(value.entrypoint) &&
        Array.isArray(value.tests) &&
        value.tests.every(isTest) &&
        Array.isArray(value.packages) &&
        value.packages.length <= 32 &&
        value.packages.every(isString) &&
        isLimits(value.limits)
      );
    case "PYTHON_RESET":
      return isString(value.requestId);
    default:
      return false;
  }
}

function isTestResult(value: unknown): value is PythonTestResult {
  return (
    isRecord(value) &&
    isString(value.name) &&
    typeof value.passed === "boolean" &&
    isOptionalString(value.expected) &&
    isOptionalString(value.actual) &&
    isOptionalString(value.error)
  );
}

function isExecutionError(value: unknown): value is PythonExecutionError {
  return (
    isRecord(value) &&
    isString(value.type) &&
    isString(value.message) &&
    isOptionalNumber(value.line) &&
    isOptionalNumber(value.column) &&
    isOptionalString(value.sourceLine) &&
    isOptionalString(value.traceback) &&
    isOptionalString(value.suggestion)
  );
}

function isExecutionResult(value: unknown): value is PythonExecutionResult {
  if (!isRecord(value)) {
    return false;
  }
  if (!isString(value.executionId)) {
    return false;
  }
  if (!isString(value.status) || !(STATUSES as readonly string[]).includes(value.status)) {
    return false;
  }
  if (!isOptionalString(value.stdout) || !isOptionalString(value.stderr)) {
    return false;
  }
  if (value.tests !== undefined && (!Array.isArray(value.tests) || !value.tests.every(isTestResult))) {
    return false;
  }
  if (value.error !== undefined && !isExecutionError(value.error)) {
    return false;
  }
  if (value.outputTruncated !== undefined && typeof value.outputTruncated !== "boolean") {
    return false;
  }
  if (value.durationMs !== undefined && typeof value.durationMs !== "number") {
    return false;
  }
  return true;
}

/** Validates a message received by the app from the sandbox. */
export function isRunnerMessage(value: unknown): value is RunnerMessage {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }
  switch (value.type) {
    case "PYTHON_READY":
      return true;
    case "PYTHON_RESULT":
      return isString(value.requestId) && isExecutionResult(value.result);
    case "PYTHON_RUNNER_ERROR":
      return isString(value.requestId) && isExecutionError(value.error);
    default:
      return false;
  }
}
