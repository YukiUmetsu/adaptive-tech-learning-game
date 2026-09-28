//! Repeatable Operation definitions and the deterministic generator.
//!
//! The server is authoritative for Operation identity: the same
//! `seed + template + adversary + threat level + adversary rank` always produces
//! the exact same Operation, and the generated snapshot is persisted so later
//! content or balance changes cannot alter an in-progress run.
//!
//! This module holds a compact canonical catalog of the Stage 1 attacks,
//! defenses, maps, and heroes, plus the Stage 2 templates, adversaries, and
//! modifiers. It intentionally reuses the existing Stage 1 content rather than
//! adding new enemy types.
//!
//! See `docs/cyber-defense-game/Stage2.md` steps 9 and 10.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::cyber_defense::{
    CyberReward, DEFAULT_HERO_IDS, THREAT_LEVEL_MAX, THREAT_LEVEL_MIN, operation_reward,
};

/// One attack the generator may schedule.
#[derive(Debug, Clone, Copy)]
pub struct OperationAttack {
    /// Attack identifier.
    pub id: &'static str,
    /// Attack family.
    pub attack_type: &'static str,
    /// Node the attack targets.
    pub target_node_id: &'static str,
    /// Boss attack.
    pub boss: bool,
    /// High-volume swarm attack.
    pub swarm: bool,
    /// Typical unit count at Threat 1.
    pub base_count: i32,
    /// Typical spawn interval in milliseconds.
    pub base_interval_ms: i32,
}

/// Every Stage 1 attack, available to Operations.
pub const OPERATION_ATTACKS: &[OperationAttack] = &[
    OperationAttack {
        id: "ddos_swarm",
        attack_type: "ddos",
        target_node_id: "api",
        boss: false,
        swarm: true,
        base_count: 24,
        base_interval_ms: 280,
    },
    OperationAttack {
        id: "sql_injection",
        attack_type: "sql_injection",
        target_node_id: "db",
        boss: false,
        swarm: false,
        base_count: 4,
        base_interval_ms: 1000,
    },
    OperationAttack {
        id: "xss",
        attack_type: "xss",
        target_node_id: "app",
        boss: false,
        swarm: false,
        base_count: 5,
        base_interval_ms: 800,
    },
    OperationAttack {
        id: "credential_stuffing",
        attack_type: "credential_stuffing",
        target_node_id: "app",
        boss: false,
        swarm: false,
        base_count: 5,
        base_interval_ms: 1000,
    },
    OperationAttack {
        id: "ransomware",
        attack_type: "ransomware",
        target_node_id: "db",
        boss: false,
        swarm: false,
        base_count: 3,
        base_interval_ms: 1800,
    },
    OperationAttack {
        id: "botnet_ddos_boss",
        attack_type: "ddos",
        target_node_id: "db",
        boss: true,
        swarm: false,
        base_count: 1,
        base_interval_ms: 1000,
    },
];

/// One defense the generator may offer.
#[derive(Debug, Clone, Copy)]
pub struct OperationDefense {
    /// Defense identifier.
    pub id: &'static str,
    /// Mission-credit placement cost, used for the affordability invariant.
    pub cost: i32,
    /// Node types this control may be placed on.
    pub allowed_placements: &'static [&'static str],
    /// Attack families this control meaningfully counters.
    pub counters: &'static [&'static str],
    /// Whether this control reveals hidden traffic.
    pub reveals_hidden: bool,
}

/// Every Stage 1 defense, available to Operations.
pub const OPERATION_DEFENSES: &[OperationDefense] = &[
    OperationDefense {
        id: "waf",
        cost: 200,
        allowed_placements: &["edge", "api"],
        counters: &["sql_injection", "xss", "ddos"],
        reveals_hidden: false,
    },
    OperationDefense {
        id: "rate_limiter",
        cost: 150,
        allowed_placements: &["edge", "api", "auth"],
        counters: &["ddos", "credential_stuffing"],
        reveals_hidden: false,
    },
    OperationDefense {
        id: "traffic_analyzer",
        cost: 180,
        allowed_placements: &["edge", "api"],
        counters: &["ddos"],
        reveals_hidden: true,
    },
    OperationDefense {
        id: "traffic_blocker",
        cost: 220,
        allowed_placements: &["edge", "api"],
        counters: &["ddos", "credential_stuffing"],
        reveals_hidden: false,
    },
    OperationDefense {
        id: "input_validation",
        cost: 160,
        allowed_placements: &["api", "application"],
        counters: &["sql_injection", "xss", "ransomware"],
        reveals_hidden: false,
    },
    OperationDefense {
        id: "parameterized_queries",
        cost: 300,
        allowed_placements: &["application", "database"],
        counters: &["sql_injection"],
        reveals_hidden: false,
    },
    OperationDefense {
        id: "xss_protection",
        cost: 260,
        allowed_placements: &["application", "api"],
        counters: &["xss"],
        reveals_hidden: false,
    },
    OperationDefense {
        id: "mfa",
        cost: 250,
        allowed_placements: &["auth", "application"],
        counters: &["credential_stuffing"],
        reveals_hidden: false,
    },
    OperationDefense {
        id: "least_privilege",
        cost: 200,
        allowed_placements: &["auth", "application", "database"],
        counters: &["ransomware"],
        reveals_hidden: false,
    },
    OperationDefense {
        id: "monitoring",
        cost: 180,
        allowed_placements: &["edge", "api", "application"],
        counters: &["ransomware"],
        reveals_hidden: true,
    },
    OperationDefense {
        id: "backup",
        cost: 220,
        allowed_placements: &["application", "database"],
        counters: &["ransomware"],
        reveals_hidden: false,
    },
];

/// One node in an Operation map.
#[derive(Debug, Clone, Copy)]
pub struct OperationMapNode {
    /// Node identifier.
    pub id: &'static str,
    /// Node type.
    pub node_type: &'static str,
}

/// One directed edge in an Operation map.
#[derive(Debug, Clone, Copy)]
pub struct OperationMapEdge {
    /// Source node.
    pub from: &'static str,
    /// Destination node.
    pub to: &'static str,
}

/// A logical architecture map for Operations.
#[derive(Debug, Clone, Copy)]
pub struct OperationMap {
    /// Map identifier.
    pub id: &'static str,
    /// Public entry point.
    pub entry_node_id: &'static str,
    /// Nodes.
    pub nodes: &'static [OperationMapNode],
    /// Directed edges.
    pub edges: &'static [OperationMapEdge],
}

const EDGE_BASIC_NODES: &[OperationMapNode] = &[
    OperationMapNode {
        id: "internet",
        node_type: "edge",
    },
    OperationMapNode {
        id: "edge",
        node_type: "edge",
    },
    OperationMapNode {
        id: "api",
        node_type: "api",
    },
];
const EDGE_BASIC_EDGES: &[OperationMapEdge] = &[
    OperationMapEdge {
        from: "internet",
        to: "edge",
    },
    OperationMapEdge {
        from: "edge",
        to: "api",
    },
];

const WEB_STACK_NODES: &[OperationMapNode] = &[
    OperationMapNode {
        id: "internet",
        node_type: "edge",
    },
    OperationMapNode {
        id: "api",
        node_type: "api",
    },
    OperationMapNode {
        id: "app",
        node_type: "application",
    },
    OperationMapNode {
        id: "db",
        node_type: "database",
    },
];
const WEB_STACK_EDGES: &[OperationMapEdge] = &[
    OperationMapEdge {
        from: "internet",
        to: "api",
    },
    OperationMapEdge {
        from: "api",
        to: "app",
    },
    OperationMapEdge {
        from: "app",
        to: "db",
    },
];

const IDENTITY_STACK_NODES: &[OperationMapNode] = &[
    OperationMapNode {
        id: "internet",
        node_type: "edge",
    },
    OperationMapNode {
        id: "api",
        node_type: "api",
    },
    OperationMapNode {
        id: "auth",
        node_type: "auth",
    },
    OperationMapNode {
        id: "app",
        node_type: "application",
    },
];
const IDENTITY_STACK_EDGES: &[OperationMapEdge] = &[
    OperationMapEdge {
        from: "internet",
        to: "api",
    },
    OperationMapEdge {
        from: "api",
        to: "auth",
    },
    OperationMapEdge {
        from: "auth",
        to: "app",
    },
];

const FULL_STACK_NODES: &[OperationMapNode] = &[
    OperationMapNode {
        id: "internet",
        node_type: "edge",
    },
    OperationMapNode {
        id: "edge",
        node_type: "edge",
    },
    OperationMapNode {
        id: "api",
        node_type: "api",
    },
    OperationMapNode {
        id: "auth",
        node_type: "auth",
    },
    OperationMapNode {
        id: "app",
        node_type: "application",
    },
    OperationMapNode {
        id: "db",
        node_type: "database",
    },
];
const FULL_STACK_EDGES: &[OperationMapEdge] = &[
    OperationMapEdge {
        from: "internet",
        to: "edge",
    },
    OperationMapEdge {
        from: "edge",
        to: "api",
    },
    OperationMapEdge {
        from: "api",
        to: "auth",
    },
    OperationMapEdge {
        from: "auth",
        to: "app",
    },
    OperationMapEdge {
        from: "app",
        to: "db",
    },
];

