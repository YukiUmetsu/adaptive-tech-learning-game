import type { AttackDefinition } from "../models/attack";
import type { DefenseDefinition } from "../models/defense";
import type { HeroDefinition } from "../models/hero";
import type { MissionDefinition, SynergyDefinition } from "../models/mission";
import { ATTACKS, ATTACKS_BY_ID } from "./attacks";
import { DEFENSES, DEFENSES_BY_ID } from "./defenses";
import { HEROES, HEROES_BY_ID } from "./heroes";
import { MISSIONS, MISSIONS_BY_ID } from "./missions";
import { SYNERGIES, SYNERGIES_BY_ID } from "./synergies";

/**
 * Everything the game engine needs, resolved by id.
 *
 * Passing one catalog object through the engine keeps data-driven content (spec
 * section 33) easy to test: tests can build a tiny catalog and avoid the full
 * mission list.
 */
export interface GameCatalog {
  attacks: AttackDefinition[];
  attacksById: Record<string, AttackDefinition>;
  defenses: DefenseDefinition[];
  defensesById: Record<string, DefenseDefinition>;
  heroes: HeroDefinition[];
  heroesById: Record<string, HeroDefinition>;
  missions: MissionDefinition[];
  missionsById: Record<string, MissionDefinition>;
  synergies: SynergyDefinition[];
  synergiesById: Record<string, SynergyDefinition>;
}

export const GAME_CATALOG: GameCatalog = {
  attacks: ATTACKS,
  attacksById: ATTACKS_BY_ID,
  defenses: DEFENSES,
  defensesById: DEFENSES_BY_ID,
  heroes: HEROES,
  heroesById: HEROES_BY_ID,
  missions: MISSIONS,
  missionsById: MISSIONS_BY_ID,
  synergies: SYNERGIES,
  synergiesById: SYNERGIES_BY_ID,
};
