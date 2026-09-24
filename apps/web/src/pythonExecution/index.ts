/**
 * Shared Python execution client and its process-wide singleton.
 *
 * The singleton keeps the runtime alive across questions in a Python track so a
 * learner does not pay initialization cost per question, and releases it after
 * an idle period or when the track is left.
 */
import { PythonExecutionClient } from "./client";
import { IframePythonTransport } from "./iframeTransport";

export {
  PythonExecutionClient,
  isPythonRuntimeSupported,
  pythonRuntimeStatus,
  type PythonRunInput,
  type PythonRuntimeStatus,
} from "./client";
export { friendlyPythonError, type FriendlyPythonError } from "./errors";
export { DEFAULT_LIMITS, type ExecutionLimits } from "./limits";
export { PYTHON_ALLOWED_PACKAGES, type PythonPackage } from "./packages";
export { hasDedicatedSandboxOrigin, PYODIDE_VERSION } from "./config";
export type {
  PythonExecutionError,
  PythonExecutionResult,
  PythonExecutionStatus,
  PythonTest,
  PythonTestResult,
} from "./protocol";

let client: PythonExecutionClient | null = null;

/** Returns the process-wide execution client, creating it on first use. */
export function getPythonExecutionClient(): PythonExecutionClient {
  if (!client) {
    client = new PythonExecutionClient({
      transportFactory: () => new IframePythonTransport(),
    });
  }
  return client;
}

/**
 * Tears down the runtime and reclaims its memory.
 *
 * Downloaded assets stay in the browser's HTTP cache, so a later run
 * re-initializes quickly without re-downloading the WASM payload.
 */
export function disposePythonRuntime(): void {
  client?.dispose();
  client = null;
}

/** Test seam: discards the singleton without leaving it disposed. */
export function resetPythonExecutionClientForTests(): void {
  disposePythonRuntime();
}
