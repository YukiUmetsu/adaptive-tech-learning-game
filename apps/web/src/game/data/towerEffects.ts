/**
 * Tower/HQ effects that change actual gameplay.
 *
 * The server owns the canonical room levels and reward math; this module turns
 * those levels into the run-time decisions the browser simulation and briefing
 * need. One pure place per effect keeps Tower-level checks out of JSX and keeps
 * the rules testable (Stage2.md step 7.3).
 */

import type { EmergencyRecovery } from "../models/mission";

/** Room levels keyed by room id (`soc`, `threat_intelligence`, ...). */
export type TowerProgress = Record<string, number>;

/** Resolves room levels from a profile's `tower_upgrades` rows. */
export function towerProgressFromUpgrades(
  rows: readonly { upgrade_id: string; level: number }[] | undefined,
): TowerProgress {
  const progress: TowerProgress = {};
  for (const row of rows ?? []) {
    progress[row.upgrade_id] = row.level;
  }
  return progress;
}

/** Structural shape of a frozen Operation tower snapshot. */
export interface OperationTowerLevels {
  soc_level: number;
  threat_intelligence_level: number;
  training_center_level: number;
  engineering_lab_level: number;
  resilience_center_level: number;
}

/**
 * Resolves room levels from a run's frozen progression snapshot.
 *
 * A run must use the levels captured when it was created, never the player's
 * current Tower state, so an upgrade in another tab cannot strengthen an
 * in-progress Operation (Stage2.md immutable runs).
 */
export function towerProgressFromSnapshot(
  tower: OperationTowerLevels | undefined,
): TowerProgress {
  if (!tower) {
    return {};
  }
  return {
    soc: tower.soc_level,
    threat_intelligence: tower.threat_intelligence_level,
    training_center: tower.training_center_level,
    engineering_lab: tower.engineering_lab_level,
    resilience_center: tower.resilience_center_level,
  };
}

/**
 * What an Operation briefing is allowed to reveal, derived only from Tower
 * progression. SOC gates wave detail; Threat Intelligence gates adversary,
 * modifier, and boss detail.
 */
export interface OperationIntelVisibility {
  /** Threat Intel Lv1: the adversary's specialty is known. */
  showAdversarySpecialty: boolean;
  /** Threat Intel Lv2+: how many modifiers may be shown (Infinity = all). */
  visibleModifierCount: number;
  /** Threat Intel Lv3: boss presence is known before deployment. */
  showBossPresence: boolean;
  /** SOC Lv2/3: how many upcoming waves may be described (0, 1, or 2). */
  visibleWaveCount: number;
  /** SOC Lv4: approximate wave intensity is known. */
  showWaveIntensity: boolean;
  /** SOC Lv4: exact threat counts are known. */
  showExactThreatCounts: boolean;
}

/** `Number.POSITIVE_INFINITY` used to mean "show every modifier". */
const ALL_MODIFIERS = Number.POSITIVE_INFINITY;

/** Derives the briefing's visibility from Tower progression. */
export function deriveOperationIntelVisibility(
  towerProgress: TowerProgress,
): OperationIntelVisibility {
  const soc = towerProgress.soc ?? 0;
  const threatIntel = towerProgress.threat_intelligence ?? 0;
  return {
    showAdversarySpecialty: threatIntel >= 1,
    visibleModifierCount:
      threatIntel >= 3 ? ALL_MODIFIERS : threatIntel >= 2 ? 1 : 0,
    showBossPresence: threatIntel >= 3,
    visibleWaveCount: soc >= 3 ? 2 : soc >= 2 ? 1 : 0,
    showWaveIntensity: soc >= 4,
    showExactThreatCounts: soc >= 4,
  };
}

/** Health fraction below which Resilience Center Lv2 triggers its one restore. */
export const RESILIENCE_TRIGGER_THRESHOLD = 0.25;
/** Fraction of maximum health the Resilience Center Lv2 restore returns. */
export const RESILIENCE_RESTORE_FRACTION = 0.1;

/**
 * Resilience Center Lv2 emergency recovery.
 *
 * Deliberately modest and once-per-Operation: it softens a bad moment without
 * making failure impossible. Returns `undefined` below level 2.
 */
export function resilienceEmergencyRecovery(
  towerProgress: TowerProgress,
): EmergencyRecovery | undefined {
  if ((towerProgress.resilience_center ?? 0) < 2) {
    return undefined;
  }
  return {
    threshold: RESILIENCE_TRIGGER_THRESHOLD,
    restoreFraction: RESILIENCE_RESTORE_FRACTION,
  };
}

/** Engineering Lab Lv1/2: how many defense substitutions are allowed. */
export function engineeringLabSwapAllowance(towerProgress: TowerProgress): number {
  const level = towerProgress.engineering_lab ?? 0;
  if (level >= 2) {
    return 2;
  }
  return level >= 1 ? 1 : 0;
}

/** Resilience Center Lv1: the postmortem gains breach/counter detail. */
export function resiliencePostmortemIntel(towerProgress: TowerProgress): boolean {
  return (towerProgress.resilience_center ?? 0) >= 1;
}
