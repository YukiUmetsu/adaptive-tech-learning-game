import { useCallback, useRef, useState } from "react";

import type { Interaction } from "../api/types";
import {
  getPythonExecutionClient,
  pythonRuntimeStatus,
  type PythonExecutionResult,
  type PythonTest,
} from "../pythonExecution";
import { friendlyPythonError } from "../pythonExecution/errors";
import CodeEditor from "./CodeEditor";

/** The `python_code` arm of the shared interaction union. */
export type PythonCodeInteractionDef = Extract<Interaction, { type: "python_code" }>;

interface PythonCodeInteractionProps {
  interaction: PythonCodeInteractionDef;
  /** Authored tests from the question's canonical answer. */
  tests: readonly PythonTest[];
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
  /** Reports the latest run so the parent can build the submitted answer. */
  onResult: (result: PythonExecutionResult | null) => void;
  /**
   * Optional escape hatch for when the isolated runtime cannot start. Lets the
   * learner continue (recorded as a zero-pass attempt) instead of being stuck.
   */
  onUnavailable?: () => void;
}

/**
 * Learner-facing Python exercise.
 *
 * Shows a code editor, runs the learner's program in the isolated browser
 * runtime against the authored tests, and reports per-test results plus
 * beginner-friendly diagnostics. No learner source is sent to the API.
 */
export default function PythonCodeInteraction({
  interaction,
  tests,
  value,
  disabled = false,
  onChange,
  onResult,
  onUnavailable,
}: PythonCodeInteractionProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PythonExecutionResult | null>(null);
  const hasPrepared = useRef(false);
  const runtimeStatus = pythonRuntimeStatus();

  const run = useCallback(async () => {
    if (running || disabled || runtimeStatus !== "ready") {
      return;
    }
    setRunning(true);
    // Clear the previous outcome so Submit is disabled until this run finishes.
    setResult(null);
    onResult(null);
    const client = getPythonExecutionClient();
    try {
      const next = await client.run({
        source: value,
        entrypoint: interaction.entrypoint ?? "",
        tests: [...tests],
        packages: interaction.packages ?? [],
      });
      hasPrepared.current = true;
      setResult(next);
      onResult(next);
    } finally {
      setRunning(false);
    }
  }, [
    disabled,
    interaction.entrypoint,
    interaction.packages,
    onResult,
    running,
    runtimeStatus,
    tests,
    value,
  ]);

  if (runtimeStatus === "unsupported") {
    return (
      <div className="python-code">
        <p role="alert" className="python-code-unsupported">
          This browser can&apos;t run Python exercises. The rest of the lesson
          still works.
        </p>
      </div>
    );
  }

  const testResults = result?.tests ?? [];
  const passedCount = testResults.filter((test) => test.passed).length;
  const status = result?.status;

  return (
    <div className="python-code">
      <div className="python-code-toolbar">
        <span className="python-code-runtime">Python in your browser</span>
        <button
          type="button"
          className="primary"
          disabled={disabled || running}
          onClick={() => void run()}
        >
          {running ? "Running…" : result ? "Run tests again" : "Run tests"}
        </button>
      </div>

      <CodeEditor
        label="Python code"
        value={value}
        disabled={disabled || running}
        onChange={onChange}
      />

      <div className="python-code-output" aria-live="polite">
        {running && !result ? (
          <p role="status" className="python-code-status">
            {hasPrepared.current
              ? "Running…"
              : "Preparing Python environment… (first run downloads the runtime)"}
          </p>
        ) : null}

        {status === "passed" ? (
          <p className="python-code-status python-code-status--pass">
            ✓ All {testResults.length} tests passed
          </p>
        ) : null}

        {status === "failed" ? (
          <p className="python-code-status python-code-status--fail">
            {passedCount} / {testResults.length} tests passed
          </p>
        ) : null}

        {testResults.length > 0 ? (
          <ul className="python-test-list">
            {testResults.map((test, index) => (
              <li
                key={`${test.name}-${index}`}
                className={`python-test${test.passed ? " python-test--pass" : " python-test--fail"}`}
              >
                <span className="python-test-mark" aria-hidden="true">
                  {test.passed ? "✓" : "✗"}
                </span>
                <span className="python-test-name">{test.name}</span>
                {!test.passed ? (
                  <span className="python-test-detail">
                    Expected: {test.expected ?? "—"} · Got: {test.actual ?? "—"}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {status === "syntax_error" || status === "runtime_error" ? (
          <PythonErrorPanel result={result!} />
        ) : null}

        {status === "timeout" ? (
          <div className="python-error" role="alert">
            <p className="python-error-title">Your code ran for too long.</p>
            <p className="python-error-detail">
              A program like an endless loop can freeze the page if it never
              stops. Check your loops and try again.
            </p>
          </div>
        ) : null}

        {status === "runner_error" ? (
          <div className="python-error" role="alert">
            <p className="python-error-title">
              Python couldn&apos;t start in your browser.
            </p>
            <p className="python-error-detail">
              Your code wasn&apos;t run, so you can keep going with the rest of
              the lesson.
            </p>
            <div className="python-error-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void run()}
                disabled={running}
              >
                Try again
              </button>
              {onUnavailable && !disabled ? (
                <button type="button" onClick={onUnavailable}>
                  Continue without running
                </button>
              ) : null}
            </div>
            <details className="python-error-technical">
              <summary>Technical details</summary>
              <pre>{result?.error?.message ?? "Unknown runner error"}</pre>
            </details>
          </div>
        ) : null}

        {result?.outputTruncated ? (
          <p className="python-code-truncated" role="status">
            Output was very long, so it was truncated.
          </p>
        ) : null}

        {result?.stdout ? (
          <details className="python-stream">
            <summary>Output</summary>
            <pre>{result.stdout}</pre>
          </details>
        ) : null}

        {result?.stderr ? (
          <details className="python-stream">
            <summary>Error output</summary>
            <pre>{result.stderr}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function PythonErrorPanel({ result }: { result: PythonExecutionResult }) {
  const error = result.error;
  if (!error) {
    return null;
  }
  const friendly = friendlyPythonError(error);
  return (
    <div className="python-error" role="alert">
      <p className="python-error-title">{friendly.title}</p>
      {friendly.detail ? (
        <p className="python-error-detail">
          <code>
            {error.type}: {friendly.detail}
          </code>
        </p>
      ) : null}
      {error.sourceLine ? (
        <pre className="python-error-source">{error.sourceLine}</pre>
      ) : null}
      {friendly.hint ? (
        <p className="python-error-hint">{friendly.hint}</p>
      ) : null}
      <details className="python-error-technical">
        <summary>Technical details</summary>
        <pre>{error.traceback ?? `${error.type}: ${error.message}`}</pre>
      </details>
    </div>
  );
}
