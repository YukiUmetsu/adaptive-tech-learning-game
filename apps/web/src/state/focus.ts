import { useEffect, useState, useSyncExternalStore } from "react";

import { getPreferences, useUserPreferences } from "./preferences";

/**
 * Focus & Breaks time tracking (V1).
 *
 * A small, deterministic state machine that measures *active* study time from
 * wall-clock timestamps. It is productivity configuration, never learning
 * evidence: it does not touch concept state, rewards, Daily Missions, or Bits.
 *
 * Design rules:
 * - Timestamps are the source of truth; no per-second counter is persisted.
 * - Persistence happens at transitions, coarse checkpoints, and page lifecycle
 *   boundaries — never once per second.
 * - Only the floating widget re-renders each second; the rest of the app is
 *   untouched.
 * - Every public entry point is defensive: a Focus failure must never break
 *   learning, the app shell, or any quiz flow.
 */

/** Versioned local key. Focus data stays on the device in V1. */
export const FOCUS_STATE_KEY = "adaptive-learn.focus-state.v1";
const SCHEMA_VERSION = 1;
const MINUTE_MS = 60_000;

/** Coarse persistence cadence while a session is running. */
const CHECKPOINT_INTERVAL_MS = 30_000;

/**
 * After the learner chooses "Keep going", no new break suggestion appears until
 * this much additional active focus has accumulated.
 */
export const KEEP_GOING_COOLDOWN_MINUTES = 10;

/** Explicit, small state machine. */
export type FocusState =
  | "inactive"
  | "focusing"
  | "break"
  | "break_complete"
  | "idle"
  | "manually_paused";

const FOCUS_STATES: readonly FocusState[] = [
  "inactive",
  "focusing",
  "break",
  "break_complete",
  "idle",
  "manually_paused",
];

/** Semantic learning actions that count as meaningful study. */
export type StudyActivitySource =
  | "knowledge_node"
  | "reveal"
  | "table_reveal"
  | "code_annotation"
  | "question"
  | "answer_submit"
  | "mission_next"
  | "daily_mission"
  | "navigation";

/** Persisted shape. Enough to restore safely after refresh. */
export interface FocusPersistentState {
  version: number;
  /** Local (browser timezone) day key, `YYYY-MM-DD`. */
  dayKey: string;
  state: FocusState;
  /** Active study milliseconds settled for today, excluding the live period. */
  activeMsToday: number;
  /** Break milliseconds settled for today, excluding the live period. */
  breakMsToday: number;
  /** Start of the current continuous focus period, if focusing. */
  focusStartedAt: number | null;
  /** Start of the current explicit break, if on a break. */
  breakStartedAt: number | null;
  /** Configured end of the current explicit break. */
  breakEndsAt: number | null;
  /** Last meaningful activity timestamp. */
  lastActivityAt: number | null;
  /** Last time state was written to storage. */
  lastPersistedAt: number;
  /** Current-focus ms when the learner last chose "Keep going". */
  keptGoingFocusMs: number | null;
}

/** Live, derived view for the widget. Recomputed from timestamps on read. */
export interface FocusView {
  state: FocusState;
  todayActiveMs: number;
  currentFocusMs: number;
  todayBreakMs: number;
  breakRemainingMs: number;
  breakComplete: boolean;
  reminderDue: boolean;
  nextBreakInMs: number | null;
  lastActivityAt: number | null;
}

