import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FOCUS_STATE_KEY,
  getFocusView,
  keepGoing,
  pauseFocus,
  recordStudyActivity,
  resetFocusState,
  resumeFocus,
  restoreFocusState,
  startBreak,
  startFocus,
  startFocusRuntime,
  stopFocusRuntime,
} from "./focus";
import {
  getPreferences,
  resetPreferences,
  updatePreferences,
  type FocusPreferences,
} from "./preferences";

const T0 = new Date("2026-09-20T10:00:00").getTime();
const MINUTE = 60_000;

let visibility: "visible" | "hidden" = "visible";

function enableFocus(overrides: Partial<FocusPreferences> = {}): void {
  updatePreferences({
    focus: {
      enabled: true,
      autoDetectStudy: true,
      breakReminders: true,
      breakAfterMinutes: 25,
      breakDurationMinutes: 5,
      idleTimeoutMinutes: 5,
      ...overrides,
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  window.localStorage.clear();
  window.sessionStorage.clear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  resetPreferences();
  resetFocusState();
});

afterEach(() => {
  stopFocusRuntime();
  resetFocusState();
  vi.useRealTimers();
});

describe("focus core timer", () => {
  it("starts focusing on meaningful study activity", () => {
    enableFocus();
    recordStudyActivity("reveal");

    expect(getFocusView().state).toBe("focusing");
    expect(getFocusView().currentFocusMs).toBe(0);
  });

  it("does not reset current focus on repeated activity", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(2 * MINUTE);
    recordStudyActivity("reveal");

    expect(getFocusView().currentFocusMs).toBe(2 * MINUTE);
  });

  it("stops active accumulation on manual pause and resumes on demand", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(MINUTE);
    pauseFocus();

    expect(getFocusView().state).toBe("manually_paused");
    expect(getFocusView().currentFocusMs).toBe(0);
    expect(getFocusView().todayActiveMs).toBe(MINUTE);

    vi.advanceTimersByTime(3 * MINUTE);
    expect(getFocusView().todayActiveMs).toBe(MINUTE);

    resumeFocus();
    recordStudyActivity("question");
    expect(getFocusView().state).toBe("focusing");
    expect(getFocusView().currentFocusMs).toBe(0);
  });

  it("accumulates break time separately from study time", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(MINUTE);
    startBreak();

    expect(getFocusView().state).toBe("break");
    expect(getFocusView().currentFocusMs).toBe(0);
    expect(getFocusView().todayActiveMs).toBe(MINUTE);

    vi.advanceTimersByTime(30_000);
    expect(getFocusView().todayBreakMs).toBe(30_000);
    expect(getFocusView().todayActiveMs).toBe(MINUTE);
  });

  it("ends a break and resumes focus when studying restarts", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(MINUTE);
    startBreak(5);
    vi.advanceTimersByTime(45_000);

    recordStudyActivity("answer_submit");

    expect(getFocusView().state).toBe("focusing");
    expect(getFocusView().todayBreakMs).toBe(45_000);
    expect(getFocusView().currentFocusMs).toBe(0);
  });

  it("resets current focus after a real break", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(2 * MINUTE);

    startBreak(5);
    vi.advanceTimersByTime(MINUTE);
    resumeFocus();

    expect(getFocusView().state).toBe("focusing");
    expect(getFocusView().currentFocusMs).toBe(0);

    vi.advanceTimersByTime(30_000);
    expect(getFocusView().currentFocusMs).toBe(30_000);
    expect(getFocusView().todayActiveMs).toBe(2 * MINUTE + 30_000);
  });

  it("accumulates today across multiple focus periods", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(MINUTE);
    pauseFocus();
    resumeFocus();
    vi.advanceTimersByTime(MINUTE);

    expect(getFocusView().todayActiveMs).toBe(2 * MINUTE);
    expect(getFocusView().currentFocusMs).toBe(MINUTE);
  });
});

describe("focus automatic detection", () => {
  it("does not count time merely because the page is open", () => {
    enableFocus();
    vi.advanceTimersByTime(10 * MINUTE);

    expect(getFocusView().state).toBe("inactive");
    expect(getFocusView().todayActiveMs).toBe(0);
  });

  it("starts focus from knowledge-node, reveal, and question activity", () => {
    enableFocus();

    recordStudyActivity("knowledge_node");
    expect(getFocusView().state).toBe("focusing");
    pauseFocus();
    recordStudyActivity("reveal");
    expect(getFocusView().state).toBe("focusing");
    pauseFocus();
    recordStudyActivity("question");
    expect(getFocusView().state).toBe("focusing");
  });

  it("counts answer submission and mission-next as meaningful activity", () => {
    enableFocus();
    recordStudyActivity("answer_submit");
    expect(getFocusView().state).toBe("focusing");
    pauseFocus();
    recordStudyActivity("mission_next");
    expect(getFocusView().state).toBe("focusing");
  });
});

