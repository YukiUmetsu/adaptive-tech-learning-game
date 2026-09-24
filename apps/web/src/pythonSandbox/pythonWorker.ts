/**
 * Web Worker that hosts the Pyodide runtime.
 *
 * The UI thread never executes learner Python. This worker is created by the
 * sandbox page (never by the app shell), loads the pinned, self-hosted Pyodide
 * build lazily on the first run, and is disposable: if a program exceeds its
 * execution budget the sandbox page is torn down, which terminates this worker
 * and discards the interpreter.
 *
 * `loadPackagesFromImports` and `micropip` are deliberately not exposed. Only
 * the standard library is available to initial exercises.
 */
import { pythonRuntimeBaseUrl } from "../pythonExecution/config";
import { installMemoryQuota } from "../pythonExecution/memoryQuota";
import { normalizePackages, type PythonPackage } from "../pythonExecution/packages";
import {
  isClientMessage,
  type ClientMessage,
  type PythonExecutionResult,
  type RunnerMessage,
} from "../pythonExecution/protocol";
import { PYTHON_HARNESS } from "./harness";

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

interface PyodideRuntime {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackage(names: string[]): Promise<unknown>;
  globals: {
    set(name: string, value: unknown): void;
    delete(name: string): void;
  };
}

const scope = self as unknown as WorkerScope;

let runtimePromise: Promise<PyodideRuntime> | null = null;

/** Packages already loaded into this runtime, so runs do not reload them. */
const loadedPackages = new Set<PythonPackage>();

/** Lazily loads the pinned Pyodide build from the versioned runtime path. */
function loadRuntime(): Promise<PyodideRuntime> {
  if (!runtimePromise) {
    const base = pythonRuntimeBaseUrl();
    runtimePromise = (async () => {
      const module = await import(/* @vite-ignore */ `${base}pyodide.mjs`);
      const runtime = await module.loadPyodide({
        indexURL: base,
        // Give Python no JavaScript bridge at all. Pyodide builds its `js`
        // module from this object, so an empty object means learner code has
        // no handle to `fetch`, `indexedDB`, `caches`, `postMessage`,
        // `globalThis`, or anything else on the worker's global scope. Combined
        // with the worker platform (no `document`/`localStorage`) and the
        // sandbox CSP, this is what prevents access to site storage, files, and
        // the network without needing a separate origin.
        jsglobals: {},
      });
      return runtime as PyodideRuntime;
    })().catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

function post(message: RunnerMessage): void {
  scope.postMessage(message);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }
  return "The Python runtime could not run this program.";
}

/** Bounds the result so a pathological program cannot flood the boundary. */
function capResult(
  result: PythonExecutionResult,
  maxResultBytes: number,
): PythonExecutionResult {
  if (JSON.stringify(result).length <= maxResultBytes) {
    return result;
  }
  const share = Math.max(1_000, Math.floor(maxResultBytes / 4));
  return {
    ...result,
    stdout: result.stdout?.slice(0, share),
    stderr: result.stderr?.slice(0, share),
    tests: result.tests?.slice(0, 50),
    outputTruncated: true,
  };
}

/**
 * Loads approved packages from the pinned, self-hosted distribution.
 *
 * The allowlist is enforced here as well as on the client, so a malformed or
 * hostile message can never ask the runtime for an unapproved package. This
 * uses Pyodide's own loader (the lock file shipped with the pinned build), not
 * `micropip`, PyPI, or `loadPackagesFromImports`.
 */
async function ensurePackages(
  runtime: PyodideRuntime,
  packages: PythonPackage[],
): Promise<void> {
  const missing = packages.filter((name) => !loadedPackages.has(name));
  if (missing.length === 0) {
    return;
  }
  await runtime.loadPackage(missing);
  for (const name of missing) {
    loadedPackages.add(name);
  }
}

async function handleRun(
  message: Extract<ClientMessage, { type: "PYTHON_RUN" }>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const sourceBytes = new TextEncoder().encode(message.source).length;
    if (sourceBytes > message.limits.maxSourceBytes) {
      post({
        type: "PYTHON_RUNNER_ERROR",
        requestId: message.requestId,
        error: { type: "InputLimitError", message: "This program is too long to run here." },
      });
      return;
    }

    // Must be installed before the first Pyodide instantiation so every heap
    // growth is bounded.
    installMemoryQuota(message.limits.maxMemoryBytes);
    const runtime = await loadRuntime();
    await ensurePackages(runtime, normalizePackages(message.packages));
    const payload = JSON.stringify({
      source: message.source,
      entrypoint: message.entrypoint,
      tests: message.tests.slice(0, message.limits.maxTests),
      maxStdoutBytes: message.limits.maxStdoutBytes,
    });

    runtime.globals.set("__adaptive_learn_payload__", payload);
    let raw: unknown;
    try {
      raw = await runtime.runPythonAsync(
        `${PYTHON_HARNESS}\n_run(__adaptive_learn_payload__)`,
      );
    } finally {
      try {
        runtime.globals.delete("__adaptive_learn_payload__");
      } catch {
        // Best effort; the interpreter may be in an unusual state.
      }
    }

    const parsed = JSON.parse(String(raw)) as Partial<PythonExecutionResult>;
    const result: PythonExecutionResult = {
      executionId: message.requestId,
      status: parsed.status ?? "runner_error",
      stdout: parsed.stdout,
      stderr: parsed.stderr,
      tests: parsed.tests,
      error: parsed.error,
      outputTruncated: parsed.outputTruncated,
      durationMs: Date.now() - startedAt,
    };

    post({
      type: "PYTHON_RESULT",
      requestId: message.requestId,
      result: capResult(result, message.limits.maxResultBytes),
    });
  } catch (error) {
    post({
      type: "PYTHON_RUNNER_ERROR",
      requestId: message.requestId,
      error: { type: "RunnerError", message: safeErrorMessage(error) },
    });
  }
}

scope.onmessage = (event: MessageEvent): void => {
  // Reject anything that is not a validated client message.
  if (!isClientMessage(event.data)) {
    return;
  }
  const message: ClientMessage = event.data;
  if (message.type !== "PYTHON_RUN") {
    return;
  }
  void handleRun(message);
};
