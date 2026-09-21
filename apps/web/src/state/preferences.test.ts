import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  USER_PREFERENCES_KEY,
  defaultPreferences,
  getPreferences,
  parsePreferences,
  readStoredPreferences,
  resetPreferences,
  updatePreferences,
  useUserPreferences,
} from "./preferences";

beforeEach(() => {
  window.localStorage.clear();
  resetPreferences();
});

describe("preferences parsing", () => {
  it("returns defaults for a missing or non-object payload", () => {
    expect(parsePreferences(null)).toEqual(defaultPreferences());
    expect(parsePreferences("nope")).toEqual(defaultPreferences());
    expect(parsePreferences([1, 2, 3])).toEqual(defaultPreferences());
  });

  it("merges valid fields and ignores unknown ones", () => {
    const parsed = parsePreferences({
      version: 1,
      study: { dailyMissionMinutes: 25, mystery: true },
      audio: { enabled: false },
    });

    expect(parsed.study.dailyMissionMinutes).toBe(25);
    expect(parsed.study.studyBalance).toBe("balanced");
    expect(parsed.audio.enabled).toBe(false);
    expect(parsed.audio.answerFeedbackSounds).toBe(true);
  });

  it("falls back on wrong types and out-of-range choices", () => {
    const parsed = parsePreferences({
      study: { dailyMissionMinutes: 17, studyBalance: "chaotic" },
      focus: { breakAfterMinutes: "soon", enabled: "yes" },
      accessibility: { animationIntensity: "extreme" },
    });

    expect(parsed.study.dailyMissionMinutes).toBe(20);
    expect(parsed.study.studyBalance).toBe("balanced");
    expect(parsed.focus.breakAfterMinutes).toBe(25);
    expect(parsed.focus.enabled).toBe(defaultPreferences().focus.enabled);
    expect(parsed.accessibility.animationIntensity).toBe("full");
  });

  it("reads corrupted storage as defaults", () => {
    window.localStorage.setItem(USER_PREFERENCES_KEY, "{ not valid json");

    expect(readStoredPreferences()).toEqual(defaultPreferences());
  });

  it("restores persisted preferences on reload", () => {
    window.localStorage.setItem(
      USER_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        study: { dailyMissionMinutes: 30 },
        focus: { enabled: true, breakDurationMinutes: 10 },
      }),
    );

    const restored = readStoredPreferences();
    expect(restored.study.dailyMissionMinutes).toBe(30);
    expect(restored.focus.enabled).toBe(true);
    expect(restored.focus.breakDurationMinutes).toBe(10);
    // Unspecified fields fall back to defaults.
    expect(restored.audio.enabled).toBe(true);
  });

  it("migrates a legacy v1 payload to auto-detect study on", () => {
    window.localStorage.setItem(
      USER_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        focus: { enabled: true, autoDetectStudy: false },
      }),
    );

    expect(readStoredPreferences().focus.autoDetectStudy).toBe(true);
  });

  it("preserves an explicit auto-detect choice at the current schema", () => {
    updatePreferences({ focus: { autoDetectStudy: false } });

    expect(readStoredPreferences().focus.autoDetectStudy).toBe(false);
  });

  it("migrates the legacy mute key on first run", () => {
    window.localStorage.setItem("adaptive-learn.sound-muted", "true");

    expect(readStoredPreferences().audio.enabled).toBe(false);
  });
});

describe("preferences store", () => {
  it("persists updates and merges sections", () => {
    updatePreferences({ study: { studyBalance: "more_practice" } });
    updatePreferences({ focus: { enabled: true } });

    expect(getPreferences().study.studyBalance).toBe("more_practice");
    expect(getPreferences().focus.enabled).toBe(true);
    // The earlier update survives the later one.
    expect(readStoredPreferences().study.studyBalance).toBe("more_practice");
    expect(readStoredPreferences().focus.enabled).toBe(true);
  });

  it("stores Focus preferences", () => {
    updatePreferences({
      focus: {
        enabled: true,
        autoDetectStudy: true,
        breakAfterMinutes: 15,
      },
    });

    const stored = readStoredPreferences().focus;
    expect(stored.enabled).toBe(true);
    expect(stored.autoDetectStudy).toBe(true);
    expect(stored.breakAfterMinutes).toBe(15);
  });

  it("reset restores defaults and leaves unrelated state untouched", () => {
    window.localStorage.setItem("adaptive-learn.learning-progress", "keep-me");
    window.localStorage.setItem("adaptive-learn.bits-cache", "42");
    updatePreferences({ audio: { enabled: false }, study: { studyBalance: "more_learning" } });

    resetPreferences();

    expect(getPreferences()).toEqual(defaultPreferences());
    expect(window.localStorage.getItem(USER_PREFERENCES_KEY)).toBeNull();
    expect(window.localStorage.getItem("adaptive-learn.learning-progress")).toBe(
      "keep-me",
    );
    expect(window.localStorage.getItem("adaptive-learn.bits-cache")).toBe("42");
  });

  it("notifies hook subscribers", () => {
    const { result } = renderHook(() => useUserPreferences());
    expect(result.current.audio.enabled).toBe(true);

    act(() => {
      updatePreferences({ audio: { enabled: false } });
    });

    expect(result.current.audio.enabled).toBe(false);
  });
});
