import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  playModuleComplete,
  playNodeUnlock,
  playPathUnlock,
  playReveal,
  setSoundMuted,
} from "./sound";

/**
 * A tiny fake Web Audio graph that counts the oscillators it creates.
 *
 * jsdom has no AudioContext, so this both proves sound works and lets the test
 * assert that mute short-circuits before any audio node is built.
 */
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  oscillators = 0;

  createOscillator() {
    this.oscillators += 1;
    return {
      type: "sine",
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: () => undefined,
      stop: () => undefined,
    };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: (node: unknown) => node,
    };
  }

  resume() {
    return Promise.resolve();
  }
}

const audio = new FakeAudioContext();
let clock = 0;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  // Advance the clock between tests so the sound throttle never sees an
  // earlier timestamp than a previous test.
  clock += 1_000_000;
  vi.setSystemTime(new Date(clock));
  setSoundMuted(false);
  audio.oscillators = 0;
  // The sound service caches one AudioContext for its lifetime, so every test
  // in this file shares the same fake instance.
  vi.stubGlobal("AudioContext", function AudioContextStub() {
    return audio;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("learning sounds", () => {
  it("plays a soft reveal blip", () => {
    playReveal();

    expect(audio.oscillators).toBeGreaterThan(0);
  });

  it("plays distinct unlock sounds", () => {
    playNodeUnlock();
    vi.setSystemTime(new Date(clock + 500));
    playPathUnlock();
    vi.setSystemTime(new Date(clock + 1_000));
    playModuleComplete();

    expect(audio.oscillators).toBeGreaterThanOrEqual(3);
  });

  it("plays no unlock sound while muted", () => {
    setSoundMuted(true);

    playNodeUnlock();
    playModuleComplete();
    expect(audio.oscillators).toBe(0);

    // The same call is audible again once sound is re-enabled.
    setSoundMuted(false);
    vi.setSystemTime(new Date(clock + 10_000));
    playNodeUnlock();
    expect(audio.oscillators).toBeGreaterThan(0);
  });

  it("never throws when AudioContext is unavailable", () => {
    vi.unstubAllGlobals();
    expect(() => {
      playReveal();
      playNodeUnlock();
      playPathUnlock();
      playModuleComplete();
    }).not.toThrow();
  });
});
