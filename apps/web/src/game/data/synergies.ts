import type { SynergyDefinition } from "../models/mission";

/**
 * Defense-in-depth synergies (spec section 18).
 *
 * A small, visible set of combinations — no hidden matrix. When both defenses
 * are deployed the bonus is shown in the HUD and applied by the combat resolver.
 */
export const SYNERGIES: SynergyDefinition[] = [
  {
    id: "waf_parameterized",
    name: "Defense in Depth",
    description:
      "WAF + Parameterized Queries: +10% protection against SQL Injection.",
    defenseIds: ["waf", "parameterized_queries"],
    attackType: "sql_injection",
    damageBonus: 0.1,
  },
  {
    id: "rate_limit_mfa",
    name: "Layered Identity Defense",
    description:
      "Rate Limiter + MFA: +10% protection against Credential Stuffing.",
    defenseIds: ["rate_limiter", "mfa"],
    attackType: "credential_stuffing",
    damageBonus: 0.1,
  },
  {
    id: "monitoring_waf",
    name: "Detect and Filter",
    description:
      "Monitoring + WAF: +10% protection from better-tuned filtering.",
    defenseIds: ["monitoring", "waf"],
    damageBonus: 0.1,
  },
  {
    id: "least_privilege_mfa",
    name: "Contained Identity",
    description:
      "Least Privilege + MFA: -10% damage from Credential Stuffing.",
    defenseIds: ["least_privilege", "mfa"],
    attackType: "credential_stuffing",
    damageReductionBonus: 0.1,
  },
  {
    id: "backup_least_privilege",
    name: "Recover Safely",
    description: "Backup + Least Privilege: -15% damage from Ransomware.",
    defenseIds: ["backup", "least_privilege"],
    attackType: "ransomware",
    damageReductionBonus: 0.15,
  },
];

export const SYNERGIES_BY_ID: Record<string, SynergyDefinition> =
  Object.fromEntries(SYNERGIES.map((synergy) => [synergy.id, synergy]));
