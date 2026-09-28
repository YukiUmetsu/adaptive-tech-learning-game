/**
 * Hero model.
 *
 * Heroes are emergency fighters: deploy one onto the road (drag/tap) and it
 * attacks nearby attacks for a short time while projecting its aura, then goes
 * on cooldown. Heroes never replace good architecture. See spec section 19.
 */

export type HeroKind =
  /** Security Engineer: temporarily hardens active controls. */
  | "effectiveness_boost"
  /** SRE: temporarily absorbs incoming system damage (capacity). */
  | "damage_reduction";

export interface HeroDefinition {
  id: string;
  name: string;
  abilityName: string;
  description: string;
  kind: HeroKind;
  /** Time before the hero can be deployed again. */
  cooldownMs: number;
  /** How long the deployed hero fights before leaving the road. */
  durationMs: number;
  /**
   * effectiveness_boost: extra multiplier added to defense damage (0.4 = +40%).
   * damage_reduction: fraction of incoming system damage absorbed (0.5 = -50%).
   */
  magnitude: number;
  /** Required by the spec: heroes never replace good architecture. */
  /** Damage dealt per melee hit (strong, discrete). */
  attackDamage: number;
  /** Time between hits, in milliseconds (slow, so sustained dps stays low). */
  attackIntervalMs: number;
  /** Very short reach along the road, in path segments (physical/melee). */
  attackRange: number;
  /** Accent colour for the hero and its effects. */
  color: string;
}

/** Cooldown state for a hero during a mission. */
export interface HeroRuntime {
  heroId: string;
  cooldownRemainingMs: number;
}

/** A hero currently deployed on the road. */
export interface HeroUnit {
  id: string;
  heroId: string;
  /** Position along the attacked path (edge index + progress). */
  position: number;
  /**
   * The graph edge the hero stands on, when deployed onto a branching map.
   *
   * The simulation is graph-aware: a hero anchored to an edge only fights
   * attacks whose logical path traverses that same edge, so a hero on the
   * Application branch never reaches an API-only attack. Legacy/campaign units
   * without an anchor fall back to the numeric path position.
   */
  anchor?: { from: string; to: string; fraction: number };
  /** Time left on the road. */
  ttlMs: number;
  /** Time until the next melee hit. */
  attackCooldownMs: number;
}

export const HERO_ROLES: Record<HeroKind, string> = {
  effectiveness_boost: "Hardens active controls",
  damage_reduction: "Absorbs incoming damage",
};

/**
 * Multiplicative talent modifiers applied to a hero's base runtime stats.
 *
 * Values are conservative (Stage2.md step 8.3): a talent specializes a hero, it
 * never doubles its power.
 */
export interface HeroRuntimeModifiers {
  cooldownMultiplier: number;
  durationMultiplier: number;
  magnitudeMultiplier: number;
  attackDamageMultiplier: number;
  attackIntervalMultiplier: number;
}

/** Neutral modifiers, used when no talent is selected. */
export const NEUTRAL_HERO_MODIFIERS: HeroRuntimeModifiers = {
  cooldownMultiplier: 1,
  durationMultiplier: 1,
  magnitudeMultiplier: 1,
  attackDamageMultiplier: 1,
  attackIntervalMultiplier: 1,
};

/** One mutually exclusive talent choice at a milestone. */
export interface HeroTalentChoice {
  id: string;
  name: string;
  description: string;
  modifiers: Partial<HeroRuntimeModifiers>;
}

/** A hero talent milestone and its two choices. */
export interface HeroMilestoneDefinition {
  level: number;
  choices: [HeroTalentChoice, HeroTalentChoice];
}

/** Persistent progression definition for one hero. */
export interface HeroProgressionDefinition {
  heroId: string;
  maxLevel: number;
  milestones: HeroMilestoneDefinition[];
}

/** Selected talent choices keyed by milestone level, for example `{ "5": "rapid_response" }`. */
export type HeroTalentSelection = Record<string, string>;

/**
 * Resolves a hero's frozen runtime stats from its base definition and the
 * selected talents. Called once at match start; talents never change mid-wave.
 */
export function resolveHeroRuntime(
  base: HeroDefinition,
  selection: HeroTalentSelection,
  milestones: HeroMilestoneDefinition[],
): HeroDefinition {
  const modifiers: HeroRuntimeModifiers = { ...NEUTRAL_HERO_MODIFIERS };
  for (const milestone of milestones) {
    const choiceId = selection[String(milestone.level)];
    const choice = milestone.choices.find((entry) => entry.id === choiceId);
    if (!choice) {
      continue;
    }
    modifiers.cooldownMultiplier *= choice.modifiers.cooldownMultiplier ?? 1;
    modifiers.durationMultiplier *= choice.modifiers.durationMultiplier ?? 1;
    modifiers.magnitudeMultiplier *= choice.modifiers.magnitudeMultiplier ?? 1;
    modifiers.attackDamageMultiplier *=
      choice.modifiers.attackDamageMultiplier ?? 1;
    modifiers.attackIntervalMultiplier *=
      choice.modifiers.attackIntervalMultiplier ?? 1;
  }

  return {
    ...base,
    cooldownMs: Math.round(base.cooldownMs * modifiers.cooldownMultiplier),
    durationMs: Math.round(base.durationMs * modifiers.durationMultiplier),
    magnitude: base.magnitude * modifiers.magnitudeMultiplier,
    attackDamage: base.attackDamage * modifiers.attackDamageMultiplier,
    attackIntervalMs: Math.round(
      base.attackIntervalMs * modifiers.attackIntervalMultiplier,
    ),
  };
}
