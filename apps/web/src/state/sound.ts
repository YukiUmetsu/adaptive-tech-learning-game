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

type SoundName =
  | "correct"
  | "wrong"
  | "complete"
  | "reveal"
  | "node_unlock"
  | "path_unlock"
  | "module_complete"
  | "bits"
  | "check";

interface SoundShape {
  notes: number[];
  noteDuration: number;
  peak: number;
  spacing: number;
  wave: OscillatorType;
}

const SOUNDS: Record<SoundName, SoundShape> = {
  correct: {
    notes: [523.25, 659.25, 783.99],
    noteDuration: 0.18,
    peak: 0.16,
    spacing: 0.09,
    wave: "triangle",
  },
  wrong: {
    notes: [220, 174.61],
    noteDuration: 0.22,
    peak: 0.1,
    spacing: 0.09,
    wave: "sine",
  },
  // A slightly longer rising arpeggio reserved for finishing a whole mission.
  complete: {
    notes: [392.0, 523.25, 659.25, 783.99],
    noteDuration: 0.22,
    peak: 0.18,
    spacing: 0.11,
    wave: "triangle",
  },
  // Very soft data blip for revealing one card prompt. Deliberately quieter
  // than the reward sounds so it does not become annoying.
  reveal: {
    notes: [1046.5, 1568.0],
    noteDuration: 0.06,
    peak: 0.05,
    spacing: 0.03,
    wave: "sine",
  },
  // Satisfying short technological chime when a knowledge node unlocks.
  node_unlock: {
    notes: [523.25, 783.99, 1046.5],
    noteDuration: 0.16,
    peak: 0.16,
    spacing: 0.07,
    wave: "triangle",
  },
  // Small rising digital tone as a new path opens.
  path_unlock: {
    notes: [659.25, 987.77],
    noteDuration: 0.12,
    peak: 0.12,
    spacing: 0.06,
    wave: "triangle",
  },
  // Stronger but short success flourish when a module completes.
  module_complete: {
    notes: [392.0, 523.25, 659.25, 880.0],
    noteDuration: 0.2,
    peak: 0.18,
    spacing: 0.09,
    wave: "triangle",
  },
  // Bright two-note coin chime for Bits flying into the wallet.
  bits: {
    notes: [1318.51, 1760.0],
    noteDuration: 0.12,
    peak: 0.11,
    spacing: 0.05,
    wave: "triangle",
  },
  // Crisp tick for a checklist step completing.
  check: {
    notes: [1568.0, 2093.0],
    noteDuration: 0.07,
    peak: 0.08,
    spacing: 0.04,
    wave: "sine",
  },
};

function play(name: SoundName): void {
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

    const { notes, noteDuration, peak, spacing, wave } = SOUNDS[name];
    const start = context.currentTime;

    notes.forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const noteStart = start + index * spacing;
      oscillator.type = wave;
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

/** Celebratory chime played once when a quiz is completed. */
export function playMissionComplete(): void {
  play("complete");
}

/** Very soft blip for revealing one knowledge prompt. */
export function playReveal(): void {
  play("reveal");
}

/** Short technological chime for unlocking a knowledge node. */
export function playNodeUnlock(): void {
  play("node_unlock");
}

/** Rising digital tone for unlocking a path to the next module. */
export function playPathUnlock(): void {
  play("path_unlock");
}

/** Short success flourish for completing all nodes in a module. */
export function playModuleComplete(): void {
  play("module_complete");
}

/** Bright coin chime for Bits flying into the wallet. */
export function playBits(): void {
  play("bits");
}

/** Crisp tick for a checklist step completing. */
export function playCheck(): void {
  play("check");
}