const DEEP_STACK_NODES: &[OperationMapNode] = &[
    OperationMapNode {
        id: "internet",
        node_type: "edge",
    },
    OperationMapNode {
        id: "edge",
        node_type: "edge",
    },
    OperationMapNode {
        id: "api",
        node_type: "api",
    },
    OperationMapNode {
        id: "app",
        node_type: "application",
    },
    OperationMapNode {
        id: "db",
        node_type: "database",
    },
];
const DEEP_STACK_EDGES: &[OperationMapEdge] = &[
    OperationMapEdge {
        from: "internet",
        to: "edge",
    },
    OperationMapEdge {
        from: "edge",
        to: "api",
    },
    OperationMapEdge {
        from: "api",
        to: "app",
    },
    OperationMapEdge {
        from: "app",
        to: "db",
    },
];

// Branching topologies. These deliberately put attack targets on parallel
// branches so a single chokepoint control no longer covers every route, which
// changes placement decisions without touching the engine.

/// Dual Service: the API and application live on parallel branches into one
/// database, so edge controls alone cannot cover both.
const DUAL_SERVICE_NODES: &[OperationMapNode] = &[
    OperationMapNode {
        id: "internet",
        node_type: "edge",
    },
    OperationMapNode {
        id: "edge",
        node_type: "edge",
    },
    OperationMapNode {
        id: "api",
        node_type: "api",
    },
    OperationMapNode {
        id: "app",
        node_type: "application",
    },
    OperationMapNode {
        id: "db",
        node_type: "database",
    },
];
const DUAL_SERVICE_EDGES: &[OperationMapEdge] = &[
    OperationMapEdge {
        from: "internet",
        to: "edge",
    },
    OperationMapEdge {
        from: "edge",
        to: "api",
    },
    OperationMapEdge {
        from: "edge",
        to: "app",
    },
    OperationMapEdge {
        from: "api",
        to: "db",
    },
    OperationMapEdge {
        from: "app",
        to: "db",
    },
];

/// Identity Fork: every request passes the identity layer, which then splits to
/// the application and the database.
const IDENTITY_FORK_NODES: &[OperationMapNode] = &[
    OperationMapNode {
        id: "internet",
        node_type: "edge",
    },
    OperationMapNode {
        id: "api",
        node_type: "api",
    },
    OperationMapNode {
        id: "auth",
        node_type: "auth",
    },
    OperationMapNode {
        id: "app",
        node_type: "application",
    },
    OperationMapNode {
        id: "db",
        node_type: "database",
    },
];
const IDENTITY_FORK_EDGES: &[OperationMapEdge] = &[
    OperationMapEdge {
        from: "internet",
        to: "api",
    },
    OperationMapEdge {
        from: "api",
        to: "auth",
    },
    OperationMapEdge {
        from: "auth",
        to: "app",
    },
    OperationMapEdge {
        from: "auth",
        to: "db",
    },
    OperationMapEdge {
        from: "app",
        to: "db",
    },
];

/// Service Mesh: the edge can reach the API or the database directly, and the
/// API fronts the application, so coverage depends on which hop is hardened.
const SERVICE_MESH_NODES: &[OperationMapNode] = &[
    OperationMapNode {
        id: "internet",
        node_type: "edge",
    },
    OperationMapNode {
        id: "edge",
        node_type: "edge",
    },
    OperationMapNode {
        id: "api",
        node_type: "api",
    },
    OperationMapNode {
        id: "app",
        node_type: "application",
    },
    OperationMapNode {
        id: "db",
        node_type: "database",
    },
];
const SERVICE_MESH_EDGES: &[OperationMapEdge] = &[
    OperationMapEdge {
        from: "internet",
        to: "edge",
    },
    OperationMapEdge {
        from: "edge",
        to: "api",
    },
    OperationMapEdge {
        from: "edge",
        to: "db",
    },
    OperationMapEdge {
        from: "api",
        to: "app",
    },
    OperationMapEdge {
        from: "app",
        to: "db",
    },
];

/// Every Operation map.
pub const OPERATION_MAPS: &[OperationMap] = &[
    OperationMap {
        id: "edge-basic",
        entry_node_id: "internet",
        nodes: EDGE_BASIC_NODES,
        edges: EDGE_BASIC_EDGES,
    },
    OperationMap {
        id: "web-stack",
        entry_node_id: "internet",
        nodes: WEB_STACK_NODES,
        edges: WEB_STACK_EDGES,
    },
    OperationMap {
        id: "identity-stack",
        entry_node_id: "internet",
        nodes: IDENTITY_STACK_NODES,
        edges: IDENTITY_STACK_EDGES,
    },
    OperationMap {
        id: "full-stack",
        entry_node_id: "internet",
        nodes: FULL_STACK_NODES,
        edges: FULL_STACK_EDGES,
    },
    OperationMap {
        id: "deep-stack",
        entry_node_id: "internet",
        nodes: DEEP_STACK_NODES,
        edges: DEEP_STACK_EDGES,
    },
    OperationMap {
        id: "dual-service",
        entry_node_id: "internet",
        nodes: DUAL_SERVICE_NODES,
        edges: DUAL_SERVICE_EDGES,
    },
    OperationMap {
        id: "identity-fork",
        entry_node_id: "internet",
        nodes: IDENTITY_FORK_NODES,
        edges: IDENTITY_FORK_EDGES,
    },
    OperationMap {
        id: "service-mesh",
        entry_node_id: "internet",
        nodes: SERVICE_MESH_NODES,
        edges: SERVICE_MESH_EDGES,
    },
];

/// One Operation template.
#[derive(Debug, Clone, Copy)]
pub struct OperationTemplate {
    /// Template identifier.
    pub id: &'static str,
    /// Learner-facing summary.
    pub summary: &'static str,
    /// Candidate titles.
    pub title_pool: &'static [&'static str],
    /// Map used by the template.
    pub map_id: &'static str,
    /// Adversaries that may run this template.
    pub adversary_ids: &'static [&'static str],
    /// Attack families the composition may draw from.
    pub allowed_attack_types: &'static [&'static str],
    /// Minimum counter package that must be available and affordable.
    pub required_counter_defense_ids: &'static [&'static str],
    /// Base starting budget before scaling.
    pub base_budget: i32,
    /// Base starting health.
    pub base_health: i32,
    /// Base latency target.
    pub base_latency_target_ms: i32,
    /// Minimum waves.
    pub min_waves: i32,
    /// Maximum waves.
    pub max_waves: i32,
    /// Modifiers this template may roll.
    pub allowed_modifier_ids: &'static [&'static str],
    /// Maximum modifiers.
    pub max_modifiers: i32,
    /// Optional boss attack, used when the map has a valid target.
    pub boss_attack_id: Option<&'static str>,
    /// Whether the random Operation picker may choose this template.
    ///
    /// Story-gated climax templates set this to `false`: they are only started
    /// explicitly once their story/adversary milestone is reached.
    pub random_pick: bool,
}

