import type { AttackType } from "../models/attack";
import {
  defenseStatsAtLevel,
  effectivenessFor,
  placeCost,
  type DefenseDefinition,
  type PlacedDefense,
} from "../models/defense";
import type { NodeType } from "../models/map";
import type { SynergyDefinition } from "../models/mission";
import type { GameCatalog } from "../data";

/**
 * Pure combat / economy calculations.
 *
 * Everything here is a side-effect-free function so it can be unit tested
 * without a running simulation (spec section 46.8). The simulation module calls
 * these; UI components never do their own math.
 */

export interface PlacementCheck {
  ok: boolean;
  /** Short, learner-facing explanation when placement is rejected. */
  reason?: string;
}

/** Sum of deployment costs for all currently placed defenses. */
export function computeSpentBudget(
  placed: PlacedDefense[],
  catalog: GameCatalog,
): number {
  let total = 0;
  for (const item of placed) {
    const defense = catalog.defensesById[item.defenseId];
    if (!defense) {
      continue;
    }
    total += placeCost(defense);
  }
  return total;
}

/** Total added latency from all deployed defenses. */
export function computeLatencyMs(
  placed: PlacedDefense[],
  catalog: GameCatalog,
): number {
  let total = 0;
  for (const item of placed) {
    const defense = catalog.defensesById[item.defenseId];
    if (!defense) {
      continue;
    }
    total += defenseStatsAtLevel(defense, item.level).latencyMs;
  }
  return total;
}

/** Whether a defense may be placed on a node of the given type. */
export function canPlaceDefense(
  defense: DefenseDefinition,
  nodeType: NodeType,
): PlacementCheck {
  if (defense.allowedPlacements.includes(nodeType)) {
    return { ok: true };
  }
  return { ok: false, reason: placementExplanation(defense, nodeType) };
}

/**
 * Educational explanation shown when a defense is dropped on the wrong node.
 * Example: "Parameterized Queries belong in the application/database access
 * layer." (spec section 14).
 */
export function placementExplanation(
  defense: DefenseDefinition,
  nodeType: NodeType,
): string {
  const allowed = defense.allowedPlacements
    .map((type) => nodeTypeLabel(type))
    .join(" or ");
  switch (defense.id) {
    case "parameterized_queries":
      return "Parameterized Queries belong in the application/database access layer, where queries are built.";
    case "waf":
      return `A WAF filters HTTP traffic at the ${allowed} layer, not at the ${nodeTypeLabel(nodeType)}.`;
    case "traffic_blocker":
      return "A Traffic Blocker belongs at the edge or API, and hits far harder with a Traffic Analyzer before it.";
    case "traffic_analyzer":
      return "A Traffic Analyzer belongs at the edge or API, ahead of the Traffic Blocker it boosts.";
    case "mfa":
      return "MFA protects the identity/application layer where sign-in happens.";
    case "backup":
      return "Backup restores application or database data, so it belongs there.";
    case "monitoring":
      return "Monitoring observes traffic at the edge, API, or application layer.";
    case "least_privilege":
      return "Least Privilege is applied at identity, application, or database boundaries.";
    case "rate_limiter":
      return "A rate limiter sits at the edge, API, or identity layer where requests arrive.";
    case "input_validation":
      return "Input validation happens where input is parsed: the API or application.";
    case "xss_protection":
      return "XSS protection belongs where responses are rendered: the application or API.";
    default:
      return `${defense.name} can only be placed on: ${allowed}.`;
  }
}

function nodeTypeLabel(type: NodeType): string {
  switch (type) {
    case "edge":
      return "Edge";
    case "auth":
      return "Identity";
    case "api":
      return "API";
    case "application":
      return "Application";
    case "database":
      return "Database";
    case "ai":
      return "AI";
    case "tool":
      return "Tool";
  }
}

/** Synergies whose requirements are all currently deployed. */
export function activeSynergies(
  placedDefenseIds: Iterable<string>,
  synergies: SynergyDefinition[],
): SynergyDefinition[] {
  const deployed = new Set(placedDefenseIds);
  return synergies.filter((synergy) =>
    synergy.defenseIds.every((id) => deployed.has(id)),
  );
}

/** Global aura bonus from detection controls (Monitoring / IDS). */
export function auraBonus(placed: PlacedDefense[], catalog: GameCatalog): number {
  let best = 0;
  for (const item of placed) {
    const defense = catalog.defensesById[item.defenseId];
    if (defense?.auraBonus) {
      best = Math.max(best, defense.auraBonus);
    }
  }
  return best;
}

/** Whether any deployed control reveals hidden attacks. */
export function hasDetection(
  placed: PlacedDefense[],
  catalog: GameCatalog,
): boolean {
  return placed.some(
    (item) => catalog.defensesById[item.defenseId]?.revealHidden === true,
  );
}

