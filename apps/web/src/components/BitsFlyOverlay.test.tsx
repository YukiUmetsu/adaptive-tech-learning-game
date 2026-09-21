import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BITS_TARGET_ATTR, emitBitsEarned } from "../lib/bitsFly";
import BitsFlyOverlay from "./BitsFlyOverlay";

let originalMatchMedia: typeof window.matchMedia;

function mountTarget() {
  const target = document.createElement("span");
  target.setAttribute(BITS_TARGET_ATTR, "true");
  document.body.appendChild(target);
  return target;
}

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
});

afterEach(() => {
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
});

describe("BitsFlyOverlay", () => {
  it("renders flying Bits when Bits are earned", () => {
    const target = mountTarget();
    const { container } = render(<BitsFlyOverlay />);

    act(() => {
      emitBitsEarned(12, target);
    });

    expect(
      container.querySelectorAll(".bits-fly-particle").length,
    ).toBeGreaterThan(0);
    expect(container.querySelector(".bits-fly-label")).toHaveTextContent("+12");
  });

  it("renders nothing when there is no wallet target", () => {
    const { container } = render(<BitsFlyOverlay />);

    act(() => {
      emitBitsEarned(12);
    });

    expect(container.querySelector(".bits-fly-particle")).toBeNull();
  });

  it("skips motion under reduced motion", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    const target = mountTarget();
    const { container } = render(<BitsFlyOverlay />);

    act(() => {
      emitBitsEarned(12, target);
    });

    expect(container.querySelector(".bits-fly-particle")).toBeNull();
  });
});
