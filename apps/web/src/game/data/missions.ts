import type { MissionDefinition } from "../models/mission";

/**
 * MVP missions (spec section 40).
 *
 * DDoS traffic comes in large swarms: a Rate Limiter gate congests it, and a
 * Traffic Blocker (boosted by an upstream Traffic Analyzer) shreds it.
 */
export const MISSIONS: MissionDefinition[] = [
  {
    id: "ddos-basics",
    title: "Protect the Storefront",
    description:
      "Keep the storefront online while a flood of junk traffic targets the API.",
    threatSummary: ["DDoS floods"],
    startingBudget: 700,
    startingHealth: 100,
    latencyTargetMs: 150,
    recommendedSpend: 650,
    waveClearBonus: 70,
    earlyCallBonusPerSecond: 5,
    map: {
      entryNodeId: "internet",
      nodes: [
        { id: "internet", type: "edge", label: "Internet" },
        { id: "edge", type: "edge", label: "Edge" },
        { id: "api", type: "api", label: "API" },
      ],
      edges: [
        { from: "internet", to: "edge" },
        { from: "edge", to: "api" },
      ],
    },
    availableDefenses: ["rate_limiter", "traffic_analyzer", "traffic_blocker"],
    availableHeroes: ["sre"],
    waves: [
      { groups: [{ attackId: "ddos_swarm", count: 24, spawnIntervalMs: 300 }] },
      { groups: [{ attackId: "ddos_swarm", count: 36, spawnIntervalMs: 260 }] },
      { groups: [{ attackId: "ddos_swarm", count: 48, spawnIntervalMs: 220 }] },
    ],
    lessons: {
      completion:
        "A Traffic Analyzer makes a downstream Traffic Blocker far stronger, and the Rate Limiter gate keeps the flood from ever reaching the API.",
      failure: {
        ddos: "The API was overwhelmed. Put a Rate Limiter gate at the edge and a Traffic Analyzer before a Traffic Blocker.",
      },
    },
  },
  {
    id: "sql-injection",
    title: "Seal the Query",
    description:
      "Attackers are probing the API with malicious input aimed at the database.",
    threatSummary: ["SQL Injection"],
    startingBudget: 850,
    startingHealth: 100,
    latencyTargetMs: 200,
    recommendedSpend: 700,
    waveClearBonus: 80,
    earlyCallBonusPerSecond: 5,
    map: {
      entryNodeId: "internet",
      nodes: [
        { id: "internet", type: "edge", label: "Internet" },
        { id: "api", type: "api", label: "API" },
        { id: "app", type: "application", label: "Application" },
        { id: "db", type: "database", label: "Database" },
      ],
      edges: [
        { from: "internet", to: "api" },
        { from: "api", to: "app" },
        { from: "app", to: "db" },
      ],
    },
    availableDefenses: ["waf", "parameterized_queries", "input_validation"],
    availableHeroes: ["security_engineer"],
    waves: [
      { groups: [{ attackId: "sql_injection", count: 4, spawnIntervalMs: 1200 }] },
      { groups: [{ attackId: "sql_injection", count: 6, spawnIntervalMs: 950 }] },
      { groups: [{ attackId: "sql_injection", count: 5, spawnIntervalMs: 850 }] },
    ],
    lessons: {
      completion:
        "The WAF reduced malicious requests, but Parameterized Queries provided the strongest SQL Injection protection.",
      failure: {
        sql_injection:
          "The vulnerable query stayed exploitable. A WAF filters traffic; Parameterized Queries remove the root cause.",
      },
    },
  },
  {
    id: "credential-stuffing",
    title: "Lock the Accounts",
    description:
      "Stolen username and password pairs are being replayed against the login flow.",
    threatSummary: ["Credential Stuffing"],
    startingBudget: 750,
    startingHealth: 100,
    latencyTargetMs: 180,
    recommendedSpend: 650,
    waveClearBonus: 70,
    earlyCallBonusPerSecond: 5,
    map: {
      entryNodeId: "internet",
      nodes: [
        { id: "internet", type: "edge", label: "Internet" },
        { id: "api", type: "api", label: "API" },
        { id: "auth", type: "auth", label: "Identity" },
        { id: "app", type: "application", label: "Application" },
      ],
      edges: [
        { from: "internet", to: "api" },
        { from: "api", to: "auth" },
        { from: "auth", to: "app" },
      ],
    },
    availableDefenses: ["rate_limiter", "mfa", "least_privilege"],
    availableHeroes: ["security_engineer"],
    waves: [
      {
        groups: [
          { attackId: "credential_stuffing", count: 5, spawnIntervalMs: 1100 },
        ],
      },
      {
        groups: [
          { attackId: "credential_stuffing", count: 8, spawnIntervalMs: 900 },
        ],
      },
      {
        groups: [
          { attackId: "credential_stuffing", count: 6, spawnIntervalMs: 800 },
        ],
      },
    ],
    lessons: {
      completion:
        "MFA stopped account takeover even when passwords were reused. The rate limiter slowed the attempts but was not enough on its own.",
      failure: {
        credential_stuffing:
          "The attacker obtained a valid account and reached the application. MFA is the strongest defense against credential stuffing.",
      },
    },
  },
  {
    id: "mixed-defense",
    title: "Defend the Whole Stack",
    description:
      "Multiple attack types hit different layers at once. Choose controls that cover the whole architecture.",
    threatSummary: ["DDoS", "SQL Injection", "XSS", "Credential Stuffing", "Ransomware"],
    startingBudget: 1400,
    startingHealth: 120,
    latencyTargetMs: 260,
    recommendedSpend: 1250,
    waveClearBonus: 100,
    earlyCallBonusPerSecond: 6,
    map: {
      entryNodeId: "internet",
      nodes: [
        { id: "internet", type: "edge", label: "Internet" },
        { id: "edge", type: "edge", label: "Edge" },
        { id: "api", type: "api", label: "API" },
        { id: "auth", type: "auth", label: "Identity" },
        { id: "app", type: "application", label: "Application" },
        { id: "db", type: "database", label: "Database" },
      ],
      edges: [
        { from: "internet", to: "edge" },
        { from: "edge", to: "api" },
        { from: "api", to: "auth" },
        { from: "auth", to: "app" },
        { from: "app", to: "db" },
      ],
    },
    availableDefenses: [
      "waf",
      "rate_limiter",
      "traffic_analyzer",
      "traffic_blocker",
      "parameterized_queries",
      "xss_protection",
      "mfa",
      "least_privilege",
      "backup",
    ],
    availableHeroes: ["security_engineer", "sre"],
    waves: [
      {
        groups: [
          { attackId: "ddos_swarm", count: 24, spawnIntervalMs: 280 },
          { attackId: "credential_stuffing", count: 4, spawnIntervalMs: 1100 },
        ],
      },
      {
        groups: [
          { attackId: "sql_injection", count: 4, spawnIntervalMs: 1000 },
          { attackId: "xss", count: 5, spawnIntervalMs: 800 },
        ],
      },
      {
        groups: [
          { attackId: "ransomware", count: 3, spawnIntervalMs: 1800 },
          { attackId: "sql_injection", count: 3, spawnIntervalMs: 1200 },
        ],
      },
    ],
    lessons: {
      completion:
        "Layering controls at the edge, identity, and application kept every attack type contained.",
      failure: {
        ddos: "Volumetric attacks need a gate and a blocker at the edge.",
        sql_injection:
          "Parameterized Queries are the reliable fix for SQL Injection, not just filtering.",
        credential_stuffing: "MFA prevents a stolen password from becoming a valid session.",
        ransomware:
          "Ransomware is hard to stop completely. Least Privilege limits the blast radius and Backup restores what was lost.",
        xss: "Prevent script execution at the application layer; a WAF alone only reduces the traffic.",
      },
    },
  },
  {
    id: "botnet-boss",
    title: "Boss: Botnet DDoS",
    description:
      "A coordinated botnet is hammering the stack while summoning junk traffic.",
    threatSummary: ["Botnet DDoS", "DDoS Swarms", "Mixed attacks"],
    startingBudget: 1800,
    startingHealth: 130,
    latencyTargetMs: 300,
    recommendedSpend: 1700,
    waveClearBonus: 120,
    earlyCallBonusPerSecond: 6,
    requiresMissionId: "mixed-defense",
    map: {
      entryNodeId: "internet",
      nodes: [
        { id: "internet", type: "edge", label: "Internet" },
        { id: "edge", type: "edge", label: "Edge" },
        { id: "api", type: "api", label: "API" },
        { id: "app", type: "application", label: "Application" },
        { id: "db", type: "database", label: "Database" },
      ],
      edges: [
        { from: "internet", to: "edge" },
        { from: "edge", to: "api" },
        { from: "api", to: "app" },
        { from: "app", to: "db" },
      ],
    },
    availableDefenses: [
      "rate_limiter",
      "traffic_analyzer",
      "traffic_blocker",
      "waf",
      "parameterized_queries",
      "monitoring",
      "backup",
      "mfa",
    ],
    availableHeroes: ["security_engineer", "sre"],
    waves: [
      { groups: [{ attackId: "ddos_swarm", count: 42, spawnIntervalMs: 220 }] },
      {
        groups: [
          { attackId: "sql_injection", count: 4, spawnIntervalMs: 1100 },
          { attackId: "credential_stuffing", count: 5, spawnIntervalMs: 950 },
        ],
      },
      {
        boss: true,
        groups: [
          { attackId: "botnet_ddos_boss", count: 1, spawnIntervalMs: 1000 },
          { attackId: "ddos_swarm", count: 30, spawnIntervalMs: 300 },
        ],
      },
    ],
    lessons: {
      completion:
        "Volumetric attacks scale, so a gate plus an analyzer-boosted blocker at the edge is the reliable answer.",
      failure: {
        ddos: "The botnet overwhelmed the edge because volumetric protection was missing or too weak.",
        sql_injection: "Layered application defenses are still needed when the bots are not the only threat.",
        credential_stuffing: "Identity controls matter even during a DDoS, because attackers mix techniques.",
      },
    },
  },
];

export const MISSIONS_BY_ID: Record<string, MissionDefinition> = Object.fromEntries(
  MISSIONS.map((mission) => [mission.id, mission]),
);
