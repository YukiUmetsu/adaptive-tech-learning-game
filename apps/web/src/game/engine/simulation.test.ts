import { describe, expect, it } from "vitest";

import { GAME_CATALOG } from "../data";
import { MISSIONS_BY_ID } from "../data/missions";
import type { MissionDefinition } from "../models/mission";
import {
  buildSpawnQueue,
  callNextWave,
  createInitialState,
  deployHero,
  placeDefense,
  removeDefense,
  startFirstWave,
  stepSimulation,
  upgradeDefense,
  type GameState,
} from "./simulation";

const catalog = GAME_CATALOG;

function placeOn(
  state: GameState,
  mission: MissionDefinition,
  defenseId: string,
  nodeId: string,
  padId?: string,
): GameState {
  const node = mission.map.nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new Error(`node ${nodeId} not in map`);
  }
  const result = placeDefense(
    state,
    {
      defenseId,
      nodeId,
      nodeType: node.type,
      padId: padId ?? `${nodeId}-p${state.placed.length}`,
    },
    catalog,
  );
  return result.state;
}

interface RunHandle {
  state: () => GameState;
  place: (defenseId: string, nodeId: string) => void;
}

function runMission(
  missionId: string,
  setup: (handle: RunHandle) => void,
  maxMs = 900_000,
): GameState {
  const mission = MISSIONS_BY_ID[missionId];
  let state = createInitialState(mission, catalog);
  const handle: RunHandle = {
    state: () => state,
    place: (defenseId, nodeId) => {
      state = placeOn(state, mission, defenseId, nodeId);
    },
  };
  setup(handle);
  state = startFirstWave(state, mission);

  const dt = 100;
  let elapsed = 0;
  while (state.phase === "running" && elapsed < maxMs) {
    state = stepSimulation(state, dt, { mission, catalog });
    elapsed += dt;
  }
  return state;
}

function runToIntermission(missionId: string): {
  state: GameState;
  mission: MissionDefinition;
} {
  const mission = MISSIONS_BY_ID[missionId];
  let state = createInitialState(mission, catalog);
  state = placeOn(state, mission, "traffic_analyzer", "internet");
  state = placeOn(state, mission, "traffic_blocker", "edge");
  state = startFirstWave(state, mission);
  let elapsed = 0;
  while (
    state.phase === "running" &&
    state.waveState !== "intermission" &&
    elapsed < 60_000
  ) {
    state = stepSimulation(state, 100, { mission, catalog });
    elapsed += 100;
  }
  return { state, mission };
}

describe("simulation setup", () => {
  it("starts in preparation with the mission budget and heroes", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const state = createInitialState(mission, catalog);
    expect(state.phase).toBe("prep");
    expect(state.budget).toBe(mission.startingBudget);
    expect(state.health).toBe(mission.startingHealth);
    expect(state.heroes.map((hero) => hero.heroId)).toEqual(["sre"]);
  });

  it("builds a spawn queue with one entry per attack", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const queue = buildSpawnQueue(mission, 0);
    expect(queue).toHaveLength(24);
    expect(queue[0].attackId).toBe("ddos_swarm");
  });

  it("does not advance while in preparation", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const state = createInitialState(mission, catalog);
    expect(stepSimulation(state, 1000, { mission, catalog })).toBe(state);
  });
});

