import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_MEMORY_BYTES,
  HARD_MAX_MEMORY_BYTES,
  clampMemoryQuota,
  currentMemoryQuotaBytes,
  installMemoryQuota,
  resetMemoryQuotaForTests,
} from "./memoryQuota";

afterEach(() => {
  resetMemoryQuotaForTests();
});

describe("memory quota", () => {
  it("clamps untrusted values into a realistic range", () => {
    expect(clampMemoryQuota(undefined)).toBe(DEFAULT_MAX_MEMORY_BYTES);
    expect(clampMemoryQuota(0)).toBe(DEFAULT_MAX_MEMORY_BYTES);
    expect(clampMemoryQuota(-1)).toBe(DEFAULT_MAX_MEMORY_BYTES);
    expect(clampMemoryQuota(Number.NaN)).toBe(DEFAULT_MAX_MEMORY_BYTES);
    expect(clampMemoryQuota(128 * 1024 * 1024)).toBe(128 * 1024 * 1024);
    // A client cannot raise the quota past the hard ceiling.
    expect(clampMemoryQuota(8 * 1024 * 1024 * 1024)).toBe(HARD_MAX_MEMORY_BYTES);
  });

  it("rejects growth past the quota and keeps within-budget growth working", () => {
    installMemoryQuota(2 * 1024 * 1024);
    expect(currentMemoryQuotaBytes()).toBe(2 * 1024 * 1024);

    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
    // Within budget (one 64 KiB page).
    expect(() => memory.grow(1)).not.toThrow();
    // Far past the budget.
    expect(() => memory.grow(64)).toThrow(RangeError);
  });

  it("is idempotent and can be reset", () => {
    installMemoryQuota(64 * 1024 * 1024);
    installMemoryQuota(128 * 1024 * 1024);
    expect(currentMemoryQuotaBytes()).toBe(128 * 1024 * 1024);
  });
});