/// Every Operation template.
pub const OPERATION_TEMPLATES: &[OperationTemplate] = &[
    OperationTemplate {
        id: "identity-breach",
        random_pick: true,
        summary: "Credential attacks are replayed against the sign-in flow.",
        title_pool: &["Credential Cascade", "Silent Takeover", "Locked Accounts"],
        map_id: "identity-fork",
        adversary_ids: &["ghost-7"],
        allowed_attack_types: &["credential_stuffing"],
        required_counter_defense_ids: &["mfa"],
        base_budget: 750,
        base_health: 100,
        base_latency_target_ms: 180,
        min_waves: 3,
        max_waves: 5,
        allowed_modifier_ids: &["hidden_traffic", "credential_surge", "identity_pressure"],
        max_modifiers: 2,
        boss_attack_id: None,
    },
    OperationTemplate {
        id: "web-assault",
        random_pick: true,
        summary: "Malicious input probes the application and database layers.",
        title_pool: &["Injection Wave", "Query Breach", "Script Injection"],
        map_id: "dual-service",
        adversary_ids: &["null"],
        allowed_attack_types: &["sql_injection", "xss"],
        required_counter_defense_ids: &["parameterized_queries"],
        base_budget: 850,
        base_health: 100,
        base_latency_target_ms: 200,
        min_waves: 3,
        max_waves: 5,
        allowed_modifier_ids: &["mixed_vector", "strict_latency", "application_pressure"],
        max_modifiers: 2,
        boss_attack_id: None,
    },
    OperationTemplate {
        id: "availability-siege",
        random_pick: true,
        summary: "A flood of junk traffic tries to exhaust the edge.",
        title_pool: &["Traffic Siege", "Capacity Crunch", "Flood the Edge"],
        map_id: "service-mesh",
        adversary_ids: &["null"],
        allowed_attack_types: &["ddos"],
        required_counter_defense_ids: &["rate_limiter", "traffic_blocker"],
        base_budget: 700,
        base_health: 100,
        base_latency_target_ms: 150,
        min_waves: 3,
        max_waves: 4,
        allowed_modifier_ids: &["mixed_vector", "strict_latency", "hardened_campaign"],
        max_modifiers: 2,
        boss_attack_id: None,
    },
    OperationTemplate {
        id: "mixed-intrusion",
        random_pick: true,
        summary: "Several attack families hit different layers at once.",
        title_pool: &["Layered Intrusion", "Coordinated Push", "Stack Assault"],
        map_id: "full-stack",
        adversary_ids: &["ghost-7", "null"],
        allowed_attack_types: &["ddos", "sql_injection", "xss", "credential_stuffing"],
        required_counter_defense_ids: &["waf", "mfa"],
        base_budget: 1400,
        base_health: 120,
        base_latency_target_ms: 260,
        min_waves: 4,
        max_waves: 6,
        allowed_modifier_ids: &[
            "hidden_traffic",
            "mixed_vector",
            "application_pressure",
            "strict_latency",
            "hardened_campaign",
        ],
        max_modifiers: 2,
        boss_attack_id: Some("botnet_ddos_boss"),
    },
    OperationTemplate {
        id: "recovery-crisis",
        random_pick: true,
        summary: "High-impact malware pressures containment and recovery.",
        title_pool: &["Ransomware Lock", "Recovery Under Fire", "Encrypted Core"],
        map_id: "deep-stack",
        adversary_ids: &["viper"],
        allowed_attack_types: &["ransomware", "credential_stuffing"],
        required_counter_defense_ids: &["backup", "least_privilege"],
        base_budget: 1200,
        base_health: 120,
        base_latency_target_ms: 240,
        min_waves: 4,
        max_waves: 6,
        allowed_modifier_ids: &["recovery_pressure", "hardened_campaign", "delayed_impact"],
        max_modifiers: 2,
        boss_attack_id: None,
    },
    OperationTemplate {
        id: "ghost7-confrontation",
        random_pick: false,
        summary: "GHOST-7 commits everything it has left. This is the confrontation the campaign built toward.",
        title_pool: &["The Confrontation", "GHOST-7: Final Push"],
        map_id: "full-stack",
        adversary_ids: &["ghost-7"],
        allowed_attack_types: &["credential_stuffing", "ddos", "sql_injection"],
        required_counter_defense_ids: &["mfa", "waf"],
        base_budget: 1650,
        base_health: 140,
        base_latency_target_ms: 280,
        min_waves: 5,
        max_waves: 7,
        allowed_modifier_ids: &[
            "hidden_traffic",
            "credential_surge",
            "identity_pressure",
            "mixed_vector",
        ],
        max_modifiers: 2,
        boss_attack_id: Some("botnet_ddos_boss"),
    },
];

/// One recurring adversary.
#[derive(Debug, Clone, Copy)]
pub struct OperationAdversary {
    /// Adversary identifier.
    pub id: &'static str,
    /// Learner-facing name.
    pub name: &'static str,
    /// Specialty summary shown in briefings and dossiers.
    pub specialty: &'static str,
    /// Attack families the adversary favours.
    pub preferred_attack_types: &'static [&'static str],
    /// Modifiers the adversary may field.
    pub modifier_ids: &'static [&'static str],
}

/// The three Stage 2 adversaries.
pub const OPERATION_ADVERSARIES: &[OperationAdversary] = &[
    OperationAdversary {
        id: "ghost-7",
        name: "GHOST-7",
        specialty: "Identity and credential specialist",
        preferred_attack_types: &["credential_stuffing"],
        modifier_ids: &["hidden_traffic", "credential_surge", "identity_pressure"],
    },
    OperationAdversary {
        id: "null",
        name: "NULL",
        specialty: "Web and application injection",
        preferred_attack_types: &["sql_injection", "xss"],
        modifier_ids: &["mixed_vector", "strict_latency", "application_pressure"],
    },
    OperationAdversary {
        id: "viper",
        name: "VIPER",
        specialty: "Malware impact and recovery pressure",
        preferred_attack_types: &["ransomware"],
        modifier_ids: &["recovery_pressure", "hardened_campaign", "delayed_impact"],
    },
];

/// One Operation modifier.
#[derive(Debug, Clone, Copy)]
pub struct OperationModifier {
    /// Modifier identifier.
    pub id: &'static str,
    /// Learner-facing name.
    pub name: &'static str,
    /// Learner-facing description.
    pub description: &'static str,
    /// Minimum adversary rank required to appear.
    pub min_rank: i32,
    /// Enemy health multiplier.
    pub health_multiplier: f64,
    /// Enemy speed multiplier.
    pub speed_multiplier: f64,
    /// Unit-count multiplier.
    pub count_multiplier: f64,
    /// Starting-budget multiplier.
    pub budget_multiplier: f64,
    /// Latency-target multiplier.
    pub latency_multiplier: f64,
    /// Starting-health multiplier.
    pub health_target_multiplier: f64,
    /// Adds a second attack family when the template allows one.
    pub extra_group: bool,
    /// Hides some traffic until detection is active.
    pub hidden_attacks: bool,
    /// Modifiers this one cannot combine with.
    pub incompatible_with: &'static [&'static str],
}

/// Every Operation modifier. Each has clear counterplay.
pub const OPERATION_MODIFIERS: &[OperationModifier] = &[
    OperationModifier {
        id: "hidden_traffic",
        name: "Hidden Traffic",
        description: "Some traffic is hidden until detection is active.",
        min_rank: 1,
        health_multiplier: 1.0,
        speed_multiplier: 1.0,
        count_multiplier: 1.0,
        budget_multiplier: 1.0,
        latency_multiplier: 1.0,
        health_target_multiplier: 1.0,
        extra_group: false,
        hidden_attacks: true,
        incompatible_with: &[],
    },
    OperationModifier {
        id: "credential_surge",
        name: "Credential Surge",
        description: "More sign-in attempts than usual. MFA and rate limiting help.",
        min_rank: 2,
        health_multiplier: 1.1,
        speed_multiplier: 1.05,
        count_multiplier: 1.3,
        budget_multiplier: 1.0,
        latency_multiplier: 1.0,
        health_target_multiplier: 1.0,
        extra_group: false,
        hidden_attacks: false,
        incompatible_with: &[],
    },
    OperationModifier {
        id: "identity_pressure",
        name: "Identity Pressure",
        description: "Identity attacks are tougher. MFA is the reliable counter.",
        min_rank: 1,
        health_multiplier: 1.2,
        speed_multiplier: 1.0,
        count_multiplier: 1.1,
        budget_multiplier: 1.0,
        latency_multiplier: 1.0,
        health_target_multiplier: 1.0,
        extra_group: false,
        hidden_attacks: false,
        incompatible_with: &[],
    },
    OperationModifier {
        id: "mixed_vector",
        name: "Mixed Vector",
        description: "A second attack family joins the assault.",
        min_rank: 1,
        health_multiplier: 1.0,
        speed_multiplier: 1.0,
        count_multiplier: 1.0,
        budget_multiplier: 1.1,
        latency_multiplier: 1.0,
        health_target_multiplier: 1.0,
        extra_group: true,
        hidden_attacks: false,
        incompatible_with: &[],
    },
    OperationModifier {
        id: "strict_latency",
        name: "Strict Latency",
        description: "The latency target is tighter. Every extra control adds delay.",
        min_rank: 1,
        health_multiplier: 1.0,
        speed_multiplier: 1.0,
        count_multiplier: 1.0,
        budget_multiplier: 1.0,
        latency_multiplier: 0.8,
        health_target_multiplier: 1.0,
        extra_group: false,
        hidden_attacks: false,
        incompatible_with: &["delayed_impact"],
    },
    OperationModifier {
        id: "application_pressure",
        name: "Application Pressure",
        description: "Application attacks are tougher. Input validation and WAF help.",
        min_rank: 1,
        health_multiplier: 1.15,
        speed_multiplier: 1.0,
        count_multiplier: 1.05,
        budget_multiplier: 1.0,
        latency_multiplier: 1.0,
        health_target_multiplier: 1.0,
        extra_group: false,
        hidden_attacks: false,
        incompatible_with: &[],
    },
    OperationModifier {
        id: "recovery_pressure",
        name: "Recovery Pressure",
        description: "There is less margin for error. Backup limits the impact.",
        min_rank: 1,
        health_multiplier: 1.1,
        speed_multiplier: 1.0,
        count_multiplier: 1.0,
        budget_multiplier: 1.0,
        latency_multiplier: 1.0,
        health_target_multiplier: 0.9,
        extra_group: false,
        hidden_attacks: false,
        incompatible_with: &[],
    },
    OperationModifier {
        id: "hardened_campaign",
        name: "Hardened Campaign",
        description: "Every attack is more resilient. Layered controls matter.",
        min_rank: 3,
        health_multiplier: 1.25,
        speed_multiplier: 1.0,
        count_multiplier: 1.0,
        budget_multiplier: 1.05,
        latency_multiplier: 1.0,
        health_target_multiplier: 1.0,
        extra_group: false,
        hidden_attacks: false,
        incompatible_with: &[],
    },
    OperationModifier {
        id: "delayed_impact",
        name: "Delayed Impact",
        description: "Slower but far tougher attacks. Do not let them pile up.",
        min_rank: 2,
        health_multiplier: 1.3,
        speed_multiplier: 0.85,
        count_multiplier: 0.9,
        budget_multiplier: 1.0,
        latency_multiplier: 1.0,
        health_target_multiplier: 1.0,
        extra_group: false,
        hidden_attacks: false,
        incompatible_with: &["strict_latency"],
    },
];

