/**
 * Mission, wave, and synergy models.
 *
 * All content is data-driven: adding an attack, defense, or mission should
 * mostly mean adding a definition in `src/game/data`, not touching components.
 * See spec sections 16, 18, and 33.
 */

import type { AttackType } from "./attack";
import type { MissionMap } from "./map";

export interface SpawnGroup {
  attackId: string;
  count: number;
  spawnIntervalMs: number;
  /** Optional delay before the first spawn of this group, in milliseconds. */
  delayMs?: number;
}

export interface WaveDefinition {
  groups: SpawnGroup[];
  /** Marks the final, boss-style wave for copy and audio cues. */
  boss?: boolean;
}

export interface SynergyDefinition {
  id: string;
  name: string;
  description: string;
  /** All of these defenses must be deployed for the synergy to be active. */
  defenseIds: string[];
  /** When set, the damage bonus only applies against this attack type. */
  attackType?: AttackType;
  /** Extra damage multiplier for affected defenses (0.1 = +10%). */
  damageBonus?: number;
  /** Extra system damage reduction against `attackType` (0.1 = -10%). */
  damageReductionBonus?: number;
}

/** One short, contextual architecture lesson shown in the postmortem. */
export interface MissionLessons {
  /** Shown on success. */
  completion: string;
  /** Optional per-attack notes when a specific attack caused the failure. */
  failure?: Partial<Record<AttackType, string>>;
}

export interface MissionDefinition {
  id: string;
  title: string;
  description: string;
  /** Threat list shown in the briefing. */
  threatSummary: string[];
  startingBudget: number;
  startingHealth: number;
  latencyTargetMs: number;
  /** Spending below this earns the budget star (defaults to startingBudget). */
  recommendedSpend?: number;
  /** Mission id that must be completed first, if any. */
  requiresMissionId?: string;

  /** Mission-local credits granted for clearing a wave (classic TD pacing). */
  waveClearBonus?: number;
  /** Extra credits per remaining second when calling the next wave early. */
  earlyCallBonusPerSecond?: number;

  map: MissionMap;
  availableDefenses: string[];
  availableHeroes: string[];

  waves: WaveDefinition[];

  lessons: MissionLessons;
}

/** Star threshold hints, kept simple and readable (spec section 25). */
export interface MissionRating {
  survived: boolean;
  latencyOk: boolean;
  budgetOk: boolean;
}
