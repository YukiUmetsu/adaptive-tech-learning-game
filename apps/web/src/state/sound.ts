import {
  getPreferences,
  updatePreferences,
  useUserPreferences,
} from "./preferences";

/**
 * Tiny synthesized sound service.
 *
 * Uses the Web Audio API so V1 ships without audio assets. The public API
 * (`playCorrect` / `playWrong`) is intentionally small so real `.ogg`/`.mp3`
 * files can replace the synthesis later without touching feedback components.
 *
 * Requirements honoured here: sound only follows a user interaction, the mute
 * preference lives in the unified Personal Settings model, volume is
 * conservative, overlapping plays are throttled, and the service never throws
 * when `AudioContext` is unavailable (for example in tests).
 */
const MIN_INTERVAL_MS = 120;

let context: AudioContext | null = null;
let lastPlayedAt = 0;

/** Current mute preference, derived from the Personal Settings audio master. */
export function isSoundMuted(): boolean {
  return !getPreferences().audio.enabled;
}

/** Updates and persists the mute preference. */
export function setSoundMuted(value: boolean): void {
  updatePreferences({ audio: { enabled: !value } });
}

/** Flips the mute preference. */
export function toggleSoundMuted(): void {
  setSoundMuted(!isSoundMuted());
}

/** React binding for the mute preference. */
export function useSoundMuted(): boolean {
  return !useUserPreferences().audio.enabled;
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

let audioUnlockBound = false;

/**
 * Primes the AudioContext on the first user gesture.
 *
 * Most game sounds are triggered by the simulation timer rather than a click, so
 * a browser that enforces its autoplay policy would otherwise keep the context
 * suspended and every cue silent. Binding this once, at startup, guarantees the
 * context is running before any timer-driven sound (waves, victory) fires.
 */
export function unlockAudioOnFirstGesture(): void {
  if (audioUnlockBound || typeof window === "undefined") {
    return;
  }
  audioUnlockBound = true;

  const prime = () => {
    const Ctor = audioContextCtor();
    if (!Ctor) {
      return;
    }
    try {
      context ??= new Ctor();
      if (context.state === "suspended") {
        void context.resume();
      }
    } catch {
      // Audio must never break the learning flow.
    }
  };

  window.addEventListener("pointerdown", prime, { once: true, capture: true });
  window.addEventListener("keydown", prime, { once: true, capture: true });
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
  | "check"
  | "build"
  | "upgrade"
  | "shoot"
  | "blocked"
  | "base_hit"
  | "wave_start"
  | "boss"
  | "victory"
  | "fanfare"
  | "hero_attack"
  | "restore"
  | "defeat";

interface SoundShape {
  notes: number[];
  noteDuration: number;
  peak: number;
  spacing: number;
  wave: OscillatorType;
  /** Extra sustain for the final note, so a fanfare can end on a held chord. */
  finalHold?: number;
  /** Optional pitch sweep layered under the notes, for a swoosh. */
  sweep?: { from: number; to: number; duration: number };
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
  // Satisfying thunk when a defense is deployed.
  build: {
    notes: [392.0, 587.33, 783.99],
    noteDuration: 0.12,
    peak: 0.14,
    spacing: 0.05,
    wave: "square",
  },
  // Bright two-note lift when a tower is upgraded.
  upgrade: {
    notes: [659.25, 1046.5],
    noteDuration: 0.14,
    peak: 0.15,
    spacing: 0.07,
    wave: "triangle",
  },
  // Very short, quiet zap while a tower is firing. Heavily throttled.
  shoot: {
    notes: [1760.0],
    noteDuration: 0.03,
    peak: 0.04,
    spacing: 0,
    wave: "square",
  },
  // Punchy pop when an attack is blocked.
  blocked: {
    notes: [440.0, 880.0],
    noteDuration: 0.08,
    peak: 0.1,
    spacing: 0.03,
    wave: "triangle",
  },
  // Low thud when an attack reaches the protected system.
  base_hit: {
    notes: [146.83, 110.0],
    noteDuration: 0.28,
    peak: 0.16,
    spacing: 0.08,
    wave: "sawtooth",
  },
  // Rising fanfare for a new wave.
  wave_start: {
    notes: [392.0, 523.25, 659.25],
    noteDuration: 0.14,
    peak: 0.14,
    spacing: 0.08,
    wave: "triangle",
  },
  // Ominous low cue for a boss entrance.
  boss: {
    notes: [110.0, 82.41, 110.0],
    noteDuration: 0.4,
    peak: 0.2,
    spacing: 0.16,
    wave: "sawtooth",
  },
  // Long celebratory run for winning a mission.
  victory: {
    notes: [392.0, 523.25, 659.25, 783.99, 1046.5],
    noteDuration: 0.24,
    peak: 0.18,
    spacing: 0.11,
    wave: "triangle",
    finalHold: 0.45,
  },
  // Bigger, triumphant fanfare for a perfect clear or a defeated boss: the run
  // climbs higher and lands on a sustained final note.
  fanfare: {
    notes: [392.0, 523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98],
    noteDuration: 0.22,
    peak: 0.2,
    spacing: 0.1,
    wave: "triangle",
    finalHold: 0.7,
  },
  // Short, punchy sword swing for a hero melee hit: a bright metallic tick
  // layered over a fast descending swoosh.
  hero_attack: {
    notes: [1760.0, 2349.32],
    noteDuration: 0.05,
    peak: 0.12,
    spacing: 0.015,
    wave: "triangle",
    sweep: { from: 1500, to: 320, duration: 0.12 },
  },
  // Warm rising recovery cue when Backup restores system health.
  restore: {
    notes: [523.25, 659.25, 880.0],
    noteDuration: 0.18,
    peak: 0.16,
    spacing: 0.07,
    wave: "triangle",
    finalHold: 0.3,
  },
  // Descending failure cue.
  defeat: {
    notes: [392.0, 329.63, 261.63, 196.0],
    noteDuration: 0.3,
    peak: 0.14,
    spacing: 0.14,
    wave: "sawtooth",
  },
};

const COMPLETION_SOUNDS: ReadonlySet<SoundName> = new Set([
  "complete",
  "victory",
  "fanfare",
  "defeat",
]);

function play(name: SoundName, minIntervalMs = MIN_INTERVAL_MS): void {
  const audio = getPreferences().audio;
  if (!audio.enabled) {
    return;
  }
  // Per-category switches only gate the categories that already exist.
  if ((name === "correct" || name === "wrong") && !audio.answerFeedbackSounds) {
    return;
  }
  if (COMPLETION_SOUNDS.has(name) && !audio.missionCompletionSounds) {
    return;
  }

  // Completion cues must never be swallowed by the throttle: the final block or
  // breach sound usually plays within a second of the win, and losing the
  // celebration to that is worse than a rare overlap.
  const isCompletion = COMPLETION_SOUNDS.has(name);
  const now = Date.now();
  if (
    !isCompletion &&
    now - lastPlayedAt < Math.max(MIN_INTERVAL_MS, minIntervalMs)
  ) {
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

    const { notes, noteDuration, peak, spacing, wave, finalHold, sweep } =
      SOUNDS[name];
    const start = context.currentTime;

    notes.forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const noteStart = start + index * spacing;
      const duration =
        index === notes.length - 1 && finalHold ? finalHold : noteDuration;
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(peak, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + duration + 0.02);
    });

    if (sweep) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(sweep.from, start);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, sweep.to),
        start + sweep.duration,
      );
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + sweep.duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + sweep.duration + 0.02);
    }
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

