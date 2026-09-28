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

/** Current mute state, derived from the master volume. */
export function isSoundMuted(): boolean {
  return getPreferences().audio.masterVolume <= 0;
}

/** Mutes (0) or restores the master volume to the default level. */
export function setSoundMuted(value: boolean): void {
  updatePreferences({ audio: { masterVolume: value ? 0 : 50 } });
}

/** Flips the mute preference. */
export function toggleSoundMuted(): void {
  setSoundMuted(!isSoundMuted());
}

/** React binding for the mute preference. */
export function useSoundMuted(): boolean {
  return useUserPreferences().audio.masterVolume <= 0;
}

/** Clamps a stored volume to an integer 0-100. */
function clampVolume(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
  const master = clampVolume(audio.masterVolume);
  if (master <= 0) {
    return;
  }
  // Per-category volumes only scale the categories that already exist.
  let category = 100;
  if (name === "correct" || name === "wrong") {
    category = clampVolume(audio.answerFeedbackVolume);
  } else if (COMPLETION_SOUNDS.has(name)) {
    category = clampVolume(audio.missionCompletionVolume);
  }
  const volume = (master / 100) * (category / 100);
  if (volume <= 0) {
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
      gain.gain.exponentialRampToValueAtTime(peak * volume, noteStart + 0.02);
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
      gain.gain.exponentialRampToValueAtTime(peak * volume, start + 0.012);
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

/* ---------------------------------------------------------------------------
 * Background battle music
 *
 * A tiny, fully synthesized loop (no audio assets, no licensing): an A-minor
 * chord progression with a bass line, arpeggio, lead, and light percussion,
 * scheduled ahead with the Web Audio clock. It honours the master sound switch
 * and its own preference, and never throws when audio is unavailable.
 * ------------------------------------------------------------------------- */

const MUSIC_TEMPO = 116;
/** 16th-note duration in seconds. */
const MUSIC_STEP_SECONDS = 60 / MUSIC_TEMPO / 4;
/** How often the scheduler wakes up. */
const MUSIC_LOOKAHEAD_MS = 25;
/** How far ahead notes are scheduled. */
const MUSIC_SCHEDULE_AHEAD = 0.12;
/** Four bars of 16th notes. */
const MUSIC_STEPS = 64;
/** Master music gain (kept below the sound effects). */
const MUSIC_GAIN = 0.4;

interface MusicChord {
  bass: number;
  arp: number[];
}

/** i – VI – III – VII in A minor. */
const MUSIC_PROGRESSION: MusicChord[] = [
  { bass: 110.0, arp: [220.0, 261.63, 329.63, 261.63] },
  { bass: 87.31, arp: [174.61, 220.0, 261.63, 220.0] },
  { bass: 130.81, arp: [261.63, 329.63, 392.0, 329.63] },
  { bass: 98.0, arp: [196.0, 246.94, 293.66, 246.94] },
];

/** Sparse lead notes, one per chord. */
const MUSIC_LEAD = [440.0, 349.23, 523.25, 392.0];

let musicMaster: GainNode | null = null;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicNextTime = 0;
let musicStep = 0;
let musicNoise: AudioBuffer | null = null;

function musicEnabled(): boolean {
  const audio = getPreferences().audio;
  return audio.masterVolume > 0 && audio.battleMusicVolume > 0;
}

function ensureMusicNoise(ctx: AudioContext): AudioBuffer {
  if (musicNoise) {
    return musicNoise;
  }
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  musicNoise = buffer;
  return buffer;
}

function musicTone(
  ctx: AudioContext,
  master: GainNode,
  frequency: number,
  time: number,
  duration: number,
  peak: number,
  wave: OscillatorType,
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  oscillator.connect(gain).connect(master);
  oscillator.start(time);
  oscillator.stop(time + duration + 0.02);
}

function musicKick(ctx: AudioContext, master: GainNode, time: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(150, time);
  oscillator.frequency.exponentialRampToValueAtTime(50, time + 0.12);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.22, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
  oscillator.connect(gain).connect(master);
  oscillator.start(time);
  oscillator.stop(time + 0.16);
}

function musicHat(
  ctx: AudioContext,
  master: GainNode,
  time: number,
  peak: number,
): void {
  const source = ctx.createBufferSource();
  source.buffer = ensureMusicNoise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 7000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
  source.connect(filter).connect(gain).connect(master);
  source.start(time);
  source.stop(time + 0.06);
}

function scheduleMusicStep(
  ctx: AudioContext,
  master: GainNode,
  step: number,
  time: number,
): void {
  const chord = MUSIC_PROGRESSION[Math.floor(step / 16) % MUSIC_PROGRESSION.length];
  const inBar = step % 16;

  // Bass: a syncopated root line.
  if (inBar % 4 === 0 || inBar === 6 || inBar === 11) {
    musicTone(ctx, master, chord.bass, time, 0.22, 0.14, "sawtooth");
  }
  // Arpeggio on every 8th note.
  if (step % 2 === 0) {
    const note = chord.arp[(step / 2) % chord.arp.length];
    musicTone(ctx, master, note, time, 0.14, 0.05, "triangle");
  }
  // One soft lead note at the start of each bar.
  if (inBar === 0) {
    musicTone(
      ctx,
      master,
      MUSIC_LEAD[Math.floor(step / 16) % MUSIC_LEAD.length],
      time,
      0.5,
      0.04,
      "square",
    );
  }
  // Light percussion.
  if (inBar === 0 || inBar === 8) {
    musicKick(ctx, master, time);
  }
  if (inBar % 4 === 2) {
    musicHat(ctx, master, time, 0.05);
  } else if (inBar % 2 === 1) {
    musicHat(ctx, master, time, 0.022);
  }
}

function musicTick(): void {
  if (!musicEnabled()) {
    stopBattleMusic();
    return;
  }
  const Ctor = audioContextCtor();
  if (!Ctor) {
    return;
  }
  try {
    context ??= new Ctor();
    if (context.state === "suspended") {
      void context.resume();
    }
    if (!musicMaster) {
      return;
    }
    while (musicNextTime < context.currentTime + MUSIC_SCHEDULE_AHEAD) {
      scheduleMusicStep(context, musicMaster, musicStep, musicNextTime);
      musicNextTime += MUSIC_STEP_SECONDS;
      musicStep = (musicStep + 1) % MUSIC_STEPS;
    }
  } catch {
    // Music must never break the game.
  }
}

/** Whether the battle music loop is currently scheduled. */
export function isBattleMusicPlaying(): boolean {
  return musicTimer !== null;
}

/** Starts the looping battle music. Idempotent and preference-aware. */
export function startBattleMusic(): void {
  if (musicTimer !== null || !musicEnabled()) {
    return;
  }
  const Ctor = audioContextCtor();
  if (!Ctor) {
    return;
  }
  try {
    context ??= new Ctor();
    if (context.state === "suspended") {
      void context.resume();
    }
    musicMaster = context.createGain();
    const audio = getPreferences().audio;
    const musicGain =
      MUSIC_GAIN *
      (clampVolume(audio.masterVolume) / 100) *
      (clampVolume(audio.battleMusicVolume) / 100);
    musicMaster.gain.setValueAtTime(0.0001, context.currentTime);
    musicMaster.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, musicGain),
      context.currentTime + 0.6,
    );
    musicMaster.connect(context.destination);
    musicNextTime = context.currentTime + 0.08;
    musicStep = 0;
    musicTimer = setInterval(musicTick, MUSIC_LOOKAHEAD_MS);
  } catch {
    musicTimer = null;
    musicMaster = null;
  }
}

/** Fades out and stops the battle music. Safe to call when not playing. */
export function stopBattleMusic(): void {
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  const master = musicMaster;
  musicMaster = null;
  if (!master || !context) {
    return;
  }
  try {
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    window.setTimeout(() => {
      try {
        master.disconnect();
      } catch {
        // Already disconnected.
      }
    }, 600);
  } catch {
    try {
      master.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}
