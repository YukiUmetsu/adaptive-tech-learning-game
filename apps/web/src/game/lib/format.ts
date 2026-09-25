import type { AttackType } from "../models/attack";
import { ATTACK_TYPE_LABELS } from "../models/attack";
import type { DefenseDefinition } from "../models/defense";

/**
 * Small presentation helpers shared by the game components.
 *
 * Kept separate from the engine so the simulation never depends on UI text.
 */

const SHORT_LABELS: Record<string, string> = {
  waf: "WAF",
  rate_limiter: "Rate",
  traffic_analyzer: "Analyze",
  traffic_blocker: "Blocker",
  input_validation: "Input",
  parameterized_queries: "PQ",
  xss_protection: "XSS",
  mfa: "MFA",
  least_privilege: "LP",
  monitoring: "IDS",
  backup: "Backup",
};

/** Compact label used on the map chips and catalog tabs. */
export function defenseShortLabel(defense: DefenseDefinition): string {
  return SHORT_LABELS[defense.id] ?? defense.name.split(" ")[0];
}

/** Human-readable attack type label. */
export function attackLabel(attackType: AttackType): string {
  return ATTACK_TYPE_LABELS[attackType] ?? attackType;
}

/** Renders an effectiveness value (0..1) as a five-star string. */
export function effectivenessStars(value: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(value * 5)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/** Formats a duration as m:ss for the HUD. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export type AttackVisualTone = "ddos" | "injection" | "identity" | "malware";

/** Maps an attack type to a small, non-color-only visual tone. */
export function attackTone(attackType: AttackType): AttackVisualTone {
  switch (attackType) {
    case "ddos":
      return "ddos";
    case "sql_injection":
    case "xss":
    case "prompt_injection":
      return "injection";
    case "credential_stuffing":
      return "identity";
    case "ransomware":
      return "malware";
  }
}
