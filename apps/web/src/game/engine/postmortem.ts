import type { AttackType } from "../models/attack";
import { ATTACK_TYPE_LABELS } from "../models/attack";
import type { MissionDefinition } from "../models/mission";
import type { GameCatalog } from "../data";
import {
  computeLatencyMs,
  computeSpentBudget,
  previewBitsForStars,
  rateMission,
} from "./combat";
import type { GameState } from "./simulation";

/**
 * Builds the concise mission report (spec sections 24 and 38.5).
 *
 * Pure and derived entirely from the final simulation state, so it can be unit
 * tested without rendering and never depends on client-supplied rewards.
 */

export interface AttackTally {
  attackId: string;
  name: string;
  count: number;
}

export interface PostmortemReport {
  completed: boolean;
  stars: number;
  survived: boolean;

  health: number;
  maxHealth: number;

  latencyMs: number;
  latencyTargetMs: number;
  latencyOk: boolean;

  spent: number;
  budgetRemaining: number;
  recommendedSpend: number;
  budgetOk: boolean;

  /** Mission-local credits earned from wave-clear and early-call bonuses. */
  creditsEarned: number;

  blocked: AttackTally[];
  leaked: AttackTally[];
  blockedTotal: number;
  leakedTotal: number;

  mostEffectiveDefense?: { id: string; name: string; damage: number };
  primaryCause?: { attackType: AttackType; label: string };

  /** Total system health restored by Backup this mission. */
  backupRestored: number;

  /** One short architecture lesson (spec section 23). */
  message: string;

  /**
   * Bits preview only. Persistent Bits are server-authoritative; this value is
   * never applied to the wallet from the client (spec section 43).
   */
  bitsPreview: number;
}

function talliesFor(
  counts: Record<string, number>,
  catalog: GameCatalog,
): AttackTally[] {
  return Object.entries(counts)
    .map(([attackId, count]) => ({
      attackId,
      name: catalog.attacksById[attackId]?.name ?? attackId,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.attackId.localeCompare(b.attackId));
}

export function buildPostmortem(
  state: GameState,
  mission: MissionDefinition,
  catalog: GameCatalog,
): PostmortemReport {
  const completed = state.phase === "won";
  const latencyMs = computeLatencyMs(state.placed, catalog);
  const spent = computeSpentBudget(state.placed, catalog);
  const recommendedSpend = mission.recommendedSpend ?? mission.startingBudget;
  const rating = rateMission({
    completed,
    health: state.health,
    maxHealth: state.maxHealth,
    latencyMs,
    latencyTargetMs: mission.latencyTargetMs,
    spent,
    recommendedSpend,
  });

  const blocked = talliesFor(state.stats.blockedByAttack, catalog);
  const leaked = talliesFor(state.stats.leakedByAttack, catalog);

  let mostEffectiveDefense:
    | { id: string; name: string; damage: number }
    | undefined;
  const damageEntries = Object.entries(state.stats.damageByDefense).sort(
    (a, b) => b[1] - a[1],
  );
  if (damageEntries.length > 0) {
    const [id, damage] = damageEntries[0];
    mostEffectiveDefense = {
      id,
      name: catalog.defensesById[id]?.name ?? id,
      damage: Math.round(damage),
    };
  }

  let primaryCause: { attackType: AttackType; label: string } | undefined;
  if (!completed) {
    const causeEntries = Object.entries(state.stats.damagedByAttack).sort(
      (a, b) => b[1] - a[1],
    );
    if (causeEntries.length > 0) {
      const [attackType] = causeEntries[0];
      primaryCause = {
        attackType: attackType as AttackType,
        label: ATTACK_TYPE_LABELS[attackType as AttackType] ?? attackType,
      };
    }
  }

  let message: string;
  if (completed) {
    message = mission.lessons.completion;
  } else if (primaryCause) {
    message =
      mission.lessons.failure?.[primaryCause.attackType] ??
      "Layering controls across the architecture reduces the impact of every attack type.";
  } else {
    message =
      "Layering controls across the architecture reduces the impact of every attack type.";
  }

  return {
    completed,
    stars: rating.stars,
    survived: rating.survived,
    health: state.health,
    maxHealth: state.maxHealth,
    latencyMs,
    latencyTargetMs: mission.latencyTargetMs,
    latencyOk: rating.latencyOk,
    spent,
    budgetRemaining: state.budget,
    recommendedSpend,
    budgetOk: rating.budgetOk,
    creditsEarned: state.stats.creditsEarned,
    blocked,
    leaked,
    blockedTotal: state.stats.blocked,
    leakedTotal: state.stats.leaked,
    mostEffectiveDefense,
    primaryCause,
    message,
    backupRestored: state.backupRestored,
    bitsPreview: previewBitsForStars(rating.stars),
  };
}