/** Local `YYYY-MM-DD` key, matching the rest of the app's display conventions. */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function asDuration(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function isFocusState(value: unknown): value is FocusState {
  return typeof value === "string" && FOCUS_STATES.includes(value as FocusState);
}

function freshFocusState(now: number): FocusPersistentState {
  return {
    version: SCHEMA_VERSION,
    dayKey: localDayKey(new Date(now)),
    state: "inactive",
    activeMsToday: 0,
    breakMsToday: 0,
    focusStartedAt: null,
    breakStartedAt: null,
    breakEndsAt: null,
    lastActivityAt: null,
    lastPersistedAt: now,
    keptGoingFocusMs: null,
  };
}

function idleTimeoutMs(): number {
  return getPreferences().focus.idleTimeoutMinutes * MINUTE_MS;
}

function breakDurationMs(): number {
  return getPreferences().focus.breakDurationMinutes * MINUTE_MS;
}

function breakAfterMs(): number {
  return getPreferences().focus.breakAfterMinutes * MINUTE_MS;
}

function focusEnabled(): boolean {
  try {
    return getPreferences().focus.enabled;
  } catch {
    return false;
  }
}

/** Safely coerces parsed JSON into a valid persisted state. */
export function parseFocusState(
  raw: unknown,
  now: number,
): FocusPersistentState {
  const base = freshFocusState(now);
  if (!isRecord(raw)) {
    return base;
  }
  return {
    version: SCHEMA_VERSION,
    dayKey: typeof raw.dayKey === "string" ? raw.dayKey : base.dayKey,
    state: isFocusState(raw.state) ? raw.state : "inactive",
    activeMsToday: asDuration(raw.activeMsToday),
    breakMsToday: asDuration(raw.breakMsToday),
    focusStartedAt: asTimestamp(raw.focusStartedAt),
    breakStartedAt: asTimestamp(raw.breakStartedAt),
    breakEndsAt: asTimestamp(raw.breakEndsAt),
    lastActivityAt: asTimestamp(raw.lastActivityAt),
    lastPersistedAt: asTimestamp(raw.lastPersistedAt) ?? now,
    keptGoingFocusMs: asTimestamp(raw.keptGoingFocusMs),
  };
}

/**
 * Reconciles a restored state with the current wall clock.
 *
 * Stale `focusing` state settles at the idle cutoff (never later), expired
 * breaks become `break_complete`, and a new local day resets daily statistics.
 */
export function reconcileRestoredFocusState(
  state: FocusPersistentState,
  now: number,
): FocusPersistentState {
  const next = { ...state };
  if (next.dayKey !== localDayKey(new Date(now))) {
    return freshFocusState(now);
  }

  if (next.state === "focusing") {
    if (next.focusStartedAt == null) {
      next.state = "idle";
      return next;
    }
    if (
      next.lastActivityAt != null &&
      now - next.lastActivityAt > idleTimeoutMs()
    ) {
      const cutoff = next.lastActivityAt + idleTimeoutMs();
      next.activeMsToday += Math.max(0, cutoff - next.focusStartedAt);
      next.state = "idle";
      next.focusStartedAt = null;
    }
    return next;
  }

  if (next.state === "break") {
    if (next.breakStartedAt == null) {
      next.state = "idle";
      next.breakStartedAt = null;
      next.breakEndsAt = null;
      return next;
    }
    const end = next.breakEndsAt ?? now;
    if (now >= end) {
      next.breakMsToday += Math.max(0, end - next.breakStartedAt);
      next.state = "break_complete";
      next.breakStartedAt = null;
      next.breakEndsAt = null;
    }
    return next;
  }

  if (next.state === "break_complete") {
    next.breakStartedAt = null;
    next.breakEndsAt = null;
  }
  return next;
}

/** Reads and reconciles Focus state from storage without touching the store. */
export function readStoredFocusState(): FocusPersistentState {
  const now = Date.now();
  try {
    const raw = window.localStorage.getItem(FOCUS_STATE_KEY);
    if (!raw) {
      return freshFocusState(now);
    }
    return reconcileRestoredFocusState(
      parseFocusState(JSON.parse(raw) as unknown, now),
      now,
    );
  } catch {
    // Corrupted storage resets only Focus; preferences and learning survive.
    return freshFocusState(now);
  }
}

let focusState: FocusPersistentState = readStoredFocusState();
let version = 0;
const listeners = new Set<() => void>();

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let breakTimer: ReturnType<typeof setTimeout> | null = null;
let checkpointTimer: ReturnType<typeof setInterval> | null = null;
let runtimeStarted = false;

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function persist(now: number): void {
  focusState.lastPersistedAt = now;
  try {
    window.localStorage.setItem(FOCUS_STATE_KEY, JSON.stringify(focusState));
  } catch {
    // Storage can be unavailable; tracking continues in memory.
  }
}

function clearTimers(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (breakTimer !== null) {
    clearTimeout(breakTimer);
    breakTimer = null;
  }
  if (checkpointTimer !== null) {
    clearInterval(checkpointTimer);
    checkpointTimer = null;
  }
}

/** Resets daily statistics when the local day changes. Returns whether it did. */
function ensureLocalDay(now: number): boolean {
  const key = localDayKey(new Date(now));
  if (key === focusState.dayKey) {
    return false;
  }
  focusState.dayKey = key;
  focusState.activeMsToday = 0;
  focusState.breakMsToday = 0;
  focusState.keptGoingFocusMs = null;
  if (focusState.state === "focusing") {
    // Reset the current focus duration but keep focusing.
    focusState.focusStartedAt = now;
    focusState.lastActivityAt = now;
  } else {
    focusState.focusStartedAt = null;
    focusState.lastActivityAt = null;
  }
  if (focusState.state === "break") {
    focusState.breakStartedAt = now;
    focusState.breakEndsAt = now + breakDurationMs();
  }
  return true;
}

function settleActiveUpTo(until: number): void {
  if (focusState.state === "focusing" && focusState.focusStartedAt != null) {
    focusState.activeMsToday += Math.max(0, until - focusState.focusStartedAt);
  }
  focusState.focusStartedAt = null;
}

function settleBreakUpTo(until: number): void {
  if (focusState.state === "break" && focusState.breakStartedAt != null) {
    const end =
      focusState.breakEndsAt != null
        ? Math.min(until, focusState.breakEndsAt)
        : until;
    focusState.breakMsToday += Math.max(0, end - focusState.breakStartedAt);
  }
  focusState.breakStartedAt = null;
  focusState.breakEndsAt = null;
}

function enterFocusing(now: number): void {
  focusState.state = "focusing";
  focusState.focusStartedAt = now;
  focusState.lastActivityAt = now;
  focusState.keptGoingFocusMs = null;
}

function enterIdle(now: number): void {
  const cutoff =
    focusState.lastActivityAt != null
      ? focusState.lastActivityAt + idleTimeoutMs()
      : now;
  settleActiveUpTo(Math.min(now, cutoff));
  focusState.state = "idle";
}

function enterManualPause(now: number): void {
  settleActiveUpTo(now);
  focusState.state = "manually_paused";
}

function enterBreak(now: number, minutes: number): void {
  if (focusState.state === "focusing") {
    settleActiveUpTo(now);
  }
  focusState.breakStartedAt = now;
  focusState.breakEndsAt = now + Math.max(1, minutes) * MINUTE_MS;
  focusState.state = "break";
  focusState.keptGoingFocusMs = null;
}

function finishBreak(now: number): void {
  const end = focusState.breakEndsAt ?? now;
  settleBreakUpTo(end);
  focusState.state = "break_complete";
}

function resumeIntoFocus(now: number): void {
  if (focusState.state === "break") {
    settleBreakUpTo(now);
  } else if (focusState.state === "break_complete") {
    focusState.breakStartedAt = null;
    focusState.breakEndsAt = null;
  }
  enterFocusing(now);
}

function scheduleIdle(now: number): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (
    !focusEnabled() ||
    focusState.state !== "focusing" ||
    focusState.lastActivityAt == null
  ) {
    return;
  }
  const dueIn = Math.max(0, focusState.lastActivityAt + idleTimeoutMs() - now);
  idleTimer = setTimeout(() => {
    const at = Date.now();
    if (ensureLocalDay(at)) {
      commit(at);
      return;
    }
    if (focusState.state === "focusing") {
      enterIdle(at);
      commit(at);
    }
  }, dueIn);
}

