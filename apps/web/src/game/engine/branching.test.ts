import { describe, expect, it } from "vitest";

import { GAME_CATALOG, type GameCatalog } from "../data";
import type { AttackDefinition } from "../models/attack";
import type { MissionMap } from "../models/map";
import type { MissionDefinition, WaveDefinition } from "../models/mission";
import {
  createInitialState,
  deployHero,
  placeDefense,
  startFirstWave,
  stepSimulation,
  type GameState,
} from "./simulation";

/**
 * Branching-map gameplay.
 *
 * The simulation and the renderer must agree on which route an attack is on. A
 * tower on one branch must never damage an attack whose logical path does not
 * traverse that branch, and an anchored hero must stay on its own edge.
 */

const DUAL_SERVICE: MissionMap = {
  entryNodeId: "internet",
  nodes: [
    { id: "internet", type: "edge", label: "Internet" },
    { id: "edge", type: "edge", label: "Edge" },
    { id: "api", type: "api", label: "API" },
    { id: "app", type: "application", label: "Application" },
    { id: "db", type: "database", label: "Database" },
  ],
  edges: [
    { from: "internet", to: "edge" },
    { from: "edge", to: "api" },
    { from: "edge", to: "app" },
    { from: "api", to: "db" },
    { from: "app", to: "db" },
  ],
};

/** Same attack family on both branches: one reaches Application, one Database. */
const appAttack: AttackDefinition = {
  ...GAME_CATALOG.attacksById.xss,
  id: "xss_app",
  targetNodeId: "app",
};
const dbAttack: AttackDefinition = {
  ...GAME_CATALOG.attacksById.xss,
  id: "xss_via_api",
  targetNodeId: "db",
};

const catalog: GameCatalog = {
  ...GAME_CATALOG,
  attacks: [...GAME_CATALOG.attacks, appAttack, dbAttack],
  attacksById: {
    ...GAME_CATALOG.attacksById,
    xss_app: appAttack,
    xss_via_api: dbAttack,
  },
};

function missionWith(groups: WaveDefinition["groups"]): MissionDefinition {
  return {
    id: "branch-test",
    title: "Branch Test",
    description: "Two routes through one graph.",
    threatSummary: [],
    startingBudget: 1200,
    startingHealth: 100,
    latencyTargetMs: 2000,
    map: DUAL_SERVICE,
    availableDefenses: ["xss_protection", "parameterized_queries"],
    availableHeroes: ["sre", "security_engineer"],
    waves: [{ groups }],
    lessons: { completion: "Held every branch." },
  };
}

function runToEnd(mission: MissionDefinition, state: GameState): GameState {
  let current = state;
  let elapsed = 0;
  while (current.phase === "running" && elapsed < 60_000) {
    current = stepSimulation(current, 100, { mission, catalog });
    elapsed += 100;
  }
  return current;
}

describe("branching tower coverage", () => {
  it("an Application tower cannot damage an API-only attack", () => {
    const mission = missionWith([
      { attackId: "xss_via_api", count: 1, spawnIntervalMs: 1000 },
    ]);
    let state = createInitialState(mission, catalog);
    const placed = placeDefense(
      state,
      {
        defenseId: "xss_protection",
        nodeId: "app",
        nodeType: "application",
        padId: "app-p1",
      },
      catalog,
    );
    expect(placed.ok).toBe(true);
    state = placed.state;
    state = startFirstWave(state, mission);

    // The Database route runs Internet -> Edge -> API -> Database, so it never
    // passes the Application node the tower protects.
    const dbAttackPath = ["internet", "edge", "api", "db"];
    state = runToEnd(mission, state);

    expect(state.stats.damageByDefense.xss_protection ?? 0).toBe(0);
    expect(state.stats.blocked).toBe(0);
    expect(state.stats.leakedByAttack.xss_via_api ?? 0).toBe(1);
    expect(dbAttackPath).toContain("api");
    expect(dbAttackPath).not.toContain("app");
  });

  it("an Application tower damages an Application attack", () => {
    const mission = missionWith([
      { attackId: "xss_app", count: 1, spawnIntervalMs: 1000 },
    ]);
    let state = createInitialState(mission, catalog);
    state = placeDefense(
      state,
      {
        defenseId: "xss_protection",
        nodeId: "app",
        nodeType: "application",
        padId: "app-p1",
      },
      catalog,
    ).state;
    state = startFirstWave(state, mission);
    state = runToEnd(mission, state);

    expect(state.stats.damageByDefense.xss_protection ?? 0).toBeGreaterThan(0);
    expect(state.stats.blockedByAttack.xss_app ?? 0).toBe(1);
  });
});

describe("anchored hero coverage", () => {
  it("a hero on the Application edge only fights attacks on that edge", () => {
    const mission = missionWith([
      { attackId: "xss_app", count: 1, spawnIntervalMs: 1000 },
      { attackId: "xss_via_api", count: 1, spawnIntervalMs: 1000 },
    ]);
    let state = createInitialState(mission, catalog);
    const deployed = deployHero(state, "sre", 0.5, catalog, {
      from: "edge",
      to: "app",
      fraction: 0.5,
    });
    expect(deployed.ok).toBe(true);
    state = deployed.state;
    state = startFirstWave(state, mission);
    state = runToEnd(mission, state);

    // Only the Application attack shares the hero's edge, so only it is hit.
    expect(state.stats.blockedByAttack.xss_app ?? 0).toBe(1);
    expect(state.stats.blockedByAttack.xss_via_api ?? 0).toBe(0);
    expect(state.stats.leakedByAttack.xss_via_api ?? 0).toBe(1);
  });
});
