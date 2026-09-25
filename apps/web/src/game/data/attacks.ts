import type { AttackDefinition } from "../models/attack";

/**
 * MVP attack catalogue.
 *
 * Values are tuned for a short, readable mission, not realism. `health` is
 * "attack effort remaining"; `systemDamage` is what a fully successful attack
 * removes from system health. Leaked damage scales with the remaining health of
 * the attack (see `combat.ts`), so partial mitigation still helps.
 */
export const ATTACKS: AttackDefinition[] = [
  {
    id: "ddos_swarm",
    name: "DDoS Swarm",
    description:
      "A flood of junk requests trying to exhaust capacity and take the API offline.",
    attackType: "ddos",
    speed: 0.5,
    health: 18,
    systemDamage: 6,
    targetNodeId: "api",
    tags: ["swarm"],
  },
  {
    id: "sql_injection",
    name: "SQL Injection",
    description:
      "Malicious input crafted to slip past the application and reach the database query.",
    attackType: "sql_injection",
    speed: 0.28,
    health: 70,
    systemDamage: 12,
    targetNodeId: "db",
  },
  {
    id: "xss",
    name: "Cross-Site Scripting",
    description:
      "Injected script that runs in the browser and attacks users of the application.",
    attackType: "xss",
    speed: 0.38,
    health: 38,
    systemDamage: 8,
    targetNodeId: "app",
  },
  {
    id: "credential_stuffing",
    name: "Credential Stuffing",
    description:
      "Stolen username and password pairs replayed to take over valid accounts.",
    attackType: "credential_stuffing",
    speed: 0.32,
    health: 78,
    systemDamage: 10,
    targetNodeId: "app",
  },
  {
    id: "ransomware",
    name: "Ransomware",
    description:
      "An intruder that encrypts data and demands payment. Hard to fully stop once inside.",
    attackType: "ransomware",
    speed: 0.22,
    health: 110,
    systemDamage: 22,
    targetNodeId: "db",
  },
  {
    id: "botnet_ddos_boss",
    name: "Botnet DDoS",
    description:
      "A coordinated botnet that keeps summoning junk traffic while it hammers the stack.",
    attackType: "ddos",
    speed: 0.14,
    health: 1500,
    systemDamage: 30,
    targetNodeId: "db",
    boss: true,
    summons: [{ attackId: "ddos_swarm", count: 3, intervalMs: 4000 }],
  },
];

/** Lookup map for engine and UI. */
export const ATTACKS_BY_ID: Record<string, AttackDefinition> =
  Object.fromEntries(ATTACKS.map((attack) => [attack.id, attack]));
