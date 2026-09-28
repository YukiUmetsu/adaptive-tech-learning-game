import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GAME_CATALOG } from "../data";
import {
  heroTalentsFromProfile,
  parseHeroTalentSelection,
  resolveCatalogHeroes,
  resolveHeroDefinition,
} from "./heroRuntime";
import { useFrozenHeroTalents } from "../hooks/useFrozenHeroTalents";
import { HEROES_BY_ID } from "./heroes";
import { createInitialState, deployHero } from "../engine/simulation";
import type { MissionDefinition } from "../models/mission";
import type { GameCatalog } from "../data";

const baseEngineer = HEROES_BY_ID["security_engineer"];

function mission(): MissionDefinition {
  return {
    id: "test-mission",
    title: "Test",
    description: "Test",
    threatSummary: [],
    startingBudget: 1000,
    startingHealth: 100,
    latencyTargetMs: 200,
    map: { entryNodeId: "internet", nodes: [], edges: [] },
    availableDefenses: [],
    availableHeroes: ["security_engineer"],
    waves: [{ groups: [{ attackId: "sql_injection", count: 1, spawnIntervalMs: 1000 }] }],
    lessons: { completion: "" },
  } as MissionDefinition;
}

describe("heroRuntime resolver", () => {
  it("is an exact no-op when no talents are selected", () => {
    const resolved = resolveCatalogHeroes(GAME_CATALOG, {});
    expect(resolved).toBe(GAME_CATALOG);
    expect(resolveHeroDefinition(GAME_CATALOG, "security_engineer", {})).toBe(
      baseEngineer,
    );
  });

  it("applies cooldown, magnitude, duration, and attack talents", () => {
    const rapid = resolveCatalogHeroes(GAME_CATALOG, {
      security_engineer: { "5": "rapid_response" },
    });
    expect(rapid.heroesById["security_engineer"].cooldownMs).toBeLessThan(
      baseEngineer.cooldownMs,
    );

    const hardening = resolveCatalogHeroes(GAME_CATALOG, {
      security_engineer: { "5": "deep_hardening" },
    });
    expect(hardening.heroesById["security_engineer"].magnitude).toBeGreaterThan(
      baseEngineer.magnitude,
    );

    const extended = resolveCatalogHeroes(GAME_CATALOG, {
      security_engineer: { "10": "extended_field" },
    });
    expect(extended.heroesById["security_engineer"].durationMs).toBeGreaterThan(
      baseEngineer.durationMs,
    );

    const focused = resolveCatalogHeroes(GAME_CATALOG, {
      security_engineer: { "10": "focused_strikes" },
    });
    expect(
      focused.heroesById["security_engineer"].attackDamage,
    ).toBeGreaterThan(baseEngineer.attackDamage);
    expect(
      focused.heroesById["security_engineer"].attackIntervalMs,
    ).toBeLessThan(baseEngineer.attackIntervalMs);
  });

  it("never lets one hero's talents change another hero", () => {
    const resolved = resolveCatalogHeroes(GAME_CATALOG, {
      sre: { "5": "burst_capacity" },
    });
    expect(resolved.heroesById["security_engineer"]).toBe(baseEngineer);
    expect(resolved.heroesById["sre"]).not.toBe(HEROES_BY_ID["sre"]);
  });

  it("fails safe on malformed stored talent JSON", () => {
    expect(parseHeroTalentSelection(null)).toEqual({});
    expect(parseHeroTalentSelection([1, 2])).toEqual({});
    expect(parseHeroTalentSelection({ "5": 7, bad: "x" })).toEqual({});
    expect(
      heroTalentsFromProfile([
        { hero_id: "security_engineer", selected_talents: { "5": "rapid_response" } },
      ]),
    ).toEqual({ security_engineer: { "5": "rapid_response" } });
  });
});

describe("hero talents reach the simulation", () => {
  it("gives a Rapid Response engineer a shorter simulated cooldown", () => {
    const catalog: GameCatalog = resolveCatalogHeroes(GAME_CATALOG, {
      security_engineer: { "5": "rapid_response" },
    });
    const state = createInitialState(mission(), catalog);
    const result = deployHero(state, "security_engineer", 1, catalog);

    expect(result.ok).toBe(true);
    const cooldown = result.state.heroes[0].cooldownRemainingMs;
    expect(cooldown).toBe(
      catalog.heroesById["security_engineer"].cooldownMs,
    );
    expect(cooldown).toBeLessThan(baseEngineer.cooldownMs);
  });
});

describe("useFrozenHeroTalents", () => {
  it("freezes the first profile snapshot for the run", () => {
    const initial = [
      { hero_id: "security_engineer", selected_talents: { "5": "rapid_response" } },
    ];
    const { result, rerender } = renderHook(
      ({ heroes }: { heroes: typeof initial }) => useFrozenHeroTalents(heroes),
      { initialProps: { heroes: initial } },
    );

    expect(result.current.security_engineer).toEqual({ "5": "rapid_response" });

    // A talent change mid-run must not leak into the running battle.
    rerender({
      heroes: [
        {
          hero_id: "security_engineer",
          selected_talents: { "5": "deep_hardening" },
        },
      ],
    });
    expect(result.current.security_engineer).toEqual({ "5": "rapid_response" });
  });
});
