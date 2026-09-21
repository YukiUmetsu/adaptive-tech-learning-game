import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readStoredPreferences, resetPreferences } from "./preferences";
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
  resetPreferences();
  setSoundMuted(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sound", () => {
  it("persists the mute preference through Personal Settings", () => {
    setSoundMuted(true);
    expect(isSoundMuted()).toBe(true);
    expect(readStoredPreferences().audio.enabled).toBe(false);

    toggleSoundMuted();
    expect(isSoundMuted()).toBe(false);
    expect(readStoredPreferences().audio.enabled).toBe(true);
  });

  it("does not throw when AudioContext is unavailable", () => {
    // jsdom has no AudioContext; the service must degrade to silence.
    expect(() => playCorrect()).not.toThrow();
    expect(() => playMissionComplete()).not.toThrow();

    setSoundMuted(true);
    expect(() => playWrong()).not.toThrow();
  });
});
