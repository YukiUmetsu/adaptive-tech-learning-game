import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useQuestionTimer } from "./useQuestionTimer";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe("useQuestionTimer", () => {
  it("accumulates active time", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useQuestionTimer("q1", true));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.elapsedMs()).toBe(1000);
  });

  it("pauses while the document is hidden", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useQuestionTimer("q1", true));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.elapsedMs()).toBe(1000);

    act(() => {
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.elapsedMs()).toBe(1500);
  });

  it("caps extreme response times", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useQuestionTimer("q1", true));

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(result.current.elapsedMs()).toBe(30 * 60 * 1000);
  });
});
