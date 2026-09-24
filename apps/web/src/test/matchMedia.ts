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

/**
 * Test helper for responsive components.
 *
 * jsdom reports every element's `clientWidth` as `0`, so components that fall
 * back to a media query before their first measurement can be driven here. A
 * `narrow` value of `true` matches `max-width` queries (the mobile breakpoint)
 * and reports `false` for everything else.
 */
export function setNarrowViewport(narrow: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: narrow && query.includes("max-width"),
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
