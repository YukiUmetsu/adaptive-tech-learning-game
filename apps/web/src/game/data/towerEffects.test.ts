import { describe, expect, it } from "vitest";

import {
  deriveOperationIntelVisibility,
  engineeringLabSwapAllowance,
  resilienceEmergencyRecovery,
  resiliencePostmortemIntel,
  towerProgressFromSnapshot,
  towerProgressFromUpgrades,
} from "./towerEffects";

describe("deriveOperationIntelVisibility", () => {
  it("reveals nothing extra without upgrades", () => {
    const visibility = deriveOperationIntelVisibility({});
    expect(visibility.showAdversarySpecialty).toBe(false);
    expect(visibility.visibleModifierCount).toBe(0);
    expect(visibility.showBossPresence).toBe(false);
    expect(visibility.visibleWaveCount).toBe(0);
    expect(visibility.showWaveIntensity).toBe(false);
    expect(visibility.showExactThreatCounts).toBe(false);
  });

  it("gates waves on SOC and adversary intel on Threat Intelligence", () => {
    expect(deriveOperationIntelVisibility({ soc: 2 }).visibleWaveCount).toBe(1);
    expect(deriveOperationIntelVisibility({ soc: 3 }).visibleWaveCount).toBe(2);
    expect(deriveOperationIntelVisibility({ soc: 4 }).visibleWaveCount).toBe(2);
    expect(deriveOperationIntelVisibility({ soc: 4 }).showWaveIntensity).toBe(
      true,
    );
    expect(
      deriveOperationIntelVisibility({ soc: 4 }).showExactThreatCounts,
    ).toBe(true);

    expect(
      deriveOperationIntelVisibility({ threat_intelligence: 1 })
        .showAdversarySpecialty,
    ).toBe(true);
    expect(
      deriveOperationIntelVisibility({ threat_intelligence: 2 })
        .visibleModifierCount,
    ).toBe(1);
    expect(
      deriveOperationIntelVisibility({ threat_intelligence: 3 })
        .visibleModifierCount,
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      deriveOperationIntelVisibility({ threat_intelligence: 3 }).showBossPresence,
    ).toBe(true);
  });

  it("resolves room levels from profile rows", () => {
    expect(
      towerProgressFromUpgrades([
        { upgrade_id: "soc", level: 3 },
        { upgrade_id: "threat_intelligence", level: 2 },
      ]),
    ).toEqual({ soc: 3, threat_intelligence: 2 });
    expect(towerProgressFromUpgrades(undefined)).toEqual({});
  });

  it("resolves room levels from a run's frozen snapshot", () => {
    expect(
      towerProgressFromSnapshot({
        soc_level: 4,
        threat_intelligence_level: 3,
        training_center_level: 2,
        engineering_lab_level: 1,
        resilience_center_level: 2,
      }),
    ).toEqual({
      soc: 4,
      threat_intelligence: 3,
      training_center: 2,
      engineering_lab: 1,
      resilience_center: 2,
    });
    expect(towerProgressFromSnapshot(undefined)).toEqual({});
  });
});

describe("tower run effects", () => {
  it("grants emergency recovery only at Resilience Center Lv2", () => {
    expect(resilienceEmergencyRecovery({ resilience_center: 1 })).toBeUndefined();
    expect(resilienceEmergencyRecovery({ resilience_center: 2 })).toEqual({
      threshold: 0.25,
      restoreFraction: 0.1,
    });
    expect(resiliencePostmortemIntel({ resilience_center: 1 })).toBe(true);
    expect(resiliencePostmortemIntel({})).toBe(false);
  });

  it("allows substitutions by Engineering Lab level", () => {
    expect(engineeringLabSwapAllowance({})).toBe(0);
    expect(engineeringLabSwapAllowance({ engineering_lab: 1 })).toBe(1);
    expect(engineeringLabSwapAllowance({ engineering_lab: 2 })).toBe(2);
  });
});
