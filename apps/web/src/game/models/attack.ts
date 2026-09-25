/**
 * Attack (enemy) model.
 *
 * An attack is a simplified representation of a real cyber attack. Health is a
 * game abstraction for "how much attack effort remains", not a claim that real
 * attacks have hit points. See spec section 11.
 */

export type AttackType =
  | "ddos"
  | "sql_injection"
  | "xss"
  | "credential_stuffing"
  | "prompt_injection"
  | "ransomware";

export interface AttackSummon {
  attackId: string;
  count: number;
  intervalMs: number;
}

export interface AttackDefinition {
  id: string;
  name: string;
  description: string;
  attackType: AttackType;
  /** Travel speed in logical path segments per second. Layout-independent. */
  speed: number;
  /** Attack effort that defenses must reduce to zero to block the attack. */
  health: number;
  /** System health removed if the attack reaches its target. */
  systemDamage: number;
  /** Node the attack is trying to reach. */
  targetNodeId: string;
  tags?: string[];
  /** Hidden attacks only show their type once Detection is present. */
  hiddenUntilDetected?: boolean;
  /** Boss: shown with a boss health bar and a dramatic entrance. */
  boss?: boolean;
  /** Boss behaviour: spawns smaller units while alive. */
  summons?: AttackSummon[];
}

export const ATTACK_TYPE_LABELS: Record<AttackType, string> = {
  ddos: "DDoS",
  sql_injection: "SQL Injection",
  xss: "XSS",
  credential_stuffing: "Credential Stuffing",
  prompt_injection: "Prompt Injection",
  ransomware: "Ransomware",
};
