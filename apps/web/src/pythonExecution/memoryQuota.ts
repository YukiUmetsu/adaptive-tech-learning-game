/**
 * WASM heap quota for the Python sandbox.
 *
 * Browsers do not expose a per-worker memory quota, but every Emscripten memory
 * growth goes through `WebAssembly.Memory.prototype.grow`. Wrapping that method
 * before the runtime is instantiated turns an over-budget allocation into a
 * failed `malloc`, which CPython surfaces as a catchable `MemoryError` instead
 * of letting the tab exhaust memory. The interpreter stays usable afterwards.
 *
 * This bounds the WASM linear memory (the Python heap). It is not a full
 * process memory sandbox: JS-side allocations and the engine's own bookkeeping
 * are outside it.
 */

/** Default quota, in bytes (384 MiB). */
export const DEFAULT_MAX_MEMORY_BYTES = 384 * 1024 * 1024;

/** Absolute ceiling a client or content cannot raise. */
export const HARD_MAX_MEMORY_BYTES = 1024 * 1024 * 1024;

let installedOriginal: typeof WebAssembly.Memory.prototype.grow | null = null;
let quotaBytes = DEFAULT_MAX_MEMORY_BYTES;

/** Clamps an untrusted quota into a realistic range. */
export function clampMemoryQuota(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_MEMORY_BYTES;
  }
  return Math.min(Math.floor(value), HARD_MAX_MEMORY_BYTES);
}

/**
 * Installs the quota once per worker, before Pyodide is loaded.
 *
 * Calling it again only updates the budget; the prototype patch is applied once.
 */
export function installMemoryQuota(limitBytes: number): void {
  quotaBytes = clampMemoryQuota(limitBytes);
  if (installedOriginal) {
    return;
  }
  if (typeof WebAssembly !== "object" || typeof WebAssembly.Memory !== "function") {
    return;
  }

  installedOriginal = WebAssembly.Memory.prototype.grow;
  WebAssembly.Memory.prototype.grow = function grow(
    this: WebAssembly.Memory,
    delta: number,
  ): number {
    const next = this.buffer.byteLength + delta * 65_536;
    if (next > quotaBytes) {
      throw new RangeError("python memory quota exceeded");
    }
    return installedOriginal!.call(this, delta);
  };
}

/** The quota currently enforced, in bytes. */
export function currentMemoryQuotaBytes(): number {
  return quotaBytes;
}

/** Restores the original `grow`. Test and teardown helper only. */
export function resetMemoryQuotaForTests(): void {
  if (installedOriginal) {
    WebAssembly.Memory.prototype.grow = installedOriginal;
    installedOriginal = null;
  }
  quotaBytes = DEFAULT_MAX_MEMORY_BYTES;
}
