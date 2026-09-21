import { beforeEach, describe, expect, it } from "vitest";

import {
  FOCUS_DAILY_KEY,
  getFocusDaily,
  publishFocusDaily,
  resetFocusDaily,
  restoreFocusDaily,
} from "./focusDaily";

beforeEach(() => {
  window.sessionStorage.clear();
  resetFocusDaily();
});

describe("focusDaily bridge", () => {
  it("publishes and clears a Daily Mission projection", () => {
    publishFocusDaily({
      trackId: "aws-soa-c03",
      completed: 2,
      total: 4,
      nextTitle: "NAT Gateway troubleshooting",
      nextMinutes: 4,
    });

    expect(getFocusDaily()).toEqual({
      trackId: "aws-soa-c03",
      completed: 2,
      total: 4,
      nextTitle: "NAT Gateway troubleshooting",
      nextMinutes: 4,
    });
    expect(window.sessionStorage.getItem(FOCUS_DAILY_KEY)).toContain(
      "aws-soa-c03",
    );

    publishFocusDaily(null);
    expect(getFocusDaily()).toBeNull();
    expect(window.sessionStorage.getItem(FOCUS_DAILY_KEY)).toBeNull();
  });

  it("restores a projection within the tab session", () => {
    window.sessionStorage.setItem(
      FOCUS_DAILY_KEY,
      JSON.stringify({
        trackId: "python-data-stack",
        completed: 1,
        total: 3,
        nextTitle: "Practice",
        nextMinutes: 6,
      }),
    );

    const restored = restoreFocusDaily();

    expect(restored?.trackId).toBe("python-data-stack");
    expect(getFocusDaily()?.completed).toBe(1);
  });

  it("ignores malformed projections", () => {
    window.sessionStorage.setItem(FOCUS_DAILY_KEY, "{ bad");
    expect(restoreFocusDaily()).toBeNull();

    window.sessionStorage.setItem(FOCUS_DAILY_KEY, JSON.stringify({ total: 3 }));
    expect(restoreFocusDaily()).toBeNull();
  });
});
