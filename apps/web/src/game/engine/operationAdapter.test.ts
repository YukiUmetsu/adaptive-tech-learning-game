import { describe, expect, it } from "vitest";

import {
  generatedOperationToMissionDefinition,
  operationCatalog,
  operationMapFor,
} from "./operationAdapter";
import type { GeneratedOperation } from "../models/operation";

function operation(overrides: Partial<GeneratedOperation> = {}): GeneratedOperation {
  return {
    seed: 42,
    template_id: "identity-breach",
    adversary_id: "ghost-7",
    adversary_name: "GHOST-7",
    threat_level: 4,
    title: "Credential Cascade",
    summary: "Credential attacks are replayed against the sign-in flow.",
    map_id: "identity-stack",
    starting_budget: 700,
    starting_health: 100,
    latency_target_ms: 170,
    available_defenses: ["mfa", "rate_limiter"],
    available_heroes: ["security_engineer", "sre"],
    waves: [
      {
        boss: false,
        groups: [
          {
            attack_id: "credential_stuffing",
            count: 6,
            spawn_interval_ms: 1000,
            delay_ms: null,
            health_multiplier: 1.3,
            speed_multiplier: 1.05,
          },
        ],
      },
      {
        boss: true,
        groups: [
          {
            attack_id: "credential_stuffing",
            count: 4,
            spawn_interval_ms: 900,
            delay_ms: 1500,
            health_multiplier: 1.3,
            speed_multiplier: 1.05,
          },
        ],
      },
    ],
    modifiers: [
      { id: "hidden_traffic", name: "Hidden Traffic", description: "..." },
    ],
    dominant_attack_type: "credential_stuffing",
    hidden_attacks: true,
    boss: true,
    reward_preview: { bits: 61, career_xp: 118, hero_xp: 58 },
    ...overrides,
  };
}

describe("generatedOperationToMissionDefinition", () => {
  it("adapts waves and preserves the run identity", () => {
    const mission = generatedOperationToMissionDefinition(operation(), "run-123");

    expect(mission.id).toBe("operation:run-123");
    expect(mission.title).toBe("Credential Cascade");
    expect(mission.startingBudget).toBe(700);
    expect(mission.startingHealth).toBe(100);
    expect(mission.latencyTargetMs).toBe(170);
    expect(mission.availableDefenses).toEqual(["mfa", "rate_limiter"]);
    expect(mission.availableHeroes).toEqual(["security_engineer", "sre"]);
    expect(mission.waves).toHaveLength(2);
    expect(mission.waves[0].groups[0]).toMatchObject({
      attackId: "credential_stuffing",
      count: 6,
      spawnIntervalMs: 1000,
    });
    expect(mission.waves[1].boss).toBe(true);
  });

  it("resolves the map by id", () => {
    const mission = generatedOperationToMissionDefinition(operation(), "run-1");
    expect(mission.map.nodes.map((node) => node.id)).toContain("auth");
  });

  it("falls back to a known map for an unknown id", () => {
    const mission = generatedOperationToMissionDefinition(
      operation({ map_id: "does-not-exist" }),
      "run-1",
    );
    expect(operationMapFor(operation({ map_id: "does-not-exist" })).nodes.length).toBeGreaterThan(0);
    expect(mission.map.nodes.length).toBeGreaterThan(0);
  });
});

describe("operationCatalog", () => {
  it("scales enemy health and speed and hides the dominant family", () => {
    const catalog = operationCatalog(operation());
    const attack = catalog.attacksById.credential_stuffing;
    expect(attack.health).toBeGreaterThan(78); // base 78 * 1.3
    expect(attack.speed).toBeGreaterThan(0.32);
    expect(attack.hiddenUntilDetected).toBe(true);
    // Bosses are never hidden by a hidden-traffic modifier.
    expect(catalog.attacksById.botnet_ddos_boss.hiddenUntilDetected).toBeFalsy();
  });

  it("returns the base catalog unchanged when there is no scaling", () => {
    const plain = operation({
      hidden_attacks: false,
      waves: [
        {
          boss: false,
          groups: [
            {
              attack_id: "credential_stuffing",
              count: 4,
              spawn_interval_ms: 1000,
              delay_ms: null,
              health_multiplier: 1,
              speed_multiplier: 1,
            },
          ],
        },
      ],
    });
    const catalog = operationCatalog(plain);
    expect(catalog.attacksById.credential_stuffing.health).toBe(78);
  });
});
