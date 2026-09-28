import { useRef } from "react";

import {
  heroTalentsFromProfile,
  NO_HERO_TALENTS,
  type HeroTalentsByHero,
  type ProfileHeroTalentInput,
} from "../data/heroRuntime";

/**
 * Captures a player's hero talents once and keeps them for the run.
 *
 * A talent change in another tab (or a later profile refresh) must never change
 * the stats of a battle already in progress, so the first available profile
 * snapshot is frozen until the component unmounts (Stage2.md step 8.4).
 */
export function useFrozenHeroTalents(
  heroes: readonly ProfileHeroTalentInput[] | undefined,
): HeroTalentsByHero {
  const frozen = useRef<HeroTalentsByHero | null>(null);
  if (frozen.current === null && heroes) {
    frozen.current = heroTalentsFromProfile(heroes);
  }
  return frozen.current ?? NO_HERO_TALENTS;
}