describe("budget spending", () => {
  it("deducts the cost when a defense is placed", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    let state = createInitialState(mission, catalog);
    state = placeOn(state, mission, "rate_limiter", "edge");
    expect(state.placed).toHaveLength(1);
    expect(state.budget).toBe(mission.startingBudget - 150);
  });

  it("rejects invalid placement with an explanation", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const state = createInitialState(mission, catalog);
    const result = placeDefense(
      state,
      { defenseId: "rate_limiter", nodeId: "api", nodeType: "database" },
      catalog,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.state.placed).toHaveLength(0);
  });

  it("rejects a second tower on the same pad", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    let state = createInitialState(mission, catalog);
    state = placeOn(state, mission, "rate_limiter", "edge");
    const result = placeDefense(
      state,
      {
        defenseId: "traffic_blocker",
        nodeId: "edge",
        nodeType: "edge",
        padId: "edge-p0",
      },
      catalog,
    );
    expect(result.ok).toBe(false);
    expect(result.state.placed).toHaveLength(1);
  });

  it("rejects placement without enough budget", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const state = { ...createInitialState(mission, catalog), budget: 10 };
    const result = placeDefense(
      state,
      { defenseId: "rate_limiter", nodeId: "edge", nodeType: "edge" },
      catalog,
    );
    expect(result.ok).toBe(false);
  });

  it("upgrades a defense and enforces the level cap", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const state = placeOn(
      createInitialState(mission, catalog),
      mission,
      "traffic_blocker",
      "edge",
    );
    const placementId = state.placed[0].id;
    const upgraded = upgradeDefense(state, placementId, catalog);
    expect(upgraded.ok).toBe(true);
    expect(upgraded.state.placed[0].level).toBe(2);

    const capped = upgradeDefense(upgraded.state, placementId, catalog);
    expect(capped.ok).toBe(false);
  });

  it("refunds budget when a defense is removed", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const state = placeOn(
      createInitialState(mission, catalog),
      mission,
      "rate_limiter",
      "edge",
    );
    const placementId = state.placed[0].id;
    const removed = removeDefense(state, placementId, catalog);
    expect(removed.ok).toBe(true);
    expect(removed.state.budget).toBe(mission.startingBudget);
    expect(removed.state.placed).toHaveLength(0);
  });

  it("allows multiple towers on one node across different pads", () => {
    const mission = MISSIONS_BY_ID["mixed-defense"];
    let state = createInitialState(mission, catalog);
    state = placeOn(state, mission, "parameterized_queries", "app", "app-p1");
    state = placeOn(state, mission, "mfa", "app", "app-p2");
    state = placeOn(state, mission, "least_privilege", "app", "app-p3");
    expect(state.placed).toHaveLength(3);
  });

  it("rejects placing on an occupied pad", () => {
    const mission = MISSIONS_BY_ID["mixed-defense"];
    let state = createInitialState(mission, catalog);
    state = placeOn(state, mission, "parameterized_queries", "app", "app-p1");
    const occupied = placeDefense(
      state,
      {
        defenseId: "mfa",
        nodeId: "app",
        nodeType: "application",
        padId: "app-p1",
      },
      catalog,
    );
    expect(occupied.ok).toBe(false);
    expect(occupied.state.placed).toHaveLength(1);
  });
});

describe("rate-limiter gate", () => {
  it("spans two pads and congests DDoS traffic", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    let state = createInitialState(mission, catalog);
    const gate = placeDefense(
      state,
      {
        defenseId: "rate_limiter",
        nodeId: "internet",
        nodeType: "edge",
        padId: "pad-1L",
        gate: { partnerPadId: "pad-1R", position: 0.8 },
      },
      catalog,
    );
    expect(gate.ok).toBe(true);
    expect(gate.state.placed[0].gate).toBe(true);
    state = gate.state;

    // The partner pad is consumed, so a second tower cannot use it.
    const blocked = placeDefense(
      state,
      {
        defenseId: "traffic_blocker",
        nodeId: "internet",
        nodeType: "edge",
        padId: "pad-1R",
      },
      catalog,
    );
    expect(blocked.ok).toBe(false);

    state = startFirstWave(state, mission);
    let elapsed = 0;
    while (state.phase === "running" && elapsed < 60_000) {
      state = stepSimulation(state, 100, { mission, catalog });
      elapsed += 100;
    }
    expect(state.stats.blocked).toBeGreaterThan(0);
  });

  it("a gate stops swarm traffic without attacking", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    let state = createInitialState(mission, catalog);
    state = placeDefense(
      state,
      {
        defenseId: "rate_limiter",
        nodeId: "internet",
        nodeType: "edge",
        padId: "pad-1L",
        gate: { partnerPadId: "pad-1R", position: 0.6 },
      },
      catalog,
    ).state;
    state = startFirstWave(state, mission);

    let elapsed = 0;
    while (state.phase === "running" && elapsed < 90_000) {
      state = stepSimulation(state, 100, { mission, catalog });
      elapsed += 100;
    }
    // The gate itself deals no damage, yet it stops traffic.
    expect(state.stats.blocked).toBeGreaterThan(0);
    expect(Object.keys(state.stats.damageByDefense)).toHaveLength(0);
  });
});