describe("focus idle handling", () => {
  it("transitions focusing to idle after the configured timeout", () => {
    enableFocus({ idleTimeoutMinutes: 1 });
    recordStudyActivity("reveal");

    vi.advanceTimersByTime(MINUTE);

    expect(getFocusView().state).toBe("idle");
  });

  it("stops active time at the exact idle cutoff, not the late callback", () => {
    enableFocus({ idleTimeoutMinutes: 1 });
    recordStudyActivity("reveal");

    // The callback is noticed four minutes late.
    vi.advanceTimersByTime(4 * MINUTE);

    expect(getFocusView().state).toBe("idle");
    expect(getFocusView().todayActiveMs).toBe(MINUTE);
  });

  it("does not count idle time", () => {
    enableFocus({ idleTimeoutMinutes: 1 });
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(10 * MINUTE);

    expect(getFocusView().todayActiveMs).toBe(MINUTE);

    recordStudyActivity("reveal");
    vi.advanceTimersByTime(30_000);
    expect(getFocusView().todayActiveMs).toBe(MINUTE + 30_000);
  });

  it("honours a changed idle timeout", () => {
    enableFocus({ idleTimeoutMinutes: 1 });
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(MINUTE);
    expect(getFocusView().state).toBe("idle");

    enableFocus({ idleTimeoutMinutes: 3 });
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(2 * MINUTE);
    expect(getFocusView().state).toBe("focusing");

    vi.advanceTimersByTime(MINUTE + 1000);
    expect(getFocusView().state).toBe("idle");
  });
});

function hideTab(): void {
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
}