/// Looks up an attack by id.
pub fn operation_attack(id: &str) -> Option<&'static OperationAttack> {
    OPERATION_ATTACKS.iter().find(|attack| attack.id == id)
}

/// Looks up a defense by id.
pub fn operation_defense(id: &str) -> Option<&'static OperationDefense> {
    OPERATION_DEFENSES.iter().find(|defense| defense.id == id)
}

/// Looks up a map by id.
pub fn operation_map(id: &str) -> Option<&'static OperationMap> {
    OPERATION_MAPS.iter().find(|map| map.id == id)
}

/// Looks up a template by id.
pub fn operation_template(id: &str) -> Option<&'static OperationTemplate> {
    OPERATION_TEMPLATES
        .iter()
        .find(|template| template.id == id)
}

/// Looks up an adversary by id.
pub fn operation_adversary(id: &str) -> Option<&'static OperationAdversary> {
    OPERATION_ADVERSARIES
        .iter()
        .find(|adversary| adversary.id == id)
}

/// Templates the random Operation picker may choose from.
///
/// Story-gated climax templates are excluded: they are only started explicitly.
pub fn random_selectable_templates() -> Vec<&'static OperationTemplate> {
    OPERATION_TEMPLATES
        .iter()
        .filter(|template| template.random_pick)
        .collect()
}

/// Progress facts that gate which adversaries may appear.
#[derive(Debug, Clone, Default)]
pub struct AdversaryUnlockInput {
    /// Whether Chapter 1 (the campaign boss) is complete.
    pub campaign_complete: bool,
    /// Completed story node ids.
    pub completed_story_nodes: Vec<String>,
}

/// Adversaries currently allowed to appear, in introduction order.
///
/// GHOST-7 appears as soon as Operations unlock. NULL is introduced after the
/// early Chapter 2 milestone (GHOST-7 rank 2), and VIPER after Chapter 3 shows
/// coordination (chapter-3-null). Availability is pure and progression-driven;
/// there are no calendar-based unlocks.
pub fn available_adversaries(input: &AdversaryUnlockInput) -> Vec<&'static str> {
    if !input.campaign_complete {
        return Vec::new();
    }
    let has = |node_id: &str| input.completed_story_nodes.iter().any(|id| id == node_id);
    let mut available: Vec<&'static str> = vec!["ghost-7"];
    if has("chapter-2-clue") {
        available.push("null");
    }
    if has("chapter-2-clue") && has("chapter-3-null") {
        available.push("viper");
    }
    available
}

/// Templates whose adversary pool intersects `available`.
pub fn selectable_templates(
    available: &[&'static str],
    random_only: bool,
) -> Vec<&'static OperationTemplate> {
    OPERATION_TEMPLATES
        .iter()
        .filter(|template| !random_only || template.random_pick)
        .filter(|template| {
            template
                .adversary_ids
                .iter()
                .any(|adversary| available.contains(adversary))
        })
        .collect()
}

/// Looks up a modifier by id.
pub fn operation_modifier(id: &str) -> Option<&'static OperationModifier> {
    OPERATION_MODIFIERS
        .iter()
        .find(|modifier| modifier.id == id)
}

/// Whether `target` is reachable from the map's entry node.
pub fn map_reaches(map: &OperationMap, target: &str) -> bool {
    let mut stack = vec![map.entry_node_id];
    let mut seen: Vec<&str> = Vec::new();
    while let Some(node) = stack.pop() {
        if node == target {
            return true;
        }
        if seen.contains(&node) {
            continue;
        }
        seen.push(node);
        for edge in map.edges {
            if edge.from == node {
                stack.push(edge.to);
            }
        }
    }
    false
}

/// Whether the map contains a node with the given id.
pub fn map_has_node(map: &OperationMap, node_id: &str) -> bool {
    map.nodes.iter().any(|node| node.id == node_id)
}

/// Errors raised when an Operation cannot be generated.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OperationGenerationError {
    /// The template id is unknown.
    #[error("unknown operation template: {0}")]
    UnknownTemplate(String),
    /// The adversary id is unknown.
    #[error("unknown adversary: {0}")]
    UnknownAdversary(String),
    /// The adversary cannot run the template.
    #[error("adversary {adversary} cannot run template {template}")]
    IncompatibleAdversary {
        /// Adversary id.
        adversary: String,
        /// Template id.
        template: String,
    },
    /// The Threat Level is outside the public bounds.
    #[error("threat level {0} is out of bounds")]
    InvalidThreatLevel(i32),
    /// The generated Operation failed an invariant.
    #[error("invalid operation: {0}")]
    InvalidOperation(String),
}

/// Deterministic SplitMix64 PRNG.
///
/// No wall-clock randomness: once a seed is supplied the output is stable, which
/// is what makes a persisted Operation reproducible.
#[derive(Debug, Clone)]
struct Rng(u64);

impl Rng {
    fn new(seed: i64) -> Self {
        // Mix the seed once so nearby seeds do not produce correlated output.
        Self((seed as u64).wrapping_add(0x9E37_79B9_7F4A_7C15))
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Returns a value in `[0, n)`. `n` must be positive.
    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n.max(1)
    }

    /// Returns an inclusive integer in `[low, high]`.
    fn range(&mut self, low: i32, high: i32) -> i32 {
        if high <= low {
            return low;
        }
        let span = (high - low + 1) as u64;
        low + self.below(span) as i32
    }

    /// Returns a `f64` in `[0, 1)`.
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> Option<&'a T> {
        if items.is_empty() {
            return None;
        }
        Some(&items[self.below(items.len() as u64) as usize])
    }
}

/// Inputs for deterministic Operation generation.
#[derive(Debug, Clone)]
pub struct OperationGenerationInput {
    /// Generation seed.
    pub seed: i64,
    /// Template identifier.
    pub template_id: String,
    /// Adversary identifier.
    pub adversary_id: String,
    /// Requested Threat Level.
    pub threat_level: i32,
    /// Adversary rank, which unlocks some modifiers.
    pub adversary_rank: i32,
    /// Selected hero, recorded for the run.
    pub hero_id: Option<String>,
}

/// One spawn group in a generated wave.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct GeneratedSpawnGroup {
    /// Attack identifier.
    pub attack_id: String,
    /// Number of units.
    pub count: i32,
    /// Spawn interval in milliseconds.
    pub spawn_interval_ms: i32,
    /// Optional start delay in milliseconds.
    pub delay_ms: Option<i32>,
    /// Enemy health multiplier applied at spawn.
    pub health_multiplier: f64,
    /// Enemy speed multiplier applied at spawn.
    pub speed_multiplier: f64,
}

/// One generated wave.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct GeneratedWave {
    /// Spawn groups.
    pub groups: Vec<GeneratedSpawnGroup>,
    /// Marks the boss wave.
    pub boss: bool,
}

/// One active Operation modifier.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct GeneratedModifier {
    /// Modifier identifier.
    pub id: String,
    /// Learner-facing name.
    pub name: String,
    /// Learner-facing description.
    pub description: String,
}

/// The selected hero's frozen progression at run creation.
///
/// Talents are captured as the server stored them when the run started, so a
/// later respec in another tab never changes an in-progress battle.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, Default)]
pub struct OperationHeroSnapshot {
    /// Hero identifier.
    pub hero_id: String,
    /// Hero level at run creation.
    pub level: i32,
    /// Selected talents at run creation, keyed by milestone.
    pub selected_talents: serde_json::Value,
}

/// The Tower room levels frozen at run creation.
///
/// Every room that changes run-time behaviour is captured: SOC and Threat
/// Intelligence gate the briefing, the Training Center scales hero XP, the
/// Engineering Lab allows loadout substitutions, and the Resilience Center
/// grants emergency recovery. Later upgrades affect only future runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
pub struct OperationTowerSnapshot {
    /// SOC room level.
    pub soc_level: i32,
    /// Threat Intelligence room level.
    pub threat_intelligence_level: i32,
    /// Training Center room level.
    pub training_center_level: i32,
    /// Engineering Lab room level.
    pub engineering_lab_level: i32,
    /// Resilience Center room level.
    pub resilience_center_level: i32,
}