/** Extra damage multiplier against one attack type from synergies. */
export function synergyDamageBonus(
  attackType: AttackType,
  synergies: SynergyDefinition[],
): number {
  let bonus = 0;
  for (const synergy of synergies) {
    if (!synergy.damageBonus) {
      continue;
    }
    if (!synergy.attackType || synergy.attackType === attackType) {
      bonus += synergy.damageBonus;
    }
  }
  return bonus;
}

/**
 * Whether an attack at path position `position` is inside a control's coverage.
 *
 * Coverage is measured in path segments: a control on a node at path index `d`
 * reaches attacks whose path position is within `range` of `d`.
 */
export function coverageContains(
  position: number,
  nodeIndex: number,
  range: number,
): boolean {
  return range > 0 && Math.abs(position - nodeIndex) <= range;
}

export interface MitigationOptions {
  /** Aura bonus from detection controls (0..1). */
  auraBonus?: number;
  /** Extra multiplier from active synergies (0..1). */
  synergyBonus?: number;
  /** Hero effectiveness boost (0..1). */
  heroBoost?: number;
  /** Flat multiplier from a support control (e.g. Traffic Analyzer ×5). */
  supportMultiplier?: number;
}

/**
 * Damage per second a deployed defense deals to an attack while it is in range.
 * Returns 0 when the defense is ineffective against the attack type.
 */
export function damagePerSecond(
  defense: DefenseDefinition,
  level: number,
  attackType: AttackType,
  options: MitigationOptions = {},
): number {
  const effectiveness = effectivenessFor(defense, attackType);
  if (effectiveness <= 0) {
    return 0;
  }
  const { power } = defenseStatsAtLevel(defense, level);
  const multiplier =
    (1 + (options.auraBonus ?? 0) + (options.synergyBonus ?? 0) + (options.heroBoost ?? 0)) *
    (options.supportMultiplier ?? 1);
  return power * effectiveness * multiplier;
}

export interface DamageReductionOptions {
  /** From an active SRE "Emergency Scale" ability (0..1). */
  heroReduction?: number;
}

/**
 * Fraction of incoming system damage removed by mitigation controls and
 * synergies for a given attack type. Always capped below 1 so an attack that
 * lands still matters.
 */
export function systemDamageReduction(
  attackType: AttackType,
  placed: PlacedDefense[],
  catalog: GameCatalog,
  options: DamageReductionOptions = {},
): number {
  let reduction = 0;
  for (const item of placed) {
    const defense = catalog.defensesById[item.defenseId];
    if (defense?.damageReduction) {
      reduction += defense.damageReduction;
    }
  }
  const defenseIds = placed.map((item) => item.defenseId);
  for (const synergy of activeSynergies(defenseIds, catalog.synergies)) {
    if (
      synergy.damageReductionBonus &&
      (!synergy.attackType || synergy.attackType === attackType)
    ) {
      reduction += synergy.damageReductionBonus;
    }
  }
  reduction += options.heroReduction ?? 0;
  return Math.min(0.9, Math.max(0, reduction));
}

/**
 * Damage an attack deals to system health when it reaches its target.
 *
 * Scales with the attack's remaining health, so partial mitigation still
 * reduces the hit (spec section 17).
 */
export function leakedSystemDamage(
  baseDamage: number,
  remainingHealthFraction: number,
  reduction: number,
): number {
  if (baseDamage <= 0) {
    return 0;
  }
  const raw = baseDamage * Math.max(0, Math.min(1, remainingHealthFraction));
  return Math.max(1, Math.round(raw * (1 - reduction)));
}

export interface MissionOutcome {
  completed: boolean;
  health: number;
  maxHealth: number;
  latencyMs: number;
  latencyTargetMs: number;
  spent: number;
  recommendedSpend: number;
}

export interface MissionRatingResult {
  stars: number;
  survived: boolean;
  latencyOk: boolean;
  budgetOk: boolean;
}

/** 1–3 star rating (spec section 25). A failed mission earns 0 stars. */
export function rateMission(outcome: MissionOutcome): MissionRatingResult {
  const survived = outcome.completed && outcome.health > 0;
  const latencyOk = outcome.latencyMs <= outcome.latencyTargetMs;
  const budgetOk = outcome.spent <= outcome.recommendedSpend;
  const stars =
    (survived ? 1 : 0) + (survived && latencyOk ? 1 : 0) + (survived && budgetOk ? 1 : 0);
  return { stars, survived, latencyOk, budgetOk };
}

const BITS_BY_STARS = [0, 20, 40, 60];

/**
 * Bits preview for a mission result.
 *
 * This is a *preview only*: persistent Bits are server-authoritative and this
 * function never mutates the wallet (spec sections 30 and 43).
 */
export function previewBitsForStars(stars: number): number {
  return BITS_BY_STARS[Math.max(0, Math.min(3, stars))];
}
