import type { components } from "../../api/schema";

/**
 * Repeatable Operation views.
 *
 * The server generates and persists the authoritative Operation snapshot; the
 * client only renders it and adapts it to the Stage 1 mission engine. These
 * aliases keep the client types generated from the Rust contract.
 */

export type GeneratedOperation = components["schemas"]["GeneratedOperation"];
export type GeneratedWave = components["schemas"]["GeneratedWave"];
export type GeneratedSpawnGroup = components["schemas"]["GeneratedSpawnGroup"];
export type GeneratedModifier = components["schemas"]["GeneratedModifier"];

/** Threat Level bounds, mirroring the server. */
export const THREAT_LEVEL_MIN = 1;
export const THREAT_LEVEL_MAX = 10;

/** Clamps a Threat Level to the public range. */
export function clampThreatLevel(value: number): number {
  return Math.max(THREAT_LEVEL_MIN, Math.min(THREAT_LEVEL_MAX, Math.round(value)));
}
