/**
 * Best-effort, privacy-preserving telemetry for Python execution.
 *
 * Only non-sensitive aggregate facts are emitted: the outcome kind, the
 * duration, and the number of tests. Learner source, stdout, tracebacks, and
 * arbitrary values are never included. The event is dispatched locally so a
 * future analytics sink can subscribe without changing this module.
 */
import type { PythonExecutionResult } from "./protocol";

/** Aggregate execution outcome. */
export interface PythonExecutionTelemetry {
  kind:
    | "python_execution_passed"
    | "python_execution_failed"
    | "python_execution_timeout"
    | "python_execution_error";
  durationMs?: number;
  testCount?: number;
  passedCount?: number;
}

/** Window event name carrying one aggregate execution fact. */
export const PYTHON_EXECUTION_EVENT = "adaptive-learn:python-execution";

/** Records one aggregate execution outcome. Never records source or output. */
export function recordPythonExecution(result: PythonExecutionResult): void {
  const kind: PythonExecutionTelemetry["kind"] =
    result.status === "passed"
      ? "python_execution_passed"
      : result.status === "failed"
        ? "python_execution_failed"
        : result.status === "timeout"
          ? "python_execution_timeout"
          : "python_execution_error";

  const tests = result.tests ?? [];
  const detail: PythonExecutionTelemetry = {
    kind,
    durationMs: result.durationMs,
    testCount: tests.length,
    passedCount: tests.filter((test) => test.passed).length,
  };

  try {
    window.dispatchEvent(
      new CustomEvent<PythonExecutionTelemetry>(PYTHON_EXECUTION_EVENT, {
        detail,
      }),
    );
  } catch {
    // Telemetry is optional; a missing EventTarget must never break a run.
  }
}