function scheduleBreak(now: number): void {
  if (breakTimer !== null) {
    clearTimeout(breakTimer);
    breakTimer = null;
  }
  if (
    !focusEnabled() ||
    focusState.state !== "break" ||
    focusState.breakEndsAt == null
  ) {
    return;
  }
  const dueIn = Math.max(0, focusState.breakEndsAt - now);
  breakTimer = setTimeout(() => {
    const at = Date.now();
    if (ensureLocalDay(at)) {
      commit(at);
      return;
    }
    if (focusState.state === "break") {
      finishBreak(at);
      commit(at);
    }
  }, dueIn);
}

function scheduleCheckpoint(now: number): void {
  if (checkpointTimer !== null) {
    clearInterval(checkpointTimer);
    checkpointTimer = null;
  }
  if (
    !focusEnabled() ||
    (focusState.state !== "focusing" && focusState.state !== "break")
  ) {
    return;
  }
  void now;
  checkpointTimer = setInterval(() => {
    const at = Date.now();
    if (ensureLocalDay(at)) {
      commit(at);
      return;
    }
    enforceIdleAndBreak(at);
    persist(at);
  }, CHECKPOINT_INTERVAL_MS);
}

/** Applies a transition: persist, notify subscribers, and reschedule timers. */
function commit(now: number): void {
  persist(now);
  emit();
  scheduleIdle(now);
  scheduleBreak(now);
  scheduleCheckpoint(now);
}

/**
 * Enforces idle and break boundaries against the wall clock.
 *
 * Catches up when a background tab's timers were throttled, settling at the
 * exact boundary rather than the late callback time.
 */
