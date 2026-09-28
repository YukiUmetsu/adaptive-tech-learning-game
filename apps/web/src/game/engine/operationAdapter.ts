import { GAME_CATALOG, type GameCatalog } from "../data";
import { DEFAULT_OPERATION_MAP, OPERATION_MAPS } from "../data/operationMaps";
import { ATTACK_TYPE_LABELS, type AttackType } from "../models/attack";
import type { MissionMap } from "../models/map";
import type { MissionDefinition, WaveDefinition } from "../models/mission";
import type { GeneratedOperation } from "../models/operation";

/**
 * Adapts a server-generated Operation to the Stage 1 mission engine.
 *
 * The engine is not forked: an Operation becomes an ordinary `MissionDefinition`
 * plus an optional scaled catalog. `runId` is part of the mission id so the
 * existing game cache resumes the exact run (Stage2.md step 13.5).
 */

/** Resolves the map a generated Operation runs on. */
export function operationMapFor(operation: GeneratedOperation): MissionMap {
  return OPERATION_MAPS[operation.map_id] ?? DEFAULT_OPERATION_MAP;
}

/**
 * Every architecture node actually attacked by this Operation, in first-seen
 * order.
 *
 * Derived only from the attacks present in `operation.waves`; it never infers
 * targets from map node types, so an unrelated Database is not highlighted. A
 * branching Operation with, say, SQL Injection (Database) and XSS (Application)
 * returns both, so the briefing can show every real target.
 */
export function operationTargetNodeIds(
  operation: GeneratedOperation,
  catalog: GameCatalog = GAME_CATALOG,
): string[] {
  const targets: string[] = [];
  for (const wave of operation.waves) {
    for (const group of wave.groups) {
      const attack = catalog.attacksById[group.attack_id];
      if (attack && !targets.includes(attack.targetNodeId)) {
        targets.push(attack.targetNodeId);
      }
    }
  }
  return targets;
}

/** Mission-credit pacing for Operations, matching the campaign defaults. */
const OPERATION_WAVE_CLEAR_BONUS = 70;
const OPERATION_EARLY_CALL_BONUS_PER_SECOND = 5;

function operationThreatTypes(operation: GeneratedOperation): AttackType[] {
  const seen: AttackType[] = [];
  for (const wave of operation.waves) {
    for (const group of wave.groups) {
      const attack = GAME_CATALOG.attacksById[group.attack_id];
      if (attack && !seen.includes(attack.attackType)) {
        seen.push(attack.attackType);
      }
    }
  }
  return seen;
}

/** Converts a generated Operation into the mission engine's input. */
export function generatedOperationToMissionDefinition(
  operation: GeneratedOperation,
  runId: string,
): MissionDefinition {
  const waves: WaveDefinition[] = operation.waves.map((wave) => ({
    boss: wave.boss,
    groups: wave.groups.map((group) => ({
      attackId: group.attack_id,
      count: group.count,
      spawnIntervalMs: group.spawn_interval_ms,
      delayMs: group.delay_ms ?? undefined,
    })),
  }));

  return {
    id: `operation:${runId}`,
    title: operation.title,
    description: operation.summary,
    threatSummary: operationThreatTypes(operation).map(
      (attackType) => ATTACK_TYPE_LABELS[attackType],
    ),
    startingBudget: operation.starting_budget,
    startingHealth: operation.starting_health,
    latencyTargetMs: operation.latency_target_ms,
    waveClearBonus: OPERATION_WAVE_CLEAR_BONUS,
    earlyCallBonusPerSecond: OPERATION_EARLY_CALL_BONUS_PER_SECOND,
    map: operationMapFor(operation),
    availableDefenses: operation.available_defenses,
    availableHeroes: operation.available_heroes,
    waves,
    lessons: {
      completion:
        "Layering controls across the architecture kept every attack type contained.",
      failure: {},
    },
  };
}

/**
 * Builds a catalog whose attacks carry the Operation's difficulty multipliers.
 *
 * The server scales enemy health and speed per Operation rather than only
 * increasing counts. Hidden-traffic modifiers hide the dominant family until
 * detection is active, which gives detection controls their counterplay.
 */
export function operationCatalog(
  operation: GeneratedOperation,
  base: GameCatalog = GAME_CATALOG,
): GameCatalog {
  const firstGroup = operation.waves[0]?.groups[0];
  const health = firstGroup?.health_multiplier ?? 1;
  const speed = firstGroup?.speed_multiplier ?? 1;
  const hiddenDominant = operation.hidden_attacks;

  if (health === 1 && speed === 1 && !hiddenDominant) {
    return base;
  }

  const attacks = base.attacks.map((attack) => {
    const isDominant = attack.attackType === operation.dominant_attack_type;
    return {
      ...attack,
      health: Math.max(1, Math.round(attack.health * health)),
      speed: attack.speed * speed,
      hiddenUntilDetected:
        attack.hiddenUntilDetected || (hiddenDominant && isDominant && !attack.boss),
    };
  });

  return {
    ...base,
    attacks,
    attacksById: Object.fromEntries(attacks.map((attack) => [attack.id, attack])),
  };
}
