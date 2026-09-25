import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readStoredPreferences,
  resetPreferences,
  updatePreferences,
} from "./preferences";
import {
  isSoundMuted,
  playBlocked,
  playCorrect,
  playFanfare,
  playHeroAttack,
  playMissionComplete,
  playRestore,
  playVictory,
  playWrong,
  setSoundMuted,
  toggleSoundMuted,
  unlockAudioOnFirstGesture,
} from "./sound";

beforeEach(() => {
  window.localStorage.clear();
  resetPreferences();
  setSoundMuted(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Frequencies of every oscillator the sound service created since the last
 * `stubAudioContext`. The service caches its `AudioContext`, so the recorded
 * array is module-scoped and reset per call rather than per stub instance.
 */
let recorded: number[] = [];

/** Installs a minimal AudioContext so tests can tell whether a cue scheduled sound. */
function stubAudioContext(): void {
  recorded = [];
  class FakeGain {
    gain = {
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    };
    connect(node: unknown) {
      return node;
    }
  }
  class FakeOscillator {
    type = "sine";
    frequency = {
      value: 0,
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    };
    connect(node: unknown) {
      return node;
    }
    start() {}
    stop() {}
  }
  class FakeAudioContext {
    currentTime = 0;
    state = "running";
    destination = {};
    createOscillator() {
      const oscillator = new FakeOscillator();
      recorded.push(oscillator.frequency.value);
      return oscillator;
    }
    createGain() {
      return new FakeGain();
    }
    resume() {}
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
}

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
    expect(() => playVictory()).not.toThrow();
    expect(() => playFanfare()).not.toThrow();
    expect(() => playHeroAttack()).not.toThrow();
    expect(() => playRestore()).not.toThrow();

    setSoundMuted(true);
    expect(() => playWrong()).not.toThrow();
  });

  it("binds the first-gesture audio unlock at most once", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    expect(() => unlockAudioOnFirstGesture()).not.toThrow();
    const bound = addEventListener.mock.calls.length;
    expect(() => unlockAudioOnFirstGesture()).not.toThrow();
    // Idempotent: the second call must not add more listeners.
    expect(addEventListener.mock.calls.length).toBe(bound);
  });

  it("respects the mission completion sound switch", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2100-01-01T00:00:00Z"));
    stubAudioContext();

    playFanfare();
    expect(recorded.length).toBeGreaterThan(0);

    recorded = [];
    updatePreferences({ audio: { missionCompletionSounds: false } });
    vi.setSystemTime(new Date("2100-01-01T00:00:05Z"));
    playFanfare();
    expect(recorded).toHaveLength(0);
  });

  it("never throttles the completion cue behind a gameplay sound", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2100-01-02T00:00:00Z"));
    stubAudioContext();

    // The final block/breach lands just before the win; it must not swallow the
    // victory cue (regression: the 1s completion throttle used to do exactly
    // that).
    playBlocked();
    expect(recorded.length).toBeGreaterThan(0);

    recorded = [];
    playVictory();
    expect(recorded.length).toBeGreaterThan(0);
  });

  it("throttles repeated non-completion cues", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2100-01-03T00:00:00Z"));
    stubAudioContext();

    playHeroAttack();
    expect(recorded.length).toBeGreaterThan(0);

    recorded = [];
    playHeroAttack();
    expect(recorded).toHaveLength(0);
  });
});
