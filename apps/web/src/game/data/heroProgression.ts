import type { HeroProgressionDefinition } from "../models/hero";

/**
 * Persistent hero progression definitions.
 *
 * Hero ids, milestone levels, and choice ids mirror the server's canonical
 * `crates/domain/src/cyber_defense.rs`. Talent effects are conservative and are
 * frozen into the runtime hero at match start (Stage2.md step 8).
 */
export const HERO_PROGRESSION: HeroProgressionDefinition[] = [
  {
    heroId: "security_engineer",
    maxLevel: 20,
    milestones: [
      {
        level: 5,
        choices: [
          {
            id: "rapid_response",
            name: "Rapid Response",
            description: "The ability comes back a little sooner.",
            modifiers: { cooldownMultiplier: 0.85 },
          },
          {
            id: "deep_hardening",
            name: "Deep Hardening",
            description: "Controls are hardened a little more while present.",
            modifiers: { magnitudeMultiplier: 1.15 },
          },
        ],
      },
      {
        level: 10,
        choices: [
          {
            id: "extended_field",
            name: "Extended Field",
            description: "The hero stays on the road longer.",
            modifiers: { durationMultiplier: 1.2 },
          },
          {
            id: "focused_strikes",
            name: "Focused Strikes",
            description: "Melee hits land harder and more often.",
            modifiers: {
              attackDamageMultiplier: 1.15,
              attackIntervalMultiplier: 0.9,
            },
          },
        ],
      },
      {
        level: 15,
        choices: [
          {
            id: "standing_rule",
            name: "Standing Rule",
            description: "A shorter cooldown on the emergency rule.",
            modifiers: { cooldownMultiplier: 0.9 },
          },
          {
            id: "broad_hardening",
            name: "Broad Hardening",
            description: "Slightly stronger control hardening.",
            modifiers: { magnitudeMultiplier: 1.1 },
          },
        ],
      },
      {
        level: 20,
        choices: [
          {
            id: "field_mastery",
            name: "Field Mastery",
            description: "A longer presence in the fight.",
            modifiers: { durationMultiplier: 1.15 },
          },
          {
            id: "strike_mastery",
            name: "Strike Mastery",
            description: "The strongest melee improvement.",
            modifiers: { attackDamageMultiplier: 1.2 },
          },
        ],
      },
    ],
  },
  {
    heroId: "sre",
    maxLevel: 20,
    milestones: [
      {
        level: 5,
        choices: [
          {
            id: "burst_capacity",
            name: "Burst Capacity",
            description: "Stronger reduction for a shorter time.",
            modifiers: { magnitudeMultiplier: 1.2, durationMultiplier: 0.85 },
          },
          {
            id: "sustained_capacity",
            name: "Sustained Capacity",
            description: "Lower peak reduction that lasts longer.",
            modifiers: { magnitudeMultiplier: 0.9, durationMultiplier: 1.25 },
          },
        ],
      },
      {
        level: 10,
        choices: [
          {
            id: "rapid_recovery",
            name: "Rapid Recovery",
            description: "Emergency scale comes back sooner.",
            modifiers: { cooldownMultiplier: 0.85 },
          },
          {
            id: "wide_shield",
            name: "Wide Shield",
            description: "A slightly stronger damage absorption.",
            modifiers: { magnitudeMultiplier: 1.1 },
          },
        ],
      },
      {
        level: 15,
        choices: [
          {
            id: "deep_reserves",
            name: "Deep Reserves",
            description: "Capacity holds for longer.",
            modifiers: { durationMultiplier: 1.15 },
          },
          {
            id: "long_hold",
            name: "Long Hold",
            description: "A little more absorption.",
            modifiers: { magnitudeMultiplier: 1.1 },
          },
        ],
      },
      {
        level: 20,
        choices: [
          {
            id: "capacity_mastery",
            name: "Capacity Mastery",
            description: "The strongest absorption improvement.",
            modifiers: { magnitudeMultiplier: 1.15 },
          },
          {
            id: "resilience_mastery",
            name: "Resilience Mastery",
            description: "The longest presence in the fight.",
            modifiers: { durationMultiplier: 1.2 },
          },
        ],
      },
    ],
  },
];

export const HERO_PROGRESSION_BY_ID: Record<string, HeroProgressionDefinition> =
  Object.fromEntries(
    HERO_PROGRESSION.map((definition) => [definition.heroId, definition]),
  );
