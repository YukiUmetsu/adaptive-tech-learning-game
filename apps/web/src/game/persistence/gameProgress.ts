import { useSyncExternalStore } from "react";

import { GAME_CATALOG } from "../data";
import type { MissionDefinition } from "../models/mission";

/**
 * Cyber Defense local progress: which missions are completed, star ratings,
 * and which controls are unlocked.
 *
 * Unlocks are *horizontal* progression (spec section 20): a new defense or hero
 * is a new option, never a raw damage boost. Everything ships unlocked in the
 * MVP so the game works without platform integration; the shape leaves room for
 * learning-track unlocks later.
 *
 * Bits are deliberately absent: persistent currency is server-authoritative.
 */

const KEY = "adaptive-learn.cyber-defense.v1";

export interface MissionProgressEntry {
  completed: boolean;
  stars: number;
  bestHealth: number;
  attempts: number;
}

export interface GameProgress {
  unlockDefenses: string[];
  unlockHeroes: string[];
  missions: Record<string, MissionProgressEntry>;
}

/** Everything is unlocked by default for the MVP. */
export function defaultProgress(): GameProgress {
  return {
    unlockDefenses: GAME_CATALOG.defenses.map((defense) => defense.id),
    unlockHeroes: GAME_CATALOG.heroes.map((hero) => hero.id),
    missions: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const known = value.filter((item): item is string => typeof item === "string");
  // Always keep the default unlocks: MVP content must stay playable.
  return [...new Set([...fallback, ...known])];
}

function parseEntry(value: unknown): MissionProgressEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const completed = value.completed === true;
  const stars =
    typeof value.stars === "number" && Number.isFinite(value.stars)
      ? Math.max(0, Math.min(3, Math.floor(value.stars)))
      : 0;
  const bestHealth =
    typeof value.bestHealth === "number" && Number.isFinite(value.bestHealth)
      ? Math.max(0, value.bestHealth)
      : 0;
  const attempts =
    typeof value.attempts === "number" && Number.isFinite(value.attempts)
      ? Math.max(0, Math.floor(value.attempts))
      : 0;
  return { completed, stars, bestHealth, attempts };
}

/** Safely coerces arbitrary parsed JSON into a valid progress model. */
export function parseProgress(raw: unknown): GameProgress {
  const base = defaultProgress();
  if (!isRecord(raw)) {
    return base;
  }
  const missions: Record<string, MissionProgressEntry> = {};
  if (isRecord(raw.missions)) {
    for (const [missionId, entry] of Object.entries(raw.missions)) {
      const parsed = parseEntry(entry);
      if (parsed) {
        missions[missionId] = parsed;
      }
    }
  }
  return {
    unlockDefenses: stringArray(raw.unlockDefenses, base.unlockDefenses),
    unlockHeroes: stringArray(raw.unlockHeroes, base.unlockHeroes),
    missions,
  };
}

function readStored(): GameProgress {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? parseProgress(JSON.parse(raw)) : defaultProgress();
  } catch {
    return defaultProgress();
  }
}

function writeStored(progress: GameProgress): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Storage may be unavailable; in-memory progress still applies.
  }
}

let progress: GameProgress = readStored();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getGameProgress(): GameProgress {
  return progress;
}

/** Reads from storage without touching the live store (used by tests/reloads). */
export function readStoredProgress(): GameProgress {
  return readStored();
}

/**
 * Records a finished mission attempt, keeping the best stars and health.
 *
 * `completed` is monotonically true: once a mission is cleared it stays cleared.
 */
export function recordMissionResult(
  missionId: string,
  result: { completed: boolean; stars: number; health: number },
): GameProgress {
  const previous = progress.missions[missionId];
  const entry: MissionProgressEntry = {
    completed: result.completed || (previous?.completed ?? false),
    stars: Math.max(previous?.stars ?? 0, result.completed ? result.stars : 0),
    bestHealth: Math.max(
      previous?.bestHealth ?? 0,
      result.completed ? result.health : 0,
    ),
    attempts: (previous?.attempts ?? 0) + 1,
  };
  progress = {
    ...progress,
    missions: { ...progress.missions, [missionId]: entry },
  };
  writeStored(progress);
  emit();
  return progress;
}

export function resetGameProgress(): GameProgress {
  progress = defaultProgress();
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Ignore unavailable storage.
  }
  emit();
  return progress;
}

/** Whether a mission's prerequisites are met. */
export function isMissionUnlocked(
  mission: MissionDefinition,
  current: GameProgress = progress,
): boolean {
  if (!mission.requiresMissionId) {
    return true;
  }
  return current.missions[mission.requiresMissionId]?.completed === true;
}

export function isDefenseUnlocked(
  defenseId: string,
  current: GameProgress = progress,
): boolean {
  return current.unlockDefenses.includes(defenseId);
}

export function isHeroUnlocked(
  heroId: string,
  current: GameProgress = progress,
): boolean {
  return current.unlockHeroes.includes(heroId);
}

/** React binding for the progress model. */
export function useGameProgress(): GameProgress {
  return useSyncExternalStore(subscribe, getGameProgress, getGameProgress);
}
