import { useSyncExternalStore } from "react";

/**
 * Personal Settings V1.
 *
 * One typed preference model persisted locally under a single versioned key,
 * instead of unrelated localStorage keys scattered across the app. Preferences
 * are *configuration*, not learning evidence: they never affect scoring,
 * concept state, rewards, or Daily Mission completion.
 *
 * The store mirrors the app's other module-level stores (`sound`, `wallet`,
 * `celebration`) so components read and write through a small hook rather than
 * touching `localStorage` directly.
 *
 * No backend preferences API exists yet; the upcoming Focus tracker and Daily
 * Mission planner will consume these values in later tasks.
 */

/** Versioned storage key. The suffix is bumped on a breaking schema change. */
export const USER_PREFERENCES_KEY = "adaptive-learn.user-preferences.v1";
/**
 * Internal schema version. v2 turned Focus auto-detection on by default; a
 * stored v1 payload is migrated on read so existing installs adopt it.
 */
const SCHEMA_VERSION = 2;

/**
 * Pre-V1 mute key. Read once so an existing mute choice survives the upgrade
 * into the unified preferences model.
 */
const LEGACY_MUTE_KEY = "adaptive-learn.sound-muted";

export type StudyBalance = "balanced" | "more_practice" | "more_learning";
export type AnimationIntensity = "full" | "reduced" | "minimal";

export interface StudyPreferences {
  /** Target length of a Daily Mission, in minutes. */
  dailyMissionMinutes: number;
  studyBalance: StudyBalance;
  autoContinueMissionItems: boolean;
}

export interface FocusPreferences {
  /** Master switch for the Focus tracker and floating widget. */
  enabled: boolean;
  autoDetectStudy: boolean;
  breakReminders: boolean;
  breakAfterMinutes: number;
  breakDurationMinutes: number;
  idleTimeoutMinutes: number;
}

export interface AudioPreferences {
  /** Master sound switch; mirrors the legacy mute preference. */
  enabled: boolean;
  answerFeedbackSounds: boolean;
  missionCompletionSounds: boolean;
}

export interface AccessibilityPreferences {
  reducedMotion: boolean;
  animationIntensity: AnimationIntensity;
}

export interface GamificationPreferences {
  companionReactions: boolean;
  rewardAnimations: boolean;
  bitsAnimations: boolean;
}

export interface UserPreferences {
  study: StudyPreferences;
  focus: FocusPreferences;
  audio: AudioPreferences;
  accessibility: AccessibilityPreferences;
  gamification: GamificationPreferences;
}

/** Allowed values, shared by the parser and the settings UI. */
export const DAILY_MISSION_MINUTE_OPTIONS = [10, 15, 20, 25, 30] as const;
export const BREAK_AFTER_OPTIONS = [10, 15, 20, 25, 30] as const;
export const BREAK_DURATION_OPTIONS = [2, 3, 5, 10] as const;
export const IDLE_TIMEOUT_OPTIONS = [1, 3, 5, 10] as const;
export const STUDY_BALANCE_OPTIONS: readonly StudyBalance[] = [
  "balanced",
  "more_practice",
  "more_learning",
];
export const ANIMATION_INTENSITY_OPTIONS: readonly AnimationIntensity[] = [
  "full",
  "reduced",
  "minimal",
];