/** Satisfying thunk when a defense is deployed. */
export function playBuild(): void {
  play("build");
}

/** Bright lift when a tower is upgraded. */
export function playUpgrade(): void {
  play("upgrade");
}

/** Quiet zap while towers are firing. Heavily throttled to stay pleasant. */
export function playShoot(): void {
  play("shoot", 260);
}

/** Short, punchy sword swing when a deployed hero lands a melee hit. */
export function playHeroAttack(): void {
  play("hero_attack", 120);
}

/** Warm rising cue when Backup restores system health. */
export function playRestore(): void {
  play("restore", 400);
}

/** Punchy pop when an attack is blocked. */
export function playBlocked(): void {
  play("blocked", 90);
}

/** Low thud when an attack reaches the protected system. */
export function playBaseHit(): void {
  play("base_hit", 160);
}

/** Rising fanfare for a new wave. */
export function playWaveStart(): void {
  play("wave_start", 300);
}

/** Ominous cue for a boss entrance. */
export function playBoss(): void {
  play("boss", 600);
}

/** Long celebratory run for winning a mission. */
export function playVictory(): void {
  play("victory", 1000);
}

/**
 * Bigger fanfare for a standout win: a perfect (three-star) clear or a
 * defeated boss. Shares the completion-sound switch with {@link playVictory}.
 */
export function playFanfare(): void {
  play("fanfare", 1000);
}

/** Descending cue for losing a mission. */
export function playDefeat(): void {
  play("defeat", 1000);
}
