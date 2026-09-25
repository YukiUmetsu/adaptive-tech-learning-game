/**
 * Defense (tower) model.
 *
 * A defense represents a real security control. `power` is damage per second
 * applied while an attack is inside the control's `range` along its path — the
 * tower-defense abstraction of continuously filtering traffic. `effectiveness`
 * is a 0..1 multiplier per attack type. Non-blocking controls (least privilege,
 * backup, detection) express their effect through `damageReduction`,
 * `restoreAmount`, `revealHidden`, and `auraBonus`.
 *
 * See spec sections 9 and 17.
 */

import type { AttackType } from "./attack";
import type { NodeType } from "./map";

export type DefenseCategory =
  | "edge"
  | "network"
  | "application"
  | "identity"
  | "detection"
  | "recovery";

/** How a defense affects an attack. Drives UI copy and engine behaviour. */
export type DefenseKind = "blocking" | "mitigation" | "detection" | "recovery";

export interface DefenseDefinition {
  id: string;
  name: string;
  category: DefenseCategory;
  kind: DefenseKind;
  description: string;

  /** Mission-local credit cost for the first level. */
  cost: number;
  /** Added latency while deployed, in milliseconds. */
  latencyMs: number;
  /** Node types this control may be placed on. */
  allowedPlacements: NodeType[];

  /** Base damage per second while an attack is in range. */
  power: number;
  /** Extra damage per second per upgrade level above 1. */
  powerPerLevel: number;
  /** Additional latency per upgrade level above 1. */
  latencyPerLevelMs: number;

  /**
   * Coverage radius in path segments, measured along the attack path from the
   * control's node. 1.0 reaches the next node on the path.
   */
  range: number;
  /** Visual fire cadence, in milliseconds. */
  fireIntervalMs: number;

  /** 0 = ineffective, 1 = extremely effective. Missing entries mean 0. */
  effectiveness: Partial<Record<AttackType, number>>;

  maxLevel: number;

  /** Optional one-time cost to reach level 2 (defaults to 60% of base cost). */
  upgradeCost?: number;

  /** Mitigation controls: fraction of system damage removed (0..1). */
  damageReduction?: number;
  /** Recovery controls: one-time system health restored below the threshold. */
  restoreAmount?: number;
  /** Detection controls: reveals hidden attack types. */
  revealHidden?: boolean;
  /** Detection controls: small global effectiveness bonus (0..1). */
  auraBonus?: number;

  /** Whether the Security Engineer hero ability can boost this control. */
  heroBoostable?: boolean;

  /** Gates span the road and occupy a paired pad on the opposite side. */
  requiresGate?: boolean;

  /** Visual projectile style for firing controls. */
  projectile?: "beam" | "cannon" | "bomb";

  /**
   * Support controls boost another control. When an attack's path passes this
   * control before the target control, the target's damage is multiplied.
   */
  supportTargetId?: string;
  supportMultiplier?: number;

  /** Emoji/glyph shown on the tower emblem. */
  icon: string;
  /** Accent colour for the tower and its effects. */
  color: string;
}

/** A defense the player has placed on a node. */
export interface PlacedDefense {
  id: string;
  defenseId: string;
  nodeId: string;
  /** Build pad the tower occupies, when placed on a specific pad. */
  padId?: string;
  level: number;
  /** True when this control spans the road as a gate. */
  gate?: boolean;
  /** Road position of the gate, for congestion. */
  gatePosition?: number;
  /** The paired pad on the other side of the road. */
  gatePartnerPadId?: string;
}

export const DEFENSE_CATEGORY_LABELS: Record<DefenseCategory, string> = {
  edge: "Edge",
  network: "Network",
  application: "Application",
  identity: "Identity",
  detection: "Detection",
  recovery: "Recovery",
};

/** Scaled stats for a placed defense at its current level. */
export interface DefenseStats {
  /** Damage per second while an attack is in range. */
  power: number;
  latencyMs: number;
  range: number;
  fireIntervalMs: number;
}

/** Resolves the effective stats of a defense at a given level. */
export function defenseStatsAtLevel(
  defense: DefenseDefinition,
  level: number,
): DefenseStats {
  const safeLevel = Math.max(1, Math.min(level, defense.maxLevel));
  const steps = safeLevel - 1;
  return {
    power: defense.power + defense.powerPerLevel * steps,
    latencyMs: defense.latencyMs + defense.latencyPerLevelMs * steps,
    range: defense.range,
    fireIntervalMs: defense.fireIntervalMs,
  };
}

/** Cost to place a fresh level-1 defense. */
export function placeCost(defense: DefenseDefinition): number {
  return defense.cost;
}

/** Cost to upgrade from `level` to `level + 1`. */
export function upgradeCost(defense: DefenseDefinition, level: number): number {
  if (level >= defense.maxLevel) {
    return 0;
  }
  const scale = level === 0 ? 1 : level;
  return defense.upgradeCost ?? Math.round(defense.cost * 0.6 * scale);
}

/** Small persistent-Bits cost to upgrade a deployed control, in-mission only. */
export function upgradeBitsCost(_defense: DefenseDefinition, level: number): number {
  return level <= 1 ? 15 : 25;
}

/** Effectiveness of a defense against one attack type (0 when unlisted). */
export function effectivenessFor(
  defense: DefenseDefinition,
  attackType: AttackType,
): number {
  return defense.effectiveness[attackType] ?? 0;
}