describe("heroes", () => {
  it("deploys a hero onto the road and starts its cooldown", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    const state = createInitialState(mission, catalog);
    const result = deployHero(state, "sre", 0.5, catalog);
    expect(result.ok).toBe(true);
    expect(result.state.heroUnits).toHaveLength(1);
    expect(result.state.heroUnits[0].position).toBe(0.5);
    expect(result.state.heroes[0].cooldownRemainingMs).toBeGreaterThan(0);

    const again = deployHero(result.state, "sre", 1, catalog);
    expect(again.ok).toBe(false);
  });

  it("lets a deployed hero fight and block attacks without towers", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    let state = createInitialState(mission, catalog);
    state = deployHero(state, "sre", 0.6, catalog).state;
    state = startFirstWave(state, mission);

    let elapsed = 0;
    while (state.phase === "running" && elapsed < 60_000) {
      state = stepSimulation(state, 100, { mission, catalog });
      elapsed += 100;
    }
    expect(state.stats.blocked).toBeGreaterThan(0);
  });
});

describe("combat feedback", () => {
  it("emits engagements and blocked effects while towers fire", () => {
    const mission = MISSIONS_BY_ID["ddos-basics"];
    let state = createInitialState(mission, catalog);
    state = placeOn(state, mission, "traffic_analyzer", "internet");
    state = placeOn(state, mission, "traffic_blocker", "edge");
    state = startFirstWave(state, mission);

    let sawEngagement = false;
    let sawBlocked = false;
    for (let t = 0; t < 8000 && state.phase === "running"; t += 100) {
      state = stepSimulation(state, 100, { mission, catalog });
      if (state.engagements.length > 0) {
        sawEngagement = true;
      }
      if (state.effects.some((effect) => effect.kind === "blocked")) {
        sawBlocked = true;
      }
    }
    expect(sawEngagement).toBe(true);
    expect(sawBlocked).toBe(true);
  });

  it("grants a wave-clear bonus between waves", () => {
    const { state } = runToIntermission("ddos-basics");
    expect(state.waveState).toBe("intermission");
    expect(state.stats.creditsEarned).toBeGreaterThanOrEqual(70);
  });

  it("grants an early-call bonus and advances the wave", () => {
    const { state, mission } = runToIntermission("ddos-basics");
    const before = state.budget;
    const result = callNextWave(state, mission);
    expect(result.ok).toBe(true);
    expect(result.state.waveIndex).toBe(1);
    expect(result.state.budget).toBeGreaterThan(before);
    expect(result.state.stats.earlyCalls).toBe(1);
  });
});

