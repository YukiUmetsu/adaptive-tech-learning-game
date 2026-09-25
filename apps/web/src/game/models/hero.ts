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
  /** Time left on the road. */
  ttlMs: number;
  /** Time until the next melee hit. */
  attackCooldownMs: number;
}

export const HERO_ROLES: Record<HeroKind, string> = {
  effectiveness_boost: "Hardens active controls",
  damage_reduction: "Absorbs incoming damage",
};
