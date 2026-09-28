import type { GameCatalog } from "./index";
import { HERO_PROGRESSION_BY_ID } from "./heroProgression";
import {
  resolveHeroRuntime,
  type HeroDefinition,
  type HeroTalentSelection,
} from "../models/hero";

/**
 * Canonical frontend resolver for runtime hero stats.
 *
 * `resolveHeroRuntime` is the only place the talent modifier math lives; this
 * module only maps persisted selections onto a catalog. A resolved catalog is
 * frozen for a run: talents chosen in another tab never change an in-progress
 * battle (Stage2.md step 8.4).
 */

/** Selected talents keyed by hero id. */
export type HeroTalentsByHero = Record<string, HeroTalentSelection>;

/** A stable empty selection, so a missing profile never churns references. */
export const NO_HERO_TALENTS: HeroTalentsByHero = {};

/** One profile hero row, trimmed to what the resolver needs. */
export interface ProfileHeroTalentInput {
  hero_id: string;
  selected_talents: unknown;
}

/** Safely coerces a stored `selected_talents` JSON value into a selection. */
export function parseHeroTalentSelection(raw: unknown): HeroTalentSelection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const selection: HeroTalentSelection = {};
  for (const [milestone, choice] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof choice === "string" && /^\d+$/.test(milestone)) {
      selection[milestone] = choice;
    }
  }
  return selection;
}

/** Builds per-hero selections from a profile's hero rows. */
export function heroTalentsFromProfile(
  heroes: readonly ProfileHeroTalentInput[] | undefined,
): HeroTalentsByHero {
  if (!heroes || heroes.length === 0) {
    return NO_HERO_TALENTS;
  }
  const talents: HeroTalentsByHero = {};
  for (const hero of heroes) {
    const selection = parseHeroTalentSelection(hero.selected_talents);
    if (Object.keys(selection).length > 0) {
      talents[hero.hero_id] = selection;
    }
  }
  return talents;
}

/** Resolves one hero's frozen runtime definition, or `undefined` if unknown. */
export function resolveHeroDefinition(
  catalog: GameCatalog,
  heroId: string,
  talents: HeroTalentsByHero,
): HeroDefinition | undefined {
  const base = catalog.heroesById[heroId];
  if (!base) {
    return undefined;
  }
  const selection = talents[heroId];
  const progression = HERO_PROGRESSION_BY_ID[heroId];
  if (!selection || !progression) {
    return base;
  }
  return resolveHeroRuntime(base, selection, progression.milestones);
}

/**
 * Returns a catalog whose heroes carry their selected persistent talents.
 *
 * The engine reads every hero stat from `catalog.heroesById`, so resolving here
 * is the single wiring point for talents: no simulation code changes and no
 * duplicated modifier math.
 */
export function resolveCatalogHeroes(
  catalog: GameCatalog,
  talents: HeroTalentsByHero,
): GameCatalog {
  if (Object.keys(talents).length === 0) {
    return catalog;
  }
  let changed = false;
  const heroes = catalog.heroes.map((base) => {
    const resolved = resolveHeroDefinition(catalog, base.id, talents);
    if (resolved && resolved !== base) {
      changed = true;
      return resolved;
    }
    return base;
  });
  if (!changed) {
    return catalog;
  }
  return {
    ...catalog,
    heroes,
    heroesById: Object.fromEntries(heroes.map((hero) => [hero.id, hero])),
  };
}
