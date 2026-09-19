import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCountUp } from "./useCountUp";

const originalMatchMedia = window.matchMedia;

function setReducedMotion(reduce: boolean): void {
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

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe("useCountUp", () => {
  it("animates from zero up to the target", () => {
    setReducedMotion(false);
    vi.useFakeTimers();

    const { result } = renderHook(() => useCountUp(108, { durationMs: 900 }));
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(result.current).toBe(108);
  });

  it("shows the final value immediately with reduced motion", () => {
    setReducedMotion(true);

    const { result } = renderHook(() => useCountUp(108, { durationMs: 900 }));
    expect(result.current).toBe(108);
  });

  it("can be disabled to render the final value", () => {
    setReducedMotion(false);

    const { result } = renderHook(() =>
      useCountUp(24, { enabled: false, durationMs: 900 }),
    );
    expect(result.current).toBe(24);
  });
});
