/**
 * Defensive execution limits shared by the client and the runner.
 *
 * These are conservative defaults for introductory exercises. They are input
 * validation plus a WASM heap quota, not a full process sandbox: browsers
 * cannot enforce a per-worker memory quota, so pathological programs are also
 * handled by terminating and recreating the runner. See
 * `docs/14-security-privacy.md`.
 */
import { DEFAULT_MAX_MEMORY_BYTES, clampMemoryQuota } from "./memoryQuota";

export interface ExecutionLimits {
  /** Wall-clock budget before the runner is torn down. */
  timeoutMs: number;
  /** Maximum learner source length, in UTF-8 bytes. */
  maxSourceBytes: number;
  /** Maximum captured stdout/stderr kept per stream. */
  maxStdoutBytes: number;
  /** Maximum number of authored tests executed in one run. */
  maxTests: number;
  /** Maximum serialized result size returned across the boundary. */
  maxResultBytes: number;
  /** Maximum Python/WASM heap, in bytes. */
  maxMemoryBytes: number;
}

/** Reads the optional build-time memory quota override, in MiB. */
function configuredMemoryBytes(): number {
  const raw = Number(import.meta.env.VITE_PYTHON_MAX_MEMORY_MB);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_MAX_MEMORY_BYTES;
  }
  return clampMemoryQuota(raw * 1024 * 1024);
}

/** Conservative defaults for standard-library and scientific exercises. */
export const DEFAULT_LIMITS: ExecutionLimits = {
  timeoutMs: 5000,
  maxSourceBytes: 20_000,
  maxStdoutBytes: 16_000,
  maxTests: 50,
  maxResultBytes: 512_000,
  maxMemoryBytes: configuredMemoryBytes(),
};

/** Tags a timeout so the UI can distinguish it from a real runtime error. */
export const TIMEOUT_STATUS = "timeout" as const;