function showTab(): void {
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("focus visibility handling", () => {
  it("does not count a long hidden-tab period", () => {
    enableFocus({ idleTimeoutMinutes: 1 });
    startFocusRuntime();
    recordStudyActivity("reveal");

    hideTab();
    vi.advanceTimersByTime(10 * MINUTE);
    showTab();

    expect(getFocusView().state).toBe("idle");
    expect(getFocusView().todayActiveMs).toBe(MINUTE);
  });

  it("does not add hidden time just by returning", () => {
    enableFocus({ idleTimeoutMinutes: 1 });
    startFocusRuntime();
    recordStudyActivity("reveal");

    hideTab();
    vi.advanceTimersByTime(10 * MINUTE);
    showTab();
    vi.advanceTimersByTime(10 * MINUTE);

    expect(getFocusView().todayActiveMs).toBe(MINUTE);
  });

  it("resumes on the next meaningful activity after returning", () => {
    enableFocus({ idleTimeoutMinutes: 1 });
    startFocusRuntime();
    recordStudyActivity("reveal");

    hideTab();
    vi.advanceTimersByTime(10 * MINUTE);
    showTab();
    recordStudyActivity("reveal");

    expect(getFocusView().state).toBe("focusing");
    expect(getFocusView().currentFocusMs).toBe(0);
    expect(getFocusView().todayActiveMs).toBe(MINUTE);
  });
});

describe("focus breaks", () => {
  it("respects the configured break duration", () => {
    enableFocus({ breakDurationMinutes: 5 });
    recordStudyActivity("reveal");
    startBreak();

    expect(getFocusView().breakRemainingMs).toBe(5 * MINUTE);
  });

  it("Resume now ends the break", () => {
    enableFocus();
    recordStudyActivity("reveal");
    startBreak(5);
    vi.advanceTimersByTime(MINUTE);

    resumeFocus();

    expect(getFocusView().state).toBe("focusing");
    expect(getFocusView().todayBreakMs).toBe(MINUTE);
  });

  it("does not start studying automatically when a break expires", () => {
    enableFocus({ breakDurationMinutes: 2 });
    recordStudyActivity("reveal");
    startBreak(2);

    vi.advanceTimersByTime(2 * MINUTE + 1000);

    expect(getFocusView().state).toBe("break_complete");
    expect(getFocusView().todayActiveMs).toBe(0);
  });

  it("resumes focus when study begins after a break expired", () => {
    enableFocus({ breakDurationMinutes: 2 });
    recordStudyActivity("reveal");
    startBreak(2);
    vi.advanceTimersByTime(5 * MINUTE);

    recordStudyActivity("reveal");

    expect(getFocusView().state).toBe("focusing");
    expect(getFocusView().todayBreakMs).toBe(2 * MINUTE);
  });
});

describe("focus break reminders", () => {
  it("suggests a break after the configured focus threshold", () => {
    enableFocus({
      breakReminders: true,
      breakAfterMinutes: 10,
      idleTimeoutMinutes: 10,
    });
    recordStudyActivity("reveal");
    vi.setSystemTime(T0 + 10 * MINUTE);

    expect(getFocusView().reminderDue).toBe(true);
    expect(getFocusView().nextBreakInMs).toBe(0);
  });

  it("suppresses reminders while breakReminders is off", () => {
    enableFocus({
      breakReminders: false,
      breakAfterMinutes: 10,
      idleTimeoutMinutes: 10,
    });
    recordStudyActivity("reveal");
    vi.setSystemTime(T0 + 10 * MINUTE);

    expect(getFocusView().reminderDue).toBe(false);
  });

  it("Keep going suppresses immediate repeat reminders", () => {
    enableFocus({
      breakReminders: true,
      breakAfterMinutes: 10,
      idleTimeoutMinutes: 30,
    });
    recordStudyActivity("reveal");
    vi.setSystemTime(T0 + 10 * MINUTE);
    expect(getFocusView().reminderDue).toBe(true);

    keepGoing();
    expect(getFocusView().reminderDue).toBe(false);

    vi.setSystemTime(T0 + 12 * MINUTE);
    expect(getFocusView().reminderDue).toBe(false);

    vi.setSystemTime(T0 + 21 * MINUTE);
    expect(getFocusView().reminderDue).toBe(true);
  });
});

describe("focus persistence", () => {
  it("restores today's totals after a refresh", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(2 * MINUTE);

    restoreFocusState();

    expect(getFocusView().state).toBe("focusing");
    expect(getFocusView().todayActiveMs).toBe(2 * MINUTE);
  });

  it("does not count long browser downtime", () => {
    enableFocus({ idleTimeoutMinutes: 1 });
    recordStudyActivity("reveal");

    // Two hours later, as if the browser was closed.
    vi.setSystemTime(T0 + 2 * 60 * MINUTE);
    restoreFocusState();

    const view = getFocusView();
    expect(view.state).toBe("idle");
    expect(view.todayActiveMs).toBe(MINUTE);
  });

  it("restores stale focusing state as idle", () => {
    enableFocus({ idleTimeoutMinutes: 1 });
    recordStudyActivity("reveal");
    vi.setSystemTime(T0 + 30 * MINUTE);
    restoreFocusState();

    expect(getFocusView().state).toBe("idle");
  });

  it("fails safely on malformed persisted state", () => {
    enableFocus();
    window.localStorage.setItem(FOCUS_STATE_KEY, "{ not valid json");

    restoreFocusState();

    expect(getFocusView().state).toBe("inactive");
    expect(getFocusView().todayActiveMs).toBe(0);
    // Preferences are untouched.
    expect(getPreferences().focus.enabled).toBe(true);
  });

  it("resets daily statistics at local-day rollover", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(2 * MINUTE);
    expect(getFocusView().todayActiveMs).toBe(2 * MINUTE);

    // Next local day: a restore (as after a refresh) resets daily statistics.
    vi.setSystemTime(new Date("2026-09-21T09:00:00").getTime());
    restoreFocusState();

    expect(getFocusView().state).toBe("inactive");
    expect(getFocusView().todayActiveMs).toBe(0);
    expect(getFocusView().todayBreakMs).toBe(0);
  });
});

describe("focus settings behaviour", () => {
  it("does not track while Focus is disabled", () => {
    updatePreferences({ focus: { enabled: false } });
    recordStudyActivity("reveal");

    expect(getFocusView().state).toBe("inactive");
    expect(getFocusView().todayActiveMs).toBe(0);
  });

  it("never throws when storage is unavailable", () => {
    enableFocus();
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    expect(() => recordStudyActivity("reveal")).not.toThrow();
    expect(() => startBreak()).not.toThrow();
    expect(() => pauseFocus()).not.toThrow();
    expect(() => keepGoing()).not.toThrow();

    setItem.mockRestore();
  });

  it("does not auto-start when autoDetectStudy is disabled", () => {
    enableFocus({ autoDetectStudy: false });
    recordStudyActivity("reveal");

    expect(getFocusView().state).toBe("inactive");
  });

  it("still allows a manual start when autoDetectStudy is disabled", () => {
    enableFocus({ autoDetectStudy: false });
    recordStudyActivity("reveal");
    expect(getFocusView().state).toBe("inactive");

    startFocus();

    expect(getFocusView().state).toBe("focusing");
  });
});
