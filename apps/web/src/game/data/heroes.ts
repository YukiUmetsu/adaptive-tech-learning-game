import type { HeroDefinition } from "../models/hero";

/**
 * MVP heroes. Two are enough to teach that emergency abilities help but do not
 * replace architecture. Both fight on the road with short-range, strong melee
 * hits and project an aura while deployed.
 */
export const HEROES: HeroDefinition[] = [
  {
    id: "security_engineer",
    name: "Security Engineer",
    abilityName: "Emergency Rule",
    description:
      "Lands heavy melee hits on nearby attacks, and hardens every active control while present.",
    kind: "effectiveness_boost",
    cooldownMs: 22_000,
    durationMs: 14_000,
    magnitude: 0.3,
    attackDamage: 34,
    attackIntervalMs: 1100,
    attackRange: 0.42,
    color: "#38bdf8",
  },
  {
    id: "sre",
    name: "SRE",
    abilityName: "Emergency Scale",
    description:
      "Lands heavy melee hits on nearby attacks, and absorbs incoming system damage while present.",
    kind: "damage_reduction",
    cooldownMs: 22_000,
    durationMs: 14_000,
    magnitude: 0.4,
    attackDamage: 26,
    attackIntervalMs: 1100,
    attackRange: 0.38,
    color: "#fbbf24",
  },
];

export const HEROES_BY_ID: Record<string, HeroDefinition> = Object.fromEntries(
  HEROES.map((hero) => [hero.id, hero]),
);