function enforceIdleAndBreak(now: number): void {
  if (!focusEnabled()) {
    return;
  }
  if (
    focusState.state === "focusing" &&
    focusState.lastActivityAt != null &&
    now - focusState.lastActivityAt >= idleTimeoutMs()
  ) {
    enterIdle(now);
    commit(now);
    return;
  }
  if (
    focusState.state === "break" &&
    focusState.breakEndsAt != null &&
    now >= focusState.breakEndsAt
  ) {
    finishBreak(now);
    commit(now);
  }
}

function currentFocusMs(now: number): number {
  if (focusState.state === "focusing" && focusState.focusStartedAt != null) {
    return Math.max(0, now - focusState.focusStartedAt);
  }
  return 0;
}

/**
 * Records a meaningful study action.
 *
 * While focusing this only refreshes the idle baseline (it never resets Current
 * focus). Otherwise it automatically starts or resumes Focus when
 * `autoDetectStudy` is enabled. Non-study interaction must never call this.
 */
export function recordStudyActivity(source?: StudyActivitySource): void {
  try {
    void source;
    if (!focusEnabled()) {
      return;
    }
    const now = Date.now();
    ensureLocalDay(now);

    if (focusState.state === "focusing") {
      focusState.lastActivityAt = now;
      scheduleIdle(now);
      return;
    }

    if (!getPreferences().focus.autoDetectStudy) {
      return;
    }

    switch (focusState.state) {
      case "break":
      case "break_complete":
        resumeIntoFocus(now);
        break;
      case "idle":
      case "inactive":
      case "manually_paused":
        enterFocusing(now);
        break;
      default:
        break;
    }
    commit(now);
  } catch {
    // Focus tracking is optional; never surface a failure to learning.
  }
}

/** Explicit learner start / resume. Always available while Focus is enabled. */
export function startFocus(): void {
  try {
    if (!focusEnabled()) {
      return;
    }
    const now = Date.now();
    ensureLocalDay(now);
    enterFocusing(now);
    commit(now);
  } catch {
    // ignore
  }
}

/** Manual pause. Stops active accumulation until the next resume. */
export function pauseFocus(): void {
  try {
    if (!focusEnabled()) {
      return;
    }
    const now = Date.now();
    ensureLocalDay(now);
    if (focusState.state !== "focusing") {
      return;
    }
    enterManualPause(now);
    commit(now);
  } catch {
    // ignore
  }
}

/** Manual resume from a pause, idle, break, or completed break. */
export function resumeFocus(): void {
  try {
    if (!focusEnabled()) {
      return;
    }
    const now = Date.now();
    ensureLocalDay(now);
    resumeIntoFocus(now);
    commit(now);
  } catch {
    // ignore
  }
}

/** Begins an explicit break, defaulting to the configured duration. */
export function startBreak(minutes?: number): void {
  try {
    if (!focusEnabled()) {
      return;
    }
    const now = Date.now();
    ensureLocalDay(now);
    const duration = minutes ?? getPreferences().focus.breakDurationMinutes;
    enterBreak(now, duration);
    commit(now);
  } catch {
    // ignore
  }
}

/** Suppresses the next break suggestion for the cooldown window. */
export function keepGoing(): void {
  try {
    if (!focusEnabled()) {
      return;
    }
    const now = Date.now();
    focusState.keptGoingFocusMs = currentFocusMs(now);
    persist(now);
    emit();
  } catch {
    // ignore
  }
}

/** Settles any boundary that has already passed. Safe to call from a tick. */
export function focusTick(): void {
  try {
    if (!focusEnabled()) {
      return;
    }
    const now = Date.now();
    if (ensureLocalDay(now)) {
      commit(now);
      return;
    }
    enforceIdleAndBreak(now);
  } catch {
    // ignore
  }
}

function onVisibilityChange(): void {
  try {
    if (!focusEnabled()) {
      return;
    }
    const now = Date.now();
    if (document.visibilityState === "hidden") {
      // Preserve state without splitting the session; the idle timer will
      // settle an over-long hidden period at the correct cutoff.
      persist(now);
      return;
    }
    // Returning to the tab never counts hidden time and never auto-resumes;
    // the learner's next meaningful action resumes Focus.
    if (ensureLocalDay(now)) {
      commit(now);
      return;
    }
    enforceIdleAndBreak(now);
  } catch {
    // ignore
  }
}

function onPageHide(): void {
  try {
    if (focusEnabled()) {
      persist(Date.now());
    }
  } catch {
    // ignore
  }
}

