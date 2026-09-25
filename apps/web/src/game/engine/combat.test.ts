import { describe, expect, it } from "vitest";

import { GAME_CATALOG } from "../data";
import { upgradeBitsCost, type PlacedDefense } from "../models/defense";
import {
  activeSynergies,
  auraBonus,
  canPlaceDefense,
  computeLatencyMs,
  computeSpentBudget,
  coverageContains,
  damagePerSecond,
  hasDetection,
  leakedSystemDamage,
  placementExplanation,
  previewBitsForStars,
  rateMission,
  synergyDamageBonus,
  systemDamageReduction,
} from "./combat";

const waf = GAME_CATALOG.defensesById["waf"];
const parameterized = GAME_CATALOG.defensesById["parameterized_queries"];
const rateLimiter = GAME_CATALOG.defensesById["rate_limiter"];
const mfa = GAME_CATALOG.defensesById["mfa"];

function placed(defenseId: string, nodeId: string, level = 1): PlacedDefense {
  return { id: `${defenseId}-${nodeId}`, defenseId, nodeId, level };
}

describe("combat economy", () => {
  it("sums placement and upgrade costs", () => {
    const defenses = [placed("waf", "edge"), placed("rate_limiter", "edge")];
    expect(computeSpentBudget(defenses, GAME_CATALOG)).toBe(200 + 150);
  });

  it("does not charge mission credits for upgrades", () => {
    const defenses = [placed("waf", "edge", 2)];
    expect(computeSpentBudget(defenses, GAME_CATALOG)).toBe(waf.cost);
  });

  it("prices in-mission upgrades in Bits", () => {
    expect(upgradeBitsCost(waf, 1)).toBeGreaterThan(0);
  });

  it("sums latency across deployed controls", () => {
    const defenses = [placed("waf", "edge"), placed("mfa", "auth")];
    expect(computeLatencyMs(defenses, GAME_CATALOG)).toBe(4 + 8);
  });

  it("adds defensive-in-depth synergy bonuses", () => {
    const active = activeSynergies(
      ["waf", "parameterized_queries"],
      GAME_CATALOG.synergies,
    );
    expect(active.map((synergy) => synergy.id)).toContain("waf_parameterized");
    expect(synergyDamageBonus("sql_injection", active)).toBeCloseTo(0.1);
    expect(synergyDamageBonus("ddos", active)).toBe(0);
  });
});

describe("placement rules", () => {
  it("allows a WAF at the edge and API layers", () => {
    expect(canPlaceDefense(waf, "edge").ok).toBe(true);
    expect(canPlaceDefense(waf, "api").ok).toBe(true);
  });

  it("rejects a WAF on the database with an explanation", () => {
    const result = canPlaceDefense(waf, "database");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("explains where Parameterized Queries belong", () => {
    const reason = placementExplanation(parameterized, "edge");
    expect(reason).toMatch(/application\/database/i);
  });

  it("restricts Traffic Blocker to the edge/API", () => {
    expect(
      canPlaceDefense(GAME_CATALOG.defensesById["traffic_blocker"], "edge").ok,
    ).toBe(true);
    expect(
      canPlaceDefense(GAME_CATALOG.defensesById["traffic_blocker"], "database")
        .ok,
    ).toBe(false);
  });
});

describe("coverage", () => {
  it("reaches attacks within the range window around the node", () => {
    expect(coverageContains(0, 1, 1.4)).toBe(true);
    expect(coverageContains(2.4, 1, 1.4)).toBe(true);
    expect(coverageContains(3, 1, 1.4)).toBe(false);
  });

  it("does not cover anything for zero-range support controls", () => {
    expect(coverageContains(1, 1, 0)).toBe(false);
  });
});

describe("damage per second", () => {
  it("makes Parameterized Queries stronger than a WAF against SQL injection", () => {
    const wafDps = damagePerSecond(waf, 1, "sql_injection");
    const pqDps = damagePerSecond(parameterized, 1, "sql_injection");
    expect(pqDps).toBeGreaterThan(wafDps);
    expect(pqDps).toBe(22);
    expect(wafDps).toBeCloseTo(2.8);
  });

  it("makes MFA stronger than a rate limiter against credential stuffing", () => {
    const mfaDps = damagePerSecond(mfa, 1, "credential_stuffing");
    const rateDps = damagePerSecond(rateLimiter, 1, "credential_stuffing");
    expect(mfaDps).toBeGreaterThan(rateDps);
  });

  it("returns zero for an ineffective control", () => {
    expect(damagePerSecond(waf, 1, "ransomware")).toBe(0);
  });

  it("applies detection aura and hero boosts", () => {
    const boosted = damagePerSecond(parameterized, 1, "sql_injection", {
      auraBonus: 0.1,
      heroBoost: 0.4,
    });
    expect(boosted).toBeCloseTo(22 * 1.5);
  });

  it("reveals hidden attacks only with detection", () => {
    expect(hasDetection([placed("monitoring", "api")], GAME_CATALOG)).toBe(true);
    expect(hasDetection([placed("waf", "edge")], GAME_CATALOG)).toBe(false);
    expect(auraBonus([placed("monitoring", "api")], GAME_CATALOG)).toBeCloseTo(
      0.12,
    );
  });
});

describe("system damage", () => {
  it("reduces system damage with Least Privilege", () => {
    const reduction = systemDamageReduction(
      "ransomware",
      [placed("least_privilege", "app")],
      GAME_CATALOG,
    );
    expect(reduction).toBeCloseTo(0.35);
  });

  it("caps stacked reductions below 1", () => {
    const reduction = systemDamageReduction(
      "credential_stuffing",
      [placed("least_privilege", "app"), placed("mfa", "auth")],
      GAME_CATALOG,
      { heroReduction: 0.5 },
    );
    expect(reduction).toBeCloseTo(0.9);
  });

  it("scales leaked damage with remaining attack health", () => {
    expect(leakedSystemDamage(20, 1, 0)).toBe(20);
    expect(leakedSystemDamage(20, 0.5, 0)).toBe(10);
    expect(leakedSystemDamage(20, 0.5, 0.5)).toBe(5);
    expect(leakedSystemDamage(6, 0.001, 0)).toBe(1);
  });
});

describe("mission rating", () => {
  const base = {
    completed: true,
    health: 70,
    maxHealth: 100,
    latencyMs: 100,
    latencyTargetMs: 150,
    spent: 400,
    recommendedSpend: 500,
  };

  it("awards three stars for a clean run", () => {
    expect(rateMission(base).stars).toBe(3);
  });

  it("drops the budget star when overspending", () => {
    expect(rateMission({ ...base, spent: 900 }).stars).toBe(2);
  });

  it("drops the latency star when the target is exceeded", () => {
    expect(rateMission({ ...base, latencyMs: 400 }).stars).toBe(2);
  });

  it("awards zero stars when the mission fails", () => {
    expect(rateMission({ ...base, completed: false }).stars).toBe(0);
  });

  it("previews Bits by star count without mutating anything", () => {
    expect(previewBitsForStars(0)).toBe(0);
    expect(previewBitsForStars(3)).toBe(60);
  });
});
