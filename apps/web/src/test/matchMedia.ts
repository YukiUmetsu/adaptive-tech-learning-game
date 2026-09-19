import { vi } from "vitest";

const originalMatchMedia = window.matchMedia;

/**
 * Test helper for `prefers-reduced-motion`.
 *
 * jsdom does not implement `matchMedia`, so tests install a tiny stub that
 * reports the reduce query and restore the original afterwards.
 */
export function setReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion: reduce"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

export function restoreMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
}