/** Attaches lifecycle listeners and starts scheduling. Idempotent. */
export function startFocusRuntime(): void {
  if (runtimeStarted) {
    return;
  }
  runtimeStarted = true;
  try {
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
  } catch {
    // Non-browser test environment; timers still work.
  }
  syncFocusRuntime();
}

/** Detaches lifecycle listeners and clears timers. */
export function stopFocusRuntime(): void {
  runtimeStarted = false;
  try {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
  } catch {
    // ignore
  }
  clearTimers();
}

/**
 * Applies the latest preferences to the running engine.
 *
 * When Focus is disabled the current period is settled and the engine stops;
 * re-enabling starts fresh. Call from a preferences subscription.
 */
export function syncFocusRuntime(): void {
  try {
    const now = Date.now();
    if (!focusEnabled()) {
      clearTimers();
      const wasRunning =
        focusState.state === "focusing" ||
        focusState.state === "break" ||
        focusState.state === "break_complete";
      if (focusState.state === "focusing") {
        settleActiveUpTo(now);
      } else if (focusState.state === "break") {
        settleBreakUpTo(now);
      }
      focusState.state = "inactive";
      if (wasRunning) {
        persist(now);
        emit();
      }
      return;
    }
    if (ensureLocalDay(now)) {
      commit(now);
      return;
    }
    enforceIdleAndBreak(now);
    scheduleIdle(now);
    scheduleBreak(now);
    scheduleCheckpoint(now);
  } catch {
    // ignore
  }
}

function buildView(): FocusView {
  const now = Date.now();
  const preferences = getPreferences();
  let todayActiveMs = focusState.activeMsToday;
  let currentFocus = 0;
  if (focusState.state === "focusing" && focusState.focusStartedAt != null) {
    currentFocus = Math.max(0, now - focusState.focusStartedAt);
    todayActiveMs += currentFocus;
  }

  let todayBreakMs = focusState.breakMsToday;
  let breakRemainingMs = 0;
  let breakComplete = false;
  if (focusState.state === "break" && focusState.breakStartedAt != null) {
    const end =
      focusState.breakEndsAt != null
        ? Math.min(now, focusState.breakEndsAt)
        : now;
    todayBreakMs += Math.max(0, end - focusState.breakStartedAt);
    breakRemainingMs =
      focusState.breakEndsAt != null
        ? Math.max(0, focusState.breakEndsAt - now)
        : 0;
    breakComplete = breakRemainingMs === 0;
  } else if (focusState.state === "break_complete") {
    breakComplete = true;
  }

  const threshold = breakAfterMs();
  const cooldown = KEEP_GOING_COOLDOWN_MINUTES * MINUTE_MS;
  const reminderDue =
    preferences.focus.breakReminders &&
    focusState.state === "focusing" &&
    currentFocus >= threshold &&
    (focusState.keptGoingFocusMs == null ||
      currentFocus - focusState.keptGoingFocusMs >= cooldown);

  return {
    state: focusState.state,
    todayActiveMs,
    currentFocusMs: currentFocus,
    todayBreakMs,
    breakRemainingMs,
    breakComplete,
    reminderDue,
    nextBreakInMs:
      focusState.state === "focusing"
        ? Math.max(0, threshold - currentFocus)
        : null,
    lastActivityAt: focusState.lastActivityAt,
  };
}

/** Current derived view. Pure read of the live state. */
export function getFocusView(): FocusView {
  return buildView();
}

export function subscribeFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFocusVersion(): number {
  return version;
}

/** React binding for the floating widget. Ticks locally once per second. */
export function useFocus(): FocusView {
  const preferences = useUserPreferences();
  useSyncExternalStore(subscribeFocus, getFocusVersion, getFocusVersion);
  const [, forceRender] = useState(0);
  const enabled = preferences.focus.enabled;
  const view = buildView();
  const ticking =
    enabled && (view.state === "focusing" || view.state === "break");

  useEffect(() => {
    if (!ticking) {
      return;
    }
    const id = window.setInterval(() => {
      focusTick();
      forceRender((count) => count + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  return view;
}

/**
 * Resets Focus state only. Used by tests and the defensive restore path; never
 * touches preferences, learning progress, Daily Missions, or Bits.
 */
export function resetFocusState(): void {
  stopFocusRuntime();
  clearTimers();
  try {
    window.localStorage.removeItem(FOCUS_STATE_KEY);
  } catch {
    // ignore
  }
  focusState = freshFocusState(Date.now());
  emit();
}

/** Re-reads Focus state from storage into the live store (tests/refresh). */
export function restoreFocusState(): FocusPersistentState {
  focusState = readStoredFocusState();
  emit();
  return focusState;
}
