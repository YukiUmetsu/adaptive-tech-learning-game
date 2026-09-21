import { beforeEach, describe, expect, it } from "vitest";

import { restoreMatchMedia, setReducedMotion } from "../test/matchMedia";
import { resetPreferences, updatePreferences } from "../state/preferences";
import { prefersReducedMotion } from "./motion";

beforeEach(() => {
  window.localStorage.clear();
  resetPreferences();
  restoreMatchMedia();
});

describe("prefersReducedMotion", () => {
  it("is false by default", () => {
    setReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("honours the OS setting", () => {
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it("lets an explicit preference reduce motion further", () => {
    setReducedMotion(false);
    updatePreferences({ accessibility: { reducedMotion: true } });
    expect(prefersReducedMotion()).toBe(true);
  });

  it("treats a non-full animation intensity as reduced motion", () => {
    setReducedMotion(false);
    updatePreferences({ accessibility: { animationIntensity: "minimal" } });
    expect(prefersReducedMotion()).toBe(true);
  });

  it("never forces full motion when the OS asks for reduced motion", () => {
    setReducedMotion(true);
    updatePreferences({
      accessibility: { reducedMotion: false, animationIntensity: "full" },
    });
    expect(prefersReducedMotion()).toBe(true);
  });
});