/// The complete run-start progression snapshot stored inside an Operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, Default)]
pub struct OperationProgressionSnapshot {
    /// The selected hero's frozen progression, when a hero was chosen.
    pub hero: Option<OperationHeroSnapshot>,
    /// The Tower room levels frozen at creation.
    pub tower: OperationTowerSnapshot,
}

/// A complete, persisted Operation snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct GeneratedOperation {
    /// Generation seed.
    pub seed: i64,
    /// Template identifier.
    pub template_id: String,
    /// Adversary identifier.
    pub adversary_id: String,
    /// Adversary display name.
    pub adversary_name: String,
    /// Threat Level.
    pub threat_level: i32,
    /// Learner-facing title.
    pub title: String,
    /// Learner-facing summary.
    pub summary: String,
    /// Map identifier the frontend resolves.
    pub map_id: String,
    /// Starting mission credits.
    pub starting_budget: i32,
    /// Starting system health.
    pub starting_health: i32,
    /// Latency target in milliseconds.
    pub latency_target_ms: i32,
    /// Defenses offered.
    pub available_defenses: Vec<String>,
    /// Heroes offered.
    pub available_heroes: Vec<String>,
    /// Waves.
    pub waves: Vec<GeneratedWave>,
    /// Active modifiers.
    pub modifiers: Vec<GeneratedModifier>,
    /// The dominant attack family.
    pub dominant_attack_type: String,
    /// Whether some traffic is hidden until detection is active.
    pub hidden_attacks: bool,
    /// Whether a boss is present.
    pub boss: bool,
    /// Reward preview at three stars.
    pub reward_preview: CyberReward,
    /// Run-start progression frozen for this Operation.
    ///
    /// `serde(default)` keeps runs persisted before this field existed
    /// deserializable; those legacy runs resolve progression from the profile.
    #[serde(default)]
    pub progression_snapshot: OperationProgressionSnapshot,
}

fn threat_wave_count(template: &OperationTemplate, threat: i32, rng: &mut Rng) -> i32 {
    let (low, high) = match threat {
        1..=3 => (
            template.min_waves,
            (template.min_waves + 1).min(template.max_waves),
        ),
        4..=6 => (
            template.min_waves.max(4),
            (template.min_waves + 2).min(template.max_waves),
        ),
        _ => (
            (template.max_waves - 2).max(template.min_waves),
            template.max_waves,
        ),
    };
    rng.range(low, high)
        .clamp(template.min_waves, template.max_waves)
}

fn modifier_count(threat: i32, template: &OperationTemplate) -> i32 {
    let desired = match threat {
        1..=3 => 1,
        4..=6 => 2,
        _ => 2,
    };
    desired.min(template.max_modifiers)
}

fn choose_modifiers(
    template: &OperationTemplate,
    adversary_rank: i32,
    count: i32,
    rng: &mut Rng,
) -> Vec<&'static OperationModifier> {
    let mut candidates: Vec<&'static OperationModifier> = template
        .allowed_modifier_ids
        .iter()
        .filter_map(|id| operation_modifier(id))
        .filter(|modifier| modifier.min_rank <= adversary_rank)
        .collect();

    // Shuffle deterministically.
    for index in (1..candidates.len()).rev() {
        let swap = rng.below((index + 1) as u64) as usize;
        candidates.swap(index, swap);
    }

    let mut chosen: Vec<&'static OperationModifier> = Vec::new();
    for candidate in candidates {
        if chosen.len() as i32 >= count {
            break;
        }
        let incompatible = chosen.iter().any(|existing| {
            existing.incompatible_with.contains(&candidate.id)
                || candidate.incompatible_with.contains(&existing.id)
        });
        if incompatible {
            continue;
        }
        chosen.push(candidate);
    }
    chosen
}

/// Generates one deterministic Operation from its inputs.
pub fn generate_operation(
    input: &OperationGenerationInput,
) -> Result<GeneratedOperation, OperationGenerationError> {
    if !(THREAT_LEVEL_MIN..=THREAT_LEVEL_MAX).contains(&input.threat_level) {
        return Err(OperationGenerationError::InvalidThreatLevel(
            input.threat_level,
        ));
    }

    let template = operation_template(&input.template_id)
        .ok_or_else(|| OperationGenerationError::UnknownTemplate(input.template_id.clone()))?;
    let adversary = operation_adversary(&input.adversary_id)
        .ok_or_else(|| OperationGenerationError::UnknownAdversary(input.adversary_id.clone()))?;

    if !template.adversary_ids.contains(&adversary.id) {
        return Err(OperationGenerationError::IncompatibleAdversary {
            adversary: adversary.id.to_owned(),
            template: template.id.to_owned(),
        });
    }

    let map = operation_map(template.map_id)
        .ok_or_else(|| OperationGenerationError::InvalidOperation("unknown map".to_owned()))?;

    let mut rng = Rng::new(input.seed);
    let threat = input.threat_level;

    // 4. Choose compatible modifiers.
    let modifiers = choose_modifiers(
        template,
        input.adversary_rank,
        modifier_count(threat, template),
        &mut rng,
    );

    // 5. Choose wave count.
    let wave_count = threat_wave_count(template, threat, &mut rng);

    // Dominant attack family: prefer the adversary's specialty within the
    // template's allowed families.
    let dominant_type = adversary
        .preferred_attack_types
        .iter()
        .find(|attack_type| template.allowed_attack_types.contains(attack_type))
        .copied()
        .or_else(|| rng.pick(template.allowed_attack_types).copied())
        .ok_or_else(|| {
            OperationGenerationError::InvalidOperation("template has no attack families".to_owned())
        })?;

    let dominant_attacks: Vec<&'static OperationAttack> = OPERATION_ATTACKS
        .iter()
        .filter(|attack| attack.attack_type == dominant_type && !attack.boss)
        .collect();
    let dominant_attack = dominant_attacks.first().copied().ok_or_else(|| {
        OperationGenerationError::InvalidOperation("no attack for dominant family".to_owned())
    })?;

    let secondary_type = if modifiers.iter().any(|modifier| modifier.extra_group) || threat >= 4 {
        template
            .allowed_attack_types
            .iter()
            .find(|attack_type| **attack_type != dominant_type)
            .copied()
    } else {
        None
    };
    let secondary_attack = secondary_type.and_then(|attack_type| {
        OPERATION_ATTACKS
            .iter()
            .find(|attack| attack.attack_type == attack_type && !attack.boss)
    });

    // 6. Generate wave composition.
    let health_multiplier = (1.0 + 0.07 * f64::from(threat - 1))
        * modifiers
            .iter()
            .map(|modifier| modifier.health_multiplier)
            .product::<f64>();
    let speed_multiplier = (1.0 + 0.015 * f64::from(threat - 1))
        * modifiers
            .iter()
            .map(|modifier| modifier.speed_multiplier)
            .product::<f64>();
    let count_multiplier = (1.0 + 0.05 * f64::from(threat - 1))
        * modifiers
            .iter()
            .map(|modifier| modifier.count_multiplier)
            .product::<f64>();
    let hidden_attacks = modifiers.iter().any(|modifier| modifier.hidden_attacks);

    let boss = template
        .boss_attack_id
        .and_then(operation_attack)
        .filter(|attack| map_has_node(map, attack.target_node_id) && threat >= 7)
        .filter(|_| rng.unit() < 0.6);

    let mut waves: Vec<GeneratedWave> = Vec::with_capacity(wave_count as usize);
    for index in 0..wave_count {
        let is_last = index == wave_count - 1;
        let wave_scale = 1.0 + 0.15 * f64::from(index);
        let dominant_count =
            ((f64::from(dominant_attack.base_count) * count_multiplier * wave_scale).round()
                as i32)
                .max(1);

        let mut groups = vec![GeneratedSpawnGroup {
            attack_id: dominant_attack.id.to_owned(),
            count: dominant_count,
            spawn_interval_ms: dominant_attack.base_interval_ms,
            delay_ms: None,
            health_multiplier,
            speed_multiplier,
        }];

        if let Some(secondary) = secondary_attack {
            if index % 2 == 1 || is_last {
                let count =
                    ((f64::from(secondary.base_count) * count_multiplier).round() as i32).max(1);
                groups.push(GeneratedSpawnGroup {
                    attack_id: secondary.id.to_owned(),
                    count,
                    spawn_interval_ms: secondary.base_interval_ms,
                    delay_ms: Some(1500),
                    health_multiplier,
                    speed_multiplier,
                });
            }
        }

        let wave_boss = is_last && boss.is_some();
        if let Some(boss_attack) = boss {
            if wave_boss {
                groups.push(GeneratedSpawnGroup {
                    attack_id: boss_attack.id.to_owned(),
                    count: 1,
                    spawn_interval_ms: boss_attack.base_interval_ms,
                    delay_ms: Some(2000),
                    health_multiplier,
                    speed_multiplier,
                });
            }
        }

        waves.push(GeneratedWave {
            groups,
            boss: wave_boss,
        });
    }

    // 7-9. Budget, latency target, and health.
    let budget_multiplier: f64 = modifiers
        .iter()
        .map(|modifier| modifier.budget_multiplier)
        .product();
    let latency_multiplier: f64 = modifiers
        .iter()
        .map(|modifier| modifier.latency_multiplier)
        .product();
    let health_target_multiplier: f64 = modifiers
        .iter()
        .map(|modifier| modifier.health_target_multiplier)
        .product();

    let minimum_package_cost: i32 = template
        .required_counter_defense_ids
        .iter()
        .filter_map(|id| operation_defense(id))
        .map(|defense| defense.cost)
        .sum();

    let budget_pressure = 1.0 - 0.02 * f64::from(threat - 1);
    let mut starting_budget =
        (f64::from(template.base_budget) * budget_pressure * budget_multiplier).round() as i32;
    starting_budget = starting_budget.max(minimum_package_cost + 120).max(200);

    let latency_target_ms = ((f64::from(template.base_latency_target_ms)
        * (1.0 - 0.015 * f64::from(threat - 1))
        * latency_multiplier)
        .round() as i32)
        .max(80);

    let starting_health =
        ((f64::from(template.base_health) * health_target_multiplier).round() as i32).max(60);

    // 10. Validate counter availability and 11. affordability.
    let available_defenses =
        available_defenses(template, map, dominant_type, secondary_type, hidden_attacks);
    for required in template.required_counter_defense_ids {
        if !available_defenses.iter().any(|id| id == required) {
            return Err(OperationGenerationError::InvalidOperation(format!(
                "required counter {required} is not available"
            )));
        }
    }
    if starting_budget < minimum_package_cost {
        return Err(OperationGenerationError::InvalidOperation(
            "budget cannot afford the minimum counter package".to_owned(),
        ));
    }

    let title = rng
        .pick(template.title_pool)
        .copied()
        .unwrap_or(template.id)
        .to_owned();

    let modifiers: Vec<GeneratedModifier> = modifiers
        .iter()
        .map(|modifier| GeneratedModifier {
            id: modifier.id.to_owned(),
            name: modifier.name.to_owned(),
            description: modifier.description.to_owned(),
        })
        .collect();

    let operation = GeneratedOperation {
        seed: input.seed,
        template_id: template.id.to_owned(),
        adversary_id: adversary.id.to_owned(),
        adversary_name: adversary.name.to_owned(),
        threat_level: threat,
        title,
        summary: template.summary.to_owned(),
        map_id: map.id.to_owned(),
        starting_budget,
        starting_health,
        latency_target_ms,
        available_defenses,
        available_heroes: DEFAULT_HERO_IDS.iter().map(|id| (*id).to_owned()).collect(),
        waves,
        modifiers,
        dominant_attack_type: dominant_type.to_owned(),
        hidden_attacks,
        boss: boss.is_some(),
        reward_preview: operation_reward(threat, 3, true, false),
        progression_snapshot: OperationProgressionSnapshot::default(),
    };

    validate_generated_operation(&operation)?;
    Ok(operation)
}