describe("mission outcomes", () => {
  it("wins DDoS Basics with analyzer + blocker and a gate", () => {
    const state = runMission("ddos-basics", (handle) => {
      handle.place("rate_limiter", "edge");
      handle.place("traffic_analyzer", "internet");
      handle.place("traffic_blocker", "edge");
    });
    expect(state.phase).toBe("won");
    expect(state.health).toBeGreaterThan(0);
    expect(state.stats.blocked).toBeGreaterThan(0);
  });

  it("loses DDoS Basics without defenses", () => {
    const state = runMission("ddos-basics", () => {});
    expect(state.phase).toBe("lost");
    expect(state.health).toBe(0);
    expect(state.stats.leaked).toBeGreaterThan(0);
  });

  it("blocks SQL injection with Parameterized Queries alone", () => {
    const state = runMission("sql-injection", (handle) => {
      handle.place("parameterized_queries", "app");
    });
    expect(state.phase).toBe("won");
    expect(state.stats.blockedByAttack["sql_injection"]).toBeGreaterThan(0);
    expect(state.stats.leakedByAttack["sql_injection"]).toBeUndefined();
  });

  it("does not fully stop SQL injection with a WAF alone", () => {
    const state = runMission("sql-injection", (handle) => {
      handle.place("waf", "api");
    });
    expect(state.stats.blocked).toBe(0);
    expect(state.stats.leakedByAttack["sql_injection"]).toBeGreaterThan(0);
  });

  it("blocks credential stuffing with MFA alone", () => {
    const state = runMission("credential-stuffing", (handle) => {
      handle.place("mfa", "auth");
    });
    expect(state.phase).toBe("won");
    expect(
      state.stats.blockedByAttack["credential_stuffing"],
    ).toBeGreaterThan(0);
  });

  it("only slows credential stuffing with a rate limiter", () => {
    const state = runMission("credential-stuffing", (handle) => {
      handle.place("rate_limiter", "api");
    });
    expect(state.stats.blocked).toBe(0);
    expect(
      state.stats.leakedByAttack["credential_stuffing"],
    ).toBeGreaterThan(0);
  });

  it("is winnable on Mixed Defense with a layered build", () => {
    const state = runMission("mixed-defense", (handle) => {
      handle.place("waf", "edge");
      handle.place("rate_limiter", "edge");
      handle.place("parameterized_queries", "app");
      handle.place("mfa", "auth");
      handle.place("least_privilege", "app");
    });
    expect(state.phase).toBe("won");
  });

  it("is winnable on the boss with upgraded edge defenses", () => {
    const mission = MISSIONS_BY_ID["botnet-boss"];
    let state = createInitialState(mission, catalog);
    state = placeOn(state, mission, "traffic_analyzer", "internet");
    state = placeOn(state, mission, "traffic_blocker", "edge");
    state = placeOn(state, mission, "rate_limiter", "edge");
    state = placeOn(state, mission, "monitoring", "api");
    const blocker = state.placed.find(
      (item) => item.defenseId === "traffic_blocker",
    );
    state = upgradeDefense(state, blocker!.id, catalog).state;
    state = startFirstWave(state, mission);

    let elapsed = 0;
    while (state.phase === "running" && elapsed < 900_000) {
      state = stepSimulation(state, 100, { mission, catalog });
      elapsed += 100;
    }
    expect(state.phase).toBe("won");
  });

  it("summons each boss unit exactly once", () => {
    const base = MISSIONS_BY_ID["botnet-boss"];
    // A boss-only mission with effectively unlimited health, so the fight lasts
    // long enough to observe every summon.
    const mission: MissionDefinition = {
      ...base,
      startingHealth: 100_000,
      waves: [
        {
          groups: [
            { attackId: "botnet_ddos_boss", count: 1, spawnIntervalMs: 0 },
          ],
        },
      ],
    };

    let state = createInitialState(mission, catalog);
    state = startFirstWave(state, mission);

    const swarmIds = new Set<string>();
    for (let elapsed = 0; elapsed < 20_000; elapsed += 100) {
      state = stepSimulation(state, 100, { mission, catalog });
      for (const enemy of state.enemies) {
        if (enemy.attackId === "ddos_swarm") {
          swarmIds.add(enemy.id);
        }
      }
    }

    // `summons: [{ count: 3 }]` owes three units, not three firings of three.
    expect(swarmIds.size).toBe(3);
  });
});

describe("backup recovery", () => {
  it("restores system health once when it drops to the threshold", () => {
    // No other defenses, so attacks leak and drive health down through the
    // threshold. Backup is global: its node only has to be a legal placement.
    const state = runMission("sql-injection", (handle) => {
      handle.place("backup", "app");
    });

    expect(state.phase).toBe("lost");
    expect(state.restoreUsed).toBe(true);
    expect(state.backupRestoresUsed).toBe(1);
    expect(state.backupRestored).toBeGreaterThan(0);
    expect(state.backupRestored).toBeLessThanOrEqual(25);
    expect(state.health).toBeLessThanOrEqual(state.maxHealth);
  });

  it("restores at most once per mission", () => {
    const mission = MISSIONS_BY_ID["botnet-boss"];
    let state = createInitialState(mission, catalog);
    state = placeOn(state, mission, "backup", "db");
    state = startFirstWave(state, mission);

    let restores = 0;
    let elapsed = 0;
    while (state.phase === "running" && elapsed < 900_000) {
      const before = state.backupRestoresUsed;
      state = stepSimulation(state, 100, { mission, catalog });
      elapsed += 100;
      if (state.backupRestoresUsed > before) {
        restores += 1;
        // The threshold is a fraction of max health, not a fixed number.
        expect(state.health).toBeGreaterThan(mission.startingHealth * 0.5);
        expect(state.backupRestored).toBeGreaterThan(0);
      }
    }

    expect(restores).toBe(1);
  });
});