/** A fresh, mutable copy of the V1 defaults. */
export function defaultPreferences(): UserPreferences {
  return {
    study: {
      dailyMissionMinutes: 20,
      studyBalance: "balanced",
      autoContinueMissionItems: false,
    },
    focus: {
      enabled: true,
      autoDetectStudy: true,
      breakReminders: true,
      breakAfterMinutes: 25,
      breakDurationMinutes: 5,
      idleTimeoutMinutes: 5,
    },
    audio: {
      enabled: true,
      answerFeedbackSounds: true,
      missionCompletionSounds: true,
    },
    accessibility: {
      reducedMotion: false,
      animationIntensity: "full",
    },
    gamification: {
      companionReactions: true,
      rewardAnimations: true,
      bitsAnimations: true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function asOption(
  value: unknown,
  allowed: readonly number[],
  fallback: number,
): number {
  return typeof value === "number" && allowed.includes(value) ? value : fallback;
}

/**
 * Safely coerces arbitrary parsed JSON into a valid preference model.
 *
 * Unknown fields are dropped, wrong types and out-of-range choices fall back to
 * defaults, and a non-object payload returns the defaults. This is the single
 * place that has to change when the schema evolves.
 */
export function parsePreferences(raw: unknown): UserPreferences {
  const base = defaultPreferences();
  if (!isRecord(raw)) {
    return base;
  }

  const storedVersion =
    typeof raw.version === "number" && Number.isFinite(raw.version)
      ? raw.version
      : 1;

  const study = isRecord(raw.study) ? raw.study : {};
  const focus = isRecord(raw.focus) ? raw.focus : {};
  const audio = isRecord(raw.audio) ? raw.audio : {};
  const accessibility = isRecord(raw.accessibility) ? raw.accessibility : {};
  const gamification = isRecord(raw.gamification) ? raw.gamification : {};

  const parsed: UserPreferences = {
    study: {
      dailyMissionMinutes: asOption(
        study.dailyMissionMinutes,
        DAILY_MISSION_MINUTE_OPTIONS,
        base.study.dailyMissionMinutes,
      ),
      studyBalance: asEnum(
        study.studyBalance,
        STUDY_BALANCE_OPTIONS,
        base.study.studyBalance,
      ),
      autoContinueMissionItems: asBoolean(
        study.autoContinueMissionItems,
        base.study.autoContinueMissionItems,
      ),
    },
    focus: {
      enabled: asBoolean(focus.enabled, base.focus.enabled),
      autoDetectStudy: asBoolean(
        focus.autoDetectStudy,
        base.focus.autoDetectStudy,
      ),
      breakReminders: asBoolean(focus.breakReminders, base.focus.breakReminders),
      breakAfterMinutes: asOption(
        focus.breakAfterMinutes,
        BREAK_AFTER_OPTIONS,
        base.focus.breakAfterMinutes,
      ),
      breakDurationMinutes: asOption(
        focus.breakDurationMinutes,
        BREAK_DURATION_OPTIONS,
        base.focus.breakDurationMinutes,
      ),
      idleTimeoutMinutes: asOption(
        focus.idleTimeoutMinutes,
        IDLE_TIMEOUT_OPTIONS,
        base.focus.idleTimeoutMinutes,
      ),
    },
    audio: {
      enabled: asBoolean(audio.enabled, base.audio.enabled),
      answerFeedbackSounds: asBoolean(
        audio.answerFeedbackSounds,
        base.audio.answerFeedbackSounds,
      ),
      missionCompletionSounds: asBoolean(
        audio.missionCompletionSounds,
        base.audio.missionCompletionSounds,
      ),
    },
    accessibility: {
      reducedMotion: asBoolean(
        accessibility.reducedMotion,
        base.accessibility.reducedMotion,
      ),
      animationIntensity: asEnum(
        accessibility.animationIntensity,
        ANIMATION_INTENSITY_OPTIONS,
        base.accessibility.animationIntensity,
      ),
    },
    gamification: {
      companionReactions: asBoolean(
        gamification.companionReactions,
        base.gamification.companionReactions,
      ),
      rewardAnimations: asBoolean(
        gamification.rewardAnimations,
        base.gamification.rewardAnimations,
      ),
      bitsAnimations: asBoolean(
        gamification.bitsAnimations,
        base.gamification.bitsAnimations,
      ),
    },
  };

  // Schema v1 defaulted Focus auto-detection off. Adopt the new default for
  // existing installs; an explicit choice made under v2 is preserved.
  if (storedVersion < 2) {
    parsed.focus.autoDetectStudy = true;
  }

  return parsed;
}

/**
 * Reads preferences from storage without touching the live store.
 *
 * Exposed so callers (and tests) can verify what a page reload would restore.
 */
export function readStoredPreferences(): UserPreferences {
  try {
    const raw = window.localStorage.getItem(USER_PREFERENCES_KEY);
    if (raw) {
      return parsePreferences(JSON.parse(raw));
    }
    // First run after the upgrade: carry over the legacy mute choice.
    if (window.localStorage.getItem(LEGACY_MUTE_KEY) === "true") {
      const migrated = defaultPreferences();
      migrated.audio.enabled = false;
      return migrated;
    }
    return defaultPreferences();
  } catch {
    // Corrupted or unavailable storage must never break rendering.
    return defaultPreferences();
  }
}

function writeStored(next: UserPreferences): void {
  try {
    window.localStorage.setItem(
      USER_PREFERENCES_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, ...next }),
    );
  } catch {
    // Storage can be unavailable (private mode, quota); in-memory applies.
  }
}

let preferences: UserPreferences = readStoredPreferences();
const listeners = new Set<() => void>();

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

/** The current preferences. Stable reference until an update occurs. */
export function getPreferences(): UserPreferences {
  return preferences;
}

/** A partial update; each section is merged into the current value. */
export type PreferencesPatch = {
  [K in keyof UserPreferences]?: Partial<UserPreferences[K]>;
};

/** Applies a partial update, persists it, and notifies subscribers. */
export function updatePreferences(patch: PreferencesPatch): UserPreferences {
  preferences = {
    study: { ...preferences.study, ...patch.study },
    focus: { ...preferences.focus, ...patch.focus },
    audio: { ...preferences.audio, ...patch.audio },
    accessibility: { ...preferences.accessibility, ...patch.accessibility },
    gamification: { ...preferences.gamification, ...patch.gamification },
  };
  writeStored(preferences);
  emit();
  return preferences;
}

/**
 * Resets Personal Settings only.
 *
 * Learning progress, Daily Missions, Bits, and account data live elsewhere and
 * are intentionally untouched. The storage key is removed so the next load
 * falls back to defaults.
 */
export function resetPreferences(): UserPreferences {
  preferences = defaultPreferences();
  try {
    window.localStorage.removeItem(USER_PREFERENCES_KEY);
  } catch {
    // Ignore unavailable storage.
  }
  emit();
  return preferences;
}

/** React binding for the full preference model. */
export function useUserPreferences(): UserPreferences {
  return useSyncExternalStore(subscribe, getPreferences, getPreferences);
}

/** Whether the learner's explicit accessibility choices reduce motion. */
export function prefersReducedMotionPreference(): boolean {
  const accessibility = preferences.accessibility;
  return accessibility.reducedMotion || accessibility.animationIntensity !== "full";
}

/** Whether Bits movement/count-up animations are enabled. */
export function bitsAnimationsEnabled(): boolean {
  return preferences.gamification.bitsAnimations;
}
