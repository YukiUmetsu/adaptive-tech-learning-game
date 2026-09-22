/**
 * Disposable Python execution client.
 *
 * The client owns the runtime lifecycle: it lazily starts a sandbox on the
 * first run, executes one program at a time, terminates the sandbox when a run
 * exceeds its timeout, and disposes it after a period of inactivity so a mobile
 * browser can reclaim memory while the downloaded assets stay cached.
 *
 * It is intentionally unaware of Pyodide, workers, and iframes. Those live
 * behind a [`PythonTransport`].
 */
import { newId as platformNewId } from "../lib/id";
import { sandboxOrigin } from "./config";
import { DEFAULT_LIMITS, type ExecutionLimits } from "./limits";
import { normalizePackages } from "./packages";
import {
  type ClientMessage,
  type PythonExecutionError,
  type PythonExecutionResult,
  type PythonTest,
  type RunnerMessage,
} from "./protocol";
import { recordPythonExecution } from "./telemetry";
import type { PythonTransport, PythonTransportFactory } from "./transport";

/** Learner program plus its authored tests. */
export interface PythonRunInput {
  source: string;
  entrypoint: string;
  tests: PythonTest[];
  /** Approved packages the question declares; anything else is dropped. */
  packages?: string[];
}

/** Construction options, overridable by tests. */
export interface PythonExecutionClientOptions {
  transportFactory: PythonTransportFactory;
  limits?: ExecutionLimits;
  /** Idle grace period before the runtime is torn down. */
  idleTimeoutMs?: number;
  /** Overridable id generator, for deterministic tests. */
  newId?: () => string;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Why the Python runtime is or is not available in this environment. */
export type PythonRuntimeStatus =
  | "ready"
  /** Missing WebAssembly, Worker, or DOM support. */
  | "unsupported";

/** Classifies runtime availability. */
export function pythonRuntimeStatus(): PythonRuntimeStatus {
  if (
    typeof WebAssembly !== "object" ||
    typeof Worker === "undefined" ||
    typeof document === "undefined"
  ) {
    return "unsupported";
  }
  return "ready";
}

/** Whether this browser can host the isolated Python runtime at all. */
export function isPythonRuntimeSupported(): boolean {
  return pythonRuntimeStatus() === "ready";
}

interface PendingRun {
  resolve: (result: PythonExecutionResult) => void;
  timer: number;
}

/** Owns one disposable Python runtime and serializes runs against it. */
export class PythonExecutionClient {
  private readonly limits: ExecutionLimits;
  private readonly idleTimeoutMs: number;
  private readonly newId: () => string;
  private readonly transportFactory: PythonTransportFactory;

  private transport: PythonTransport | null = null;
  private starting: Promise<PythonTransport> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly pending = new Map<string, PendingRun>();
  private idleTimer: number | null = null;
  private disposed = false;

  constructor(options: PythonExecutionClientOptions) {
    this.limits = options.limits ?? DEFAULT_LIMITS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 180_000;
    this.transportFactory = options.transportFactory;
    this.newId = options.newId ?? platformNewId;
  }

  /** Runs one learner program, resolving with a structured result. */
  async run(input: PythonRunInput): Promise<PythonExecutionResult> {
    const requestId = this.newId();

    if (this.disposed) {
      return this.runnerError(requestId, "The Python environment was closed.");
    }
    if (this.pending.size > 0) {
      return this.runnerError(requestId, "Another Python run is already in progress.");
    }
    if (byteLength(input.source) > this.limits.maxSourceBytes) {
      return this.runnerError(requestId, "This program is too long to run here.");
    }
    if (input.tests.length === 0) {
      return this.runnerError(requestId, "This exercise has no tests to run.");
    }
    if (input.tests.length > this.limits.maxTests) {
      return this.runnerError(requestId, "This exercise has too many tests to run.");
    }

    this.cancelIdleDisposal();

    let transport: PythonTransport;
    try {
      transport = await this.ensureTransport();
    } catch {
      return this.runnerError(
        requestId,
        `The isolated Python sandbox at ${sandboxOrigin()} did not respond.`,
      );
    }

    const result = await new Promise<PythonExecutionResult>((resolve) => {
      const timer = window.setTimeout(() => {
        this.handleTimeout(requestId, resolve);
      }, this.limits.timeoutMs);
      this.pending.set(requestId, { resolve, timer });

      const message: ClientMessage = {
        type: "PYTHON_RUN",
        requestId,
        source: input.source,
        entrypoint: input.entrypoint,
        tests: input.tests,
        packages: normalizePackages(input.packages),
        limits: this.limits,
      };
      transport.post(message);
    });

    recordPythonExecution(result);
    this.scheduleIdleDisposal();
    return result;
  }

  /** Tears the runtime down now and discards in-flight state. */
  dispose(): void {
    this.disposed = true;
    this.cancelIdleDisposal();
    for (const [requestId, pending] of this.pending) {
      window.clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.resolve(this.runnerResult(requestId, "The Python environment was closed."));
    }
    this.teardownTransport();
  }

  private runnerError(requestId: string, message: string): PythonExecutionResult {
    const result = this.runnerResult(requestId, message);
    recordPythonExecution(result);
    return result;
  }

  private runnerResult(requestId: string, message: string): PythonExecutionResult {
    const error: PythonExecutionError = { type: "RunnerError", message };
    return { executionId: requestId, status: "runner_error", error };
  }

  private async ensureTransport(): Promise<PythonTransport> {
    if (this.transport) {
      return this.transport;
    }
    if (!this.starting) {
      const transport = this.transportFactory();
      this.starting = transport
        .start()
        .then(() => {
          if (this.disposed) {
            transport.terminate();
            throw new Error("disposed");
          }
          this.transport = transport;
          this.unsubscribe = transport.subscribe((message) =>
            this.handleMessage(message),
          );
          return transport;
        })
        .finally(() => {
          this.starting = null;
        });
    }
    return this.starting;
  }

  private handleMessage(message: RunnerMessage): void {
    if (message.type === "PYTHON_READY") {
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timer);
    this.pending.delete(message.requestId);

    if (message.type === "PYTHON_RESULT") {
      pending.resolve(message.result);
      return;
    }

    // A runner-level failure can leave the interpreter unusable (for example a
    // WASM abort during a memory-quota failure), so discard the runtime. The
    // next run recreates it lazily.
    this.teardownTransport();
    pending.resolve({
      executionId: message.requestId,
      status: "runner_error",
      error: message.error,
    });
  }

  private handleTimeout(
    requestId: string,
    resolve: (result: PythonExecutionResult) => void,
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(requestId);
    // The worker cannot be interrupted; discard the whole runtime instead.
    this.teardownTransport();
    resolve({
      executionId: requestId,
      status: "timeout",
      durationMs: this.limits.timeoutMs,
    });
  }

  private teardownTransport(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.transport?.terminate();
    this.transport = null;
    this.starting = null;
  }

  private scheduleIdleDisposal(): void {
    this.cancelIdleDisposal();
    if (this.idleTimeoutMs <= 0) {
      return;
    }
    this.idleTimer = window.setTimeout(() => {
      this.teardownTransport();
    }, this.idleTimeoutMs);
  }

  private cancelIdleDisposal(): void {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
