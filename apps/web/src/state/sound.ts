import { useSyncExternalStore } from "react";

/**
 * Tiny synthesized sound service.
 *
 * Uses the Web Audio API so V1 ships without audio assets. The public API
 * (`playCorrect` / `playWrong`) is intentionally small so real `.ogg`/`.mp3`
 * files can replace the synthesis later without touching feedback components.
 *
 * Requirements honoured here: sound only follows a user interaction, mute is
 * persisted, volume is conservative, overlapping plays are throttled, and the
 * service never throws when `AudioContext` is unavailable (for example in
 * tests).
 */
const MUTE_KEY = "adaptive-learn.sound-muted";
const MIN_INTERVAL_MS = 120;

let muted = readMuted();
let context: AudioContext | null = null;
let lastPlayedAt = 0;
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeMuted(value: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, String(value));
  } catch {
    // Storage can be unavailable; mute still applies for this session.
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current mute preference. */
export function isSoundMuted(): boolean {
  return muted;
}

/** Updates and persists the mute preference. */
export function setSoundMuted(value: boolean): void {
  muted = value;
  writeMuted(value);
  emit();
}

/** Flips the mute preference. */
export function toggleSoundMuted(): void {
  setSoundMuted(!muted);
}

/** React binding for the mute preference. */
export function useSoundMuted(): boolean {
  return useSyncExternalStore(subscribe, isSoundMuted, isSoundMuted);
}

function audioContextCtor():
  | (new () => AudioContext)
  | null {
  const globalWindow = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return globalWindow.AudioContext ?? globalWindow.webkitAudioContext ?? null;
}

function play(name: "correct" | "wrong"): void {
  if (muted) {
    return;
  }
  const now = Date.now();
  if (now - lastPlayedAt < MIN_INTERVAL_MS) {
    return;
  }

  const Ctor = audioContextCtor();
  if (!Ctor) {
    return;
  }
  lastPlayedAt = now;

  try {
    context ??= new Ctor();
    if (context.state === "suspended") {
      void context.resume();
    }

    const notes = name === "correct" ? [523.25, 659.25, 783.99] : [220, 174.61];
    const noteDuration = name === "correct" ? 0.18 : 0.22;
    const peak = name === "correct" ? 0.16 : 0.1;
    const start = context.currentTime;

    notes.forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const noteStart = start + index * 0.09;
      oscillator.type = name === "correct" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(peak, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + noteDuration);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + noteDuration + 0.02);
    });
  } catch {
    // Audio must never break the learning flow.
  }
}

/** Short pleasant chime for a fully correct answer. */
export function playCorrect(): void {
  play("correct");
}

/** Short soft boop for an incorrect or partial answer. */
export function playWrong(): void {
  play("wrong");
}
