import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isSoundMuted,
  playCorrect,
  playMissionComplete,
  playWrong,
  setSoundMuted,
  toggleSoundMuted,
} from "./sound";

beforeEach(() => {
  window.localStorage.clear();
  setSoundMuted(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sound", () => {
  it("persists the mute preference", () => {
    setSoundMuted(true);
    expect(isSoundMuted()).toBe(true);
    expect(window.localStorage.getItem("adaptive-learn.sound-muted")).toBe(
      "true",
    );

    toggleSoundMuted();
    expect(isSoundMuted()).toBe(false);
  });

  it("does not throw when AudioContext is unavailable", () => {
    // jsdom has no AudioContext; the service must degrade to silence.
    expect(() => playCorrect()).not.toThrow();
    expect(() => playMissionComplete()).not.toThrow();

    setSoundMuted(true);
    expect(() => playWrong()).not.toThrow();
  });
});