fn available_defenses(
    template: &OperationTemplate,
    map: &OperationMap,
    dominant_type: &str,
    secondary_type: Option<&str>,
    hidden_attacks: bool,
) -> Vec<String> {
    let placeable_on_map = |defense: &OperationDefense| {
        map.nodes
            .iter()
            .any(|node| defense.allowed_placements.contains(&node.node_type))
    };
    let counters_composition = |defense: &OperationDefense| {
        defense.counters.iter().any(|attack_type| {
            *attack_type == dominant_type
                || secondary_type.is_some_and(|secondary| *attack_type == secondary)
        })
    };

    let mut ids: Vec<String> = OPERATION_DEFENSES
        .iter()
        .filter(|defense| placeable_on_map(defense) && counters_composition(defense))
        .map(|defense| defense.id.to_owned())
        .collect();
    // Hidden traffic needs a detection control as counterplay, even when the
    // detection control does not directly counter the dominant family.
    if hidden_attacks {
        for defense in OPERATION_DEFENSES {
            if defense.reveals_hidden
                && placeable_on_map(defense)
                && !ids.iter().any(|id| id == defense.id)
            {
                ids.push(defense.id.to_owned());
            }
        }
    }
    // Required counters are always offered, even if they counter only a
    // secondary family.
    for required in template.required_counter_defense_ids {
        if !ids.iter().any(|id| id == required) {
            ids.push((*required).to_owned());
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

/// Validates every generation invariant. Used by the generator and by tests.
pub fn validate_generated_operation(
    operation: &GeneratedOperation,
) -> Result<(), OperationGenerationError> {
    let invalid = |reason: &str| OperationGenerationError::InvalidOperation(reason.to_owned());

    if !(THREAT_LEVEL_MIN..=THREAT_LEVEL_MAX).contains(&operation.threat_level) {
        return Err(OperationGenerationError::InvalidThreatLevel(
            operation.threat_level,
        ));
    }

    let template =
        operation_template(&operation.template_id).ok_or_else(|| invalid("unknown template"))?;
    let map = operation_map(&operation.map_id).ok_or_else(|| invalid("unknown map"))?;

    if operation.waves.len() < template.min_waves as usize
        || operation.waves.len() > template.max_waves as usize
    {
        return Err(invalid("wave count out of bounds"));
    }
    if operation.waves.is_empty() {
        return Err(invalid("operation has no waves"));
    }

    let mut has_attack = false;
    let mut seen_modifiers: Vec<&str> = Vec::new();
    for wave in &operation.waves {
        if wave.groups.is_empty() {
            return Err(invalid("wave has no groups"));
        }
        for group in &wave.groups {
            let attack =
                operation_attack(&group.attack_id).ok_or_else(|| invalid("unknown attack id"))?;
            if !map_has_node(map, attack.target_node_id) || !map_reaches(map, attack.target_node_id)
            {
                return Err(invalid("attack target is not reachable"));
            }
            if attack.boss && !wave.boss {
                return Err(invalid("boss group outside a boss wave"));
            }
            has_attack = true;
        }
    }
    if !has_attack {
        return Err(invalid("operation has no attacks"));
    }

    for modifier in &operation.modifiers {
        let definition =
            operation_modifier(&modifier.id).ok_or_else(|| invalid("unknown modifier"))?;
        if seen_modifiers.contains(&definition.id) {
            return Err(invalid("duplicate modifier"));
        }
        for other in &seen_modifiers {
            if definition.incompatible_with.contains(other) {
                return Err(invalid("incompatible modifier combination"));
            }
        }
        seen_modifiers.push(definition.id);
    }
    if operation.modifiers.len() > template.max_modifiers as usize {
        return Err(invalid("too many modifiers"));
    }

    for defense_id in &operation.available_defenses {
        operation_defense(defense_id).ok_or_else(|| invalid("unknown defense id"))?;
    }
    for hero_id in &operation.available_heroes {
        if !DEFAULT_HERO_IDS.contains(&hero_id.as_str()) {
            return Err(invalid("unknown hero id"));
        }
    }

    // At least one meaningful counter for the dominant threat must be offered.
    let dominant_counter = operation.available_defenses.iter().any(|id| {
        operation_defense(id).is_some_and(|defense| {
            defense
                .counters
                .contains(&operation.dominant_attack_type.as_str())
        })
    });
    if !dominant_counter {
        return Err(invalid("no counter available for the dominant threat"));
    }

    // Hidden traffic must always have a detection counter available.
    if operation.hidden_attacks
        && !operation
            .available_defenses
            .iter()
            .any(|id| operation_defense(id).is_some_and(|defense| defense.reveals_hidden))
    {
        return Err(invalid("hidden traffic without a detection counter"));
    }

    // The starting budget must afford the template's minimum counter package.
    let minimum_package_cost: i32 = template
        .required_counter_defense_ids
        .iter()
        .filter_map(|id| operation_defense(id))
        .map(|defense| defense.cost)
        .sum();
    if operation.starting_budget < minimum_package_cost {
        return Err(invalid("budget cannot afford the minimum counter package"));
    }

    // Every required counter must be both offered and placeable on the map, or
    // the operation would be unwinnable. This also makes an Engineering Lab swap
    // that removes a required counter fail validation.
    for required in template.required_counter_defense_ids {
        let defense =
            operation_defense(required).ok_or_else(|| invalid("unknown required counter"))?;
        if !operation.available_defenses.iter().any(|id| id == required) {
            return Err(invalid("required counter is not offered"));
        }
        let placeable = map
            .nodes
            .iter()
            .any(|node| defense.allowed_placements.contains(&node.node_type));
        if !placeable {
            return Err(invalid("required counter is not placeable on the map"));
        }
    }

    if operation.boss && !operation.waves.iter().any(|wave| wave.boss) {
        return Err(invalid("boss flagged without a boss wave"));
    }

    Ok(())
}

/// One recent Operation identity, used by the anti-repetition rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentOperationIdentity {
    /// Template id.
    pub template_id: String,
    /// Adversary id.
    pub adversary_id: String,
}

/// How many of the most recent distinct templates stay out of rotation.
pub const OPERATION_RECENT_TEMPLATE_AVOIDANCE: usize = 2;

/// Largest Operation offer set.
pub const MAX_OPERATION_OFFERS: usize = 3;

/// Distinct recent template ids, newest first.
fn recent_distinct_templates(recent: &[RecentOperationIdentity]) -> Vec<&str> {
    let mut ids: Vec<&str> = Vec::new();
    for identity in recent {
        if !ids.contains(&identity.template_id.as_str()) {
            ids.push(&identity.template_id);
        }
    }
    ids
}

/// Selects one template from an already-gated eligible pool.
///
/// Anti-repetition order: keep the last
/// [`OPERATION_RECENT_TEMPLATE_AVOIDANCE`] distinct templates out when any
/// alternative remains, then avoid the immediately previous template, then fall
/// back to the whole pool so a single eligible template still works. Selection
/// is deterministic for `seed`, so a server offer and the run it starts agree.
pub fn select_operation_template<'a>(
    pool: &[&'a OperationTemplate],
    recent: &[RecentOperationIdentity],
    seed: u64,
) -> Option<&'a OperationTemplate> {
    if pool.is_empty() {
        return None;
    }
    if pool.len() == 1 {
        return Some(pool[0]);
    }

    let recent_templates = recent_distinct_templates(recent);
    let avoided: Vec<&str> = recent_templates
        .into_iter()
        .take(OPERATION_RECENT_TEMPLATE_AVOIDANCE)
        .collect();

    let mut candidates: Vec<&'a OperationTemplate> = pool
        .iter()
        .copied()
        .filter(|template| !avoided.contains(&template.id))
        .collect();
    if candidates.is_empty() {
        candidates = pool.to_vec();
    }

    // Prefer not to repeat the immediately previous template, when it is
    // possible to do so. Because the adversary is chosen deterministically per
    // template, differing on the template id also differs on the combination.
    if let Some(last) = recent.first() {
        let narrowed: Vec<&'a OperationTemplate> = candidates
            .iter()
            .copied()
            .filter(|template| template.id != last.template_id)
            .collect();
        if !narrowed.is_empty() {
            candidates = narrowed;
        }
    }

    let mut rng = Rng::new(seed as i64);
    let index = rng.below(candidates.len() as u64) as usize;
    Some(candidates[index])
}

/// Selects up to `max_offers` distinct templates for an offer set.
///
/// The pool is deterministically shuffled for variety, then templates that were
/// played recently are pushed to the back, so the offer set prefers fresh
/// content while still surfacing repeats when little content is eligible.
pub fn select_operation_offer_templates<'a>(
    pool: &[&'a OperationTemplate],
    recent: &[RecentOperationIdentity],
    seed: u64,
    max_offers: usize,
) -> Vec<&'a OperationTemplate> {
    if pool.is_empty() || max_offers == 0 {
        return Vec::new();
    }
    let mut rng = Rng::new(seed as i64);
    let mut candidates: Vec<&'a OperationTemplate> = pool.to_vec();
    for index in (1..candidates.len()).rev() {
        let swap = rng.below((index + 1) as u64) as usize;
        candidates.swap(index, swap);
    }

    let avoided: Vec<&str> = recent_distinct_templates(recent)
        .into_iter()
        .take(OPERATION_RECENT_TEMPLATE_AVOIDANCE)
        .collect();
    // Stable sort keeps the shuffled order within each group.
    candidates.sort_by_key(|template| avoided.contains(&template.id));

    candidates.truncate(max_offers.min(candidates.len()));
    candidates
}

/// Estimated minutes to clear an Operation, derived from its wave pacing.
///
/// Display-only: the client shows this on the offer card, and the server never
/// uses it for scoring. Clamped to a plausible 3–20 minutes.
pub fn estimated_operation_minutes(operation: &GeneratedOperation) -> i32 {
    let mut spawn_ms: i64 = 0;
    for wave in &operation.waves {
        let mut wave_ms: i64 = 0;
        for group in &wave.groups {
            let group_ms = i64::from(group.count.max(0))
                * i64::from(group.spawn_interval_ms.max(1))
                + i64::from(group.delay_ms.unwrap_or(0));
            wave_ms = wave_ms.max(group_ms);
        }
        spawn_ms += wave_ms;
    }
    let travel_ms = i64::from(i32::try_from(operation.waves.len()).unwrap_or(1)) * 20_000;
    ((spawn_ms + travel_ms + 59_999) / 60_000).clamp(3, 20) as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn input(
        seed: i64,
        template: &str,
        adversary: &str,
        threat: i32,
        rank: i32,
    ) -> OperationGenerationInput {
        OperationGenerationInput {
            seed,
            template_id: template.to_owned(),
            adversary_id: adversary.to_owned(),
            threat_level: threat,
            adversary_rank: rank,
            hero_id: Some("security_engineer".to_owned()),
        }
    }

    #[test]
    fn same_seed_produces_identical_operation() {
        let a = generate_operation(&input(42, "mixed-intrusion", "ghost-7", 6, 5)).unwrap();
        let b = generate_operation(&input(42, "mixed-intrusion", "ghost-7", 6, 5)).unwrap();
        assert_eq!(a, b);
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    #[test]
    fn different_seeds_vary() {
        let a = generate_operation(&input(1, "mixed-intrusion", "ghost-7", 6, 5)).unwrap();
        let b = generate_operation(&input(2, "mixed-intrusion", "ghost-7", 6, 5)).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn unknown_ids_are_rejected() {
        assert!(matches!(
            generate_operation(&input(1, "nope", "ghost-7", 3, 1)),
            Err(OperationGenerationError::UnknownTemplate(_))
        ));
        assert!(matches!(
            generate_operation(&input(1, "identity-breach", "nope", 3, 1)),
            Err(OperationGenerationError::UnknownAdversary(_))
        ));
        assert!(matches!(
            generate_operation(&input(1, "identity-breach", "viper", 3, 1)),
            Err(OperationGenerationError::IncompatibleAdversary { .. })
        ));
        assert!(matches!(
            generate_operation(&input(1, "identity-breach", "ghost-7", 99, 1)),
            Err(OperationGenerationError::InvalidThreatLevel(_))
        ));
    }

    #[test]
    fn thousand_generated_operations_hold_every_invariant() {
        let mut generated = 0;
        for seed in 0..1000i64 {
            let template = OPERATION_TEMPLATES[(seed as usize) % OPERATION_TEMPLATES.len()];
            let adversary = template.adversary_ids
                [(seed as usize / OPERATION_TEMPLATES.len()) % template.adversary_ids.len()];
            let threat = ((seed % 10) + 1) as i32;
            let rank = ((seed % 10) + 1) as i32;
            let operation = generate_operation(&input(seed, template.id, adversary, threat, rank))
                .unwrap_or_else(|error| panic!("seed {seed} failed: {error}"));
            validate_generated_operation(&operation)
                .unwrap_or_else(|error| panic!("seed {seed} invalid: {error}"));
            generated += 1;
        }
        assert_eq!(generated, 1000);
    }

    #[test]
    fn higher_threat_never_rewards_less() {
        for template in OPERATION_TEMPLATES {
            let low = generate_operation(&input(7, template.id, template.adversary_ids[0], 1, 10))
                .unwrap();
            let high =
                generate_operation(&input(7, template.id, template.adversary_ids[0], 10, 10))
                    .unwrap();
            assert!(high.reward_preview.bits >= low.reward_preview.bits);
            assert!(high.reward_preview.career_xp >= low.reward_preview.career_xp);
        }
    }

    #[test]
    fn every_template_offers_its_required_counters() {
        for template in OPERATION_TEMPLATES {
            let operation =
                generate_operation(&input(99, template.id, template.adversary_ids[0], 5, 10))
                    .unwrap();
            for required in template.required_counter_defense_ids {
                assert!(
                    operation.available_defenses.iter().any(|id| id == required),
                    "{} must offer {required}",
                    template.id
                );
            }
        }
    }

    #[test]
    fn every_map_path_reaches_every_attack_target() {
        for map in OPERATION_MAPS {
            for attack in OPERATION_ATTACKS {
                if map_has_node(map, attack.target_node_id) {
                    assert!(
                        map_reaches(map, attack.target_node_id),
                        "{} cannot reach {}",
                        map.id,
                        attack.target_node_id
                    );
                }
            }
        }
    }

    #[test]
    fn modifiers_never_repeat_within_a_template() {
        for template in OPERATION_TEMPLATES {
            let operation =
                generate_operation(&input(5, template.id, template.adversary_ids[0], 9, 10))
                    .unwrap();
            let ids: BTreeSet<&str> = operation
                .modifiers
                .iter()
                .map(|modifier| modifier.id.as_str())
                .collect();
            assert_eq!(ids.len(), operation.modifiers.len());
        }
    }

    #[test]
    fn catalog_has_no_oracle_identity() {
        let haystack = format!(
            "{:?}{:?}{:?}",
            OPERATION_ADVERSARIES
                .iter()
                .map(|adversary| adversary.id)
                .collect::<Vec<_>>(),
            OPERATION_TEMPLATES.iter().map(|t| t.id).collect::<Vec<_>>(),
            OPERATION_MODIFIERS.iter().map(|m| m.id).collect::<Vec<_>>()
        )
        .to_lowercase();
        assert!(!haystack.contains("oracle"));
    }

    #[test]
    fn hidden_traffic_always_offers_a_detection_counter() {
        for seed in 0..200i64 {
            let operation =
                generate_operation(&input(seed, "identity-breach", "ghost-7", 6, 10)).unwrap();
            if operation.hidden_attacks {
                assert!(
                    operation
                        .available_defenses
                        .iter()
                        .any(|id| operation_defense(id)
                            .is_some_and(|defense| defense.reveals_hidden)),
                    "seed {seed} hid traffic without a detection counter"
                );
            }
        }
    }

    #[test]
    fn operations_are_locked_until_the_campaign_is_complete() {
        let locked = AdversaryUnlockInput::default();
        assert!(available_adversaries(&locked).is_empty());
        assert!(selectable_templates(&available_adversaries(&locked), true).is_empty());
    }

    #[test]
    fn adversaries_unlock_in_story_order() {
        let base = AdversaryUnlockInput {
            campaign_complete: true,
            completed_story_nodes: Vec::new(),
        };
        let initial = available_adversaries(&base);
        assert_eq!(initial, vec!["ghost-7"]);

        let chapter2 = AdversaryUnlockInput {
            campaign_complete: true,
            completed_story_nodes: vec!["chapter-2-clue".to_owned()],
        };
        let with_null = available_adversaries(&chapter2);
        assert_eq!(with_null, vec!["ghost-7", "null"]);
        assert!(!with_null.contains(&"viper"));

        let chapter3 = AdversaryUnlockInput {
            campaign_complete: true,
            completed_story_nodes: vec!["chapter-2-clue".to_owned(), "chapter-3-null".to_owned()],
        };
        let with_viper = available_adversaries(&chapter3);
        assert_eq!(with_viper, vec!["ghost-7", "null", "viper"]);
    }

    #[test]
    fn first_operation_pool_always_contains_ghost7() {
        let available = available_adversaries(&AdversaryUnlockInput {
            campaign_complete: true,
            completed_story_nodes: Vec::new(),
        });
        let templates = selectable_templates(&available, true);
        assert!(!templates.is_empty(), "no selectable template pool");
        for template in templates {
            assert!(template.adversary_ids.contains(&"ghost-7"));
        }
    }

    #[test]
    fn confrontation_is_never_randomly_selected() {
        let random_ids: Vec<&str> = random_selectable_templates().iter().map(|t| t.id).collect();
        assert!(!random_ids.contains(&"ghost7-confrontation"));
        assert!(operation_template("ghost7-confrontation").is_some());
    }

    #[test]
    fn map_catalog_matches_the_frontend_contract() {
        // Keep in sync with `apps/web/src/game/data/operationMaps.ts`.
        let mut ids: Vec<&str> = OPERATION_MAPS.iter().map(|map| map.id).collect();
        ids.sort_unstable();
        assert_eq!(
            ids,
            vec![
                "deep-stack",
                "dual-service",
                "edge-basic",
                "full-stack",
                "identity-fork",
                "identity-stack",
                "service-mesh",
                "web-stack",
            ]
        );
    }

    #[test]
    fn branching_maps_route_targets_down_more_than_one_branch() {
        // Dual Service and Service Mesh put the API and application/database on
        // parallel branches; both must be reachable from the entry.
        for map_id in ["dual-service", "identity-fork", "service-mesh"] {
            let map = operation_map(map_id).expect("known map");
            assert!(map_reaches(map, "internet"), "{map_id}");
            assert!(
                map.nodes
                    .iter()
                    .filter(|node| node.id != map.entry_node_id)
                    .all(|node| { map_reaches(map, node.id) }),
                "{map_id} has an unreachable node"
            );
        }
    }

    #[test]
    fn generation_holds_invariants_on_every_map() {
        // Every template's map must satisfy the generator's reachability and
        // counter-availability invariants at every seed and threat.
        for seed in 0..200i64 {
            for template in OPERATION_TEMPLATES {
                for threat in [1, 5, 10] {
                    let operation = generate_operation(&input(
                        seed,
                        template.id,
                        template.adversary_ids[0],
                        threat,
                        8,
                    ))
                    .unwrap_or_else(|error| panic!("{seed} {template:?}: {error}"));
                    validate_generated_operation(&operation)
                        .unwrap_or_else(|error| panic!("{seed} {}: {error}", template.id));
                }
            }
        }
    }

    #[test]
    fn progression_snapshot_defaults_and_round_trips() {
        let operation = generate_operation(&input(3, "identity-breach", "ghost-7", 4, 3)).unwrap();
        assert_eq!(
            operation.progression_snapshot,
            OperationProgressionSnapshot::default()
        );
        // A stored config written before the field existed still deserializes.
        let mut legacy = serde_json::to_value(&operation).unwrap();
        legacy
            .as_object_mut()
            .unwrap()
            .remove("progression_snapshot");
        let restored: GeneratedOperation = serde_json::from_value(legacy).unwrap();
        assert_eq!(
            restored.progression_snapshot,
            OperationProgressionSnapshot::default()
        );
    }

    fn identity(template_id: &str, adversary_id: &str) -> RecentOperationIdentity {
        RecentOperationIdentity {
            template_id: template_id.to_owned(),
            adversary_id: adversary_id.to_owned(),
        }
    }

    #[test]
    fn anti_repetition_avoids_the_last_two_templates_when_alternatives_exist() {
        let pool = random_selectable_templates();
        assert!(pool.len() >= 3);
        let recent = vec![
            identity(pool[0].id, "ghost-7"),
            identity(pool[1].id, "null"),
        ];
        for seed in 0..50u64 {
            let chosen = select_operation_template(&pool, &recent, seed).unwrap();
            assert_ne!(chosen.id, pool[0].id);
            assert_ne!(chosen.id, pool[1].id);
        }
    }

    #[test]
    fn anti_repetition_falls_back_to_a_single_template() {
        let only = operation_template("availability-siege").unwrap();
        let pool = [only];
        let recent = vec![identity("availability-siege", "null")];
        assert_eq!(
            select_operation_template(&pool, &recent, 9).map(|t| t.id),
            Some("availability-siege")
        );
    }

    #[test]
    fn anti_repetition_with_no_history_still_selects_an_eligible_template() {
        let pool = random_selectable_templates();
        let chosen = select_operation_template(&pool, &[], 1).unwrap();
        assert!(pool.iter().any(|template| template.id == chosen.id));
    }

    #[test]
    fn offer_selection_is_distinct_bounded_and_excludes_confrontation() {
        let pool = random_selectable_templates();
        let recent = vec![identity(pool[0].id, "ghost-7")];
        let offers = select_operation_offer_templates(&pool, &recent, 42, MAX_OPERATION_OFFERS);
        assert!(offers.len() <= MAX_OPERATION_OFFERS);
        let mut ids: Vec<&str> = offers.iter().map(|template| template.id).collect();
        let before = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), before, "offers must not repeat a template");
        assert!(!ids.contains(&"ghost7-confrontation"));
    }

    #[test]
    fn offer_sets_vary_and_respect_recent_history() {
        let pool = random_selectable_templates();
        let mut seen: BTreeSet<&str> = BTreeSet::new();
        let recent = vec![
            identity(pool[0].id, "ghost-7"),
            identity(pool[1].id, "null"),
        ];
        for seed in 0..50u64 {
            let offers =
                select_operation_offer_templates(&pool, &recent, seed, MAX_OPERATION_OFFERS);
            assert!(!offers.is_empty());
            assert!(offers.len() <= MAX_OPERATION_OFFERS);
            let mut ids: Vec<&str> = offers.iter().map(|template| template.id).collect();
            let before = ids.len();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), before, "offer sets must not repeat a template");
            // When at least three templates are eligible, the last two are kept
            // out of the offer set.
            if pool.len() >= 3 {
                assert!(
                    !ids.contains(&pool[0].id) && !ids.contains(&pool[1].id),
                    "recent templates leaked into the offer set"
                );
            }
            for offer in offers {
                seen.insert(offer.id);
            }
        }
        // Across seeds the pool is not dominated by one template.
        assert!(seen.len() > 1, "offers did not vary across seeds");
    }

    #[test]
    fn estimated_minutes_stays_plausible() {
        for template in OPERATION_TEMPLATES {
            let operation =
                generate_operation(&input(1, template.id, template.adversary_ids[0], 5, 5))
                    .unwrap();
            let minutes = estimated_operation_minutes(&operation);
            assert!((3..=20).contains(&minutes), "{} -> {minutes}", template.id);
        }
    }
}
