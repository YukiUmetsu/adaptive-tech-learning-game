//! Cyber Defense Stage 2 progression rules.
//!
//! One canonical place for the persistent progression economy: career and hero
//! XP curves, Tower/HQ upgrade costs, campaign and Operation rewards, adversary
//! ranks, and Threat Level bounds and recommendation.
//!
//! Everything here is pure and deterministic. Handlers, SQL, and React must not
//! re-derive these values: the server stays authoritative by calling these
//! functions and the client only previews them.
//!
//! See `docs/cyber-defense-game/Stage2.md`.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Highest career level the initial Stage 2 curve supports.
pub const CAREER_MAX_LEVEL: i32 = 30;
/// Highest hero level the initial Stage 2 curve supports.
pub const HERO_MAX_LEVEL: i32 = 20;

/// Lowest selectable Threat Level.
pub const THREAT_LEVEL_MIN: i32 = 1;
/// Highest selectable Threat Level.
///
/// Later stages may raise this without a schema change because the database
/// stores only `>= 1`.
pub const THREAT_LEVEL_MAX: i32 = 10;

/// Bits, career XP, and hero XP granted by one settled result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
pub struct CyberReward {
    /// Spendable Bits.
    pub bits: i64,
    /// Non-spendable career XP.
    pub career_xp: i64,
    /// Non-spendable hero XP for the run's selected hero.
    pub hero_xp: i64,
}

impl CyberReward {
    /// A reward that grants nothing.
    pub const ZERO: Self = Self {
        bits: 0,
        career_xp: 0,
        hero_xp: 0,
    };
}

/// One Tower/HQ room upgrade track.
///
/// `costs[i]` is the Bits cost to raise the room from level `i` to `i + 1`.
/// `prerequisite` is `(room_id, min_level)` that must already be met.
#[derive(Debug, Clone, Copy)]
pub struct TowerUpgradeDefinition {
    /// Stable upgrade identifier, equal to the room id.
    pub id: &'static str,
    /// Highest reachable level.
    pub max_level: i32,
    /// Per-step Bits costs.
    pub costs: &'static [i64],
    /// Optional prerequisite room and level.
    pub prerequisite: Option<(&'static str, i32)>,
}

/// Every Tower/HQ upgrade track, in display order.
pub const TOWER_UPGRADES: &[TowerUpgradeDefinition] = &[
    TowerUpgradeDefinition {
        id: "soc",
        max_level: 4,
        costs: &[40, 90, 180, 320],
        prerequisite: None,
    },
    TowerUpgradeDefinition {
        id: "threat_intelligence",
        max_level: 3,
        costs: &[60, 150, 300],
        prerequisite: Some(("soc", 1)),
    },
    TowerUpgradeDefinition {
        id: "training_center",
        max_level: 3,
        costs: &[50, 120, 260],
        prerequisite: None,
    },
    TowerUpgradeDefinition {
        id: "engineering_lab",
        max_level: 2,
        costs: &[70, 200],
        prerequisite: Some(("soc", 2)),
    },
    TowerUpgradeDefinition {
        id: "resilience_center",
        max_level: 2,
        costs: &[80, 220],
        prerequisite: Some(("training_center", 1)),
    },
];

/// Looks up a Tower/HQ upgrade track by id.
pub fn tower_upgrade(upgrade_id: &str) -> Option<&'static TowerUpgradeDefinition> {
    TOWER_UPGRADES.iter().find(|entry| entry.id == upgrade_id)
}

/// Cost in Bits to raise `upgrade_id` from `current_level` to the next level.
///
/// Returns `None` for an unknown upgrade, a negative level, or a room already at
/// its maximum level.
pub fn tower_upgrade_cost(upgrade_id: &str, current_level: i32) -> Option<i64> {
    if current_level < 0 {
        return None;
    }
    let upgrade = tower_upgrade(upgrade_id)?;
    let index = usize::try_from(current_level).ok()?;
    upgrade.costs.get(index).copied()
}

/// Aggregate Tower level derived from room levels: `1 + sum(room levels)`.
///
/// There is no second Tower XP system; this is the only Tower level.
pub fn tower_level(room_levels: &[i32]) -> i32 {
    1 + room_levels.iter().map(|level| (*level).max(0)).sum::<i32>()
}

/// Cumulative career XP required to reach `level`.
///
/// `None` for a level outside `1..=CAREER_MAX_LEVEL`.
pub fn xp_for_career_level(level: i32) -> Option<i64> {
    if !(1..=CAREER_MAX_LEVEL).contains(&level) {
        return None;
    }
    let mut xp = 0i64;
    for n in 2..=level {
        // Early levels arrive quickly: 100, 130, 160, 190, ...
        xp += 40 + 30 * i64::from(n);
    }
    Some(xp)
}

/// Cumulative hero XP required to reach `level`.
///
/// Heroes level faster than the overall career early on. `None` outside
/// `1..=HERO_MAX_LEVEL`.
pub fn xp_for_hero_level(level: i32) -> Option<i64> {
    if !(1..=HERO_MAX_LEVEL).contains(&level) {
        return None;
    }
    let mut xp = 0i64;
    for n in 2..=level {
        xp += 30 * i64::from(n);
    }
    Some(xp)
}

/// Career level implied by `xp`, clamped to `1..=CAREER_MAX_LEVEL`.
///
/// Negative XP is treated as zero, so a malformed import can never produce a
/// level below 1.
pub fn career_level_from_xp(xp: i64) -> i32 {
    let xp = xp.max(0);
    let mut level = 1;
    for candidate in 2..=CAREER_MAX_LEVEL {
        match xp_for_career_level(candidate) {
            Some(threshold) if threshold <= xp => level = candidate,
            _ => break,
        }
    }
    level
}

/// Hero level implied by `xp`, clamped to `1..=HERO_MAX_LEVEL`.
pub fn hero_level_from_xp(xp: i64) -> i32 {
    let xp = xp.max(0);
    let mut level = 1;
    for candidate in 2..=HERO_MAX_LEVEL {
        match xp_for_hero_level(candidate) {
            Some(threshold) if threshold <= xp => level = candidate,
            _ => break,
        }
    }
    level
}

/// Career rank label for a level.
pub fn career_rank(level: i32) -> &'static str {
    match level {
        ..=4 => "Junior Security Analyst",
        5..=9 => "Security Analyst",
        10..=14 => "Senior Security Analyst",
        15..=19 => "Incident Responder",
        20..=24 => "Threat Hunter",
        _ => "SOC Lead",
    }
}

/// Career XP still needed to reach the next level, or `None` at the cap.
pub fn career_xp_to_next_level(xp: i64) -> Option<i64> {
    let level = career_level_from_xp(xp);
    let next = level + 1;
    xp_for_career_level(next).map(|threshold| (threshold - xp).max(0))
}

/// Hero XP still needed to reach the next level, or `None` at the cap.
pub fn hero_xp_to_next_level(xp: i64) -> Option<i64> {
    let level = hero_level_from_xp(xp);
    let next = level + 1;
    xp_for_hero_level(next).map(|threshold| (threshold - xp).max(0))
}

/// Canonical Stage 1 campaign mission ids and their first-clear Bits base.
///
/// Kept here so the reward rule is server-authoritative and the API can reject
/// unknown mission ids without duplicating the list.
pub const CAMPAIGN_MISSIONS: &[(&str, i64)] = &[
    ("ddos-basics", 45),
    ("sql-injection", 50),
    ("credential-stuffing", 50),
    ("mixed-defense", 65),
    ("botnet-boss", 90),
];

/// Returns whether `mission_id` is a known Stage 1 campaign mission.
pub fn is_campaign_mission(mission_id: &str) -> bool {
    CAMPAIGN_MISSIONS.iter().any(|(id, _)| *id == mission_id)
}

/// The two Stage 1 heroes every profile reports, even before any XP is earned.
pub const DEFAULT_HERO_IDS: &[&str] = &["security_engineer", "sre"];

/// Returns whether `hero_id` is one of the two Stage 1 heroes.
pub fn is_known_hero(hero_id: &str) -> bool {
    DEFAULT_HERO_IDS.contains(&hero_id)
}

/// The campaign mission whose completion unlocks repeatable Operations.
pub const CAMPAIGN_FINAL_MISSION_ID: &str = "botnet-boss";

/// Whether the learner's campaign is complete enough to start Operations.
///
/// The server enforces this rather than trusting the UI: a learner must have
/// cleared the Chapter 1 boss before any Operation can be created.
pub fn campaign_complete(completed_mission_ids: &[String]) -> bool {
    completed_mission_ids
        .iter()
        .any(|id| id == CAMPAIGN_FINAL_MISSION_ID)
}

/// Hero XP multiplier granted by the Training Center room level.
///
/// Level 1 is the baseline; level 2 grants +10% hero XP, level 3 +15%. The
/// bonus is deliberately small and only ever applies to hero XP: Bits and
/// career XP are unaffected. The server derives the multiplier, so the client
/// can never submit a boosted value.
pub const TRAINING_CENTER_HERO_XP_BONUS_LV2: f64 = 1.10;
/// Hero XP multiplier at Training Center level 3.
pub const TRAINING_CENTER_HERO_XP_BONUS_LV3: f64 = 1.15;

/// Hero XP multiplier for a Training Center level.
pub fn training_center_hero_xp_multiplier(level: i32) -> f64 {
    match level {
        i32::MIN..=1 => 1.0,
        2 => TRAINING_CENTER_HERO_XP_BONUS_LV2,
        _ => TRAINING_CENTER_HERO_XP_BONUS_LV3,
    }
}

/// Applies a fractional multiplier to an XP amount, rounding down to an integer.
pub fn scale_xp(xp: i64, multiplier: f64) -> i64 {
    if xp <= 0 {
        return xp.max(0);
    }
    let scaled = (xp as f64 * multiplier.max(0.0)).round();
    scaled.max(0.0) as i64
}

fn campaign_base_bits(mission_id: &str) -> Option<i64> {
    CAMPAIGN_MISSIONS
        .iter()
        .find(|(id, _)| *id == mission_id)
        .map(|(_, base)| *base)
}

/// Reward for completing (or failing) a Stage 1 campaign mission.
///
/// `stars == 0` means the attempt failed: it earns a small amount of XP and no
/// Bits, so intentional failure is never economically useful. A first clear
/// earns the full reward; a replay earns reduced XP and no Bits, so replaying a
/// fixed mission can never become the best infinite Bits farm.
pub fn fixed_mission_reward(mission_id: &str, stars: i32, first_clear: bool) -> CyberReward {
    let Some(base) = campaign_base_bits(mission_id) else {
        return CyberReward::ZERO;
    };
    let stars = stars.clamp(0, 3);

    if stars == 0 {
        return CyberReward {
            bits: 0,
            career_xp: 10,
            hero_xp: 5,
        };
    }

    if first_clear {
        CyberReward {
            bits: base + 10 * i64::from(stars),
            career_xp: 70 + 15 * i64::from(stars),
            hero_xp: 35,
        }
    } else {
        CyberReward {
            bits: 0,
            career_xp: 15 + 5 * i64::from(stars),
            hero_xp: 10,
        }
    }
}

/// Reward for completing (or failing) one repeatable Operation.
///
/// Higher Threat Level never rewards less for the same result, but scaling is
/// linear so lower difficulties stay worthwhile. A failed Operation earns no
/// Bits and only a little XP.
pub fn operation_reward(
    threat_level: i32,
    stars: i32,
    completed: bool,
    first_adversary_clear: bool,
) -> CyberReward {
    let threat = threat_level.clamp(THREAT_LEVEL_MIN, THREAT_LEVEL_MAX);
    let stars = stars.clamp(0, 3);

    if !completed {
        return CyberReward {
            bits: 0,
            career_xp: 10 + i64::from(threat),
            hero_xp: 5,
        };
    }

    let first_bonus_bits = if first_adversary_clear { 25 } else { 0 };
    let first_bonus_xp = if first_adversary_clear { 20 } else { 0 };

    CyberReward {
        bits: 25 + 12 * i64::from(threat - 1) + 10 * i64::from(stars) + first_bonus_bits,
        career_xp: 50 + 12 * i64::from(threat) + 8 * i64::from(stars) + first_bonus_xp,
        hero_xp: 25 + 7 * i64::from(threat) + 5 * i64::from(stars),
    }
}

/// Cumulative adversary progress required to reach each rank 1..=10.
const ADVERSARY_RANK_THRESHOLDS: [i64; 10] = [0, 30, 70, 120, 180, 250, 330, 420, 520, 630];

/// Adversary rank implied by accumulated progress, clamped to `1..=10`.
///
/// Rank represents behaviour/story progression, never raw numeric difficulty.
/// Progress never regresses, so the rank never falls.
pub fn adversary_rank_from_progress(progress: i64) -> i32 {
    let progress = progress.max(0);
    let mut rank = 1;
    for (index, threshold) in ADVERSARY_RANK_THRESHOLDS.iter().enumerate() {
        if progress >= *threshold {
            rank = i32::try_from(index + 1).unwrap_or(10);
        } else {
            break;
        }
    }
    rank
}

/// Progress awarded to an adversary for one completed encounter.
///
/// An encounter always grants a little progress; a victory grants more, scaled
/// by Threat Level, and the first boss clear grants a larger step.
pub fn adversary_progress_award(
    threat_level: i32,
    completed: bool,
    boss: bool,
    first_boss_clear: bool,
) -> i64 {
    let threat = i64::from(threat_level.clamp(THREAT_LEVEL_MIN, THREAT_LEVEL_MAX));
    let mut award = 5 + threat;
    if completed {
        award += 15 + threat;
    }
    if boss && first_boss_clear {
        award += 60;
    }
    award
}

/// One recent Operation result used by the recommendation rule.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OperationOutcome {
    /// Whether the Operation was completed.
    pub completed: bool,
    /// Stars earned (0 for a failure).
    pub stars: i32,
    /// Fraction of system health remaining at the end, in `0..=1`.
    pub remaining_health_ratio: f64,
}

/// Inputs for the recommended-Threat-Level rule.
#[derive(Debug, Clone, PartialEq)]
pub struct ThreatRecommendationInput {
    /// The learner's current recommendation.
    pub current: i32,
    /// Most recent results, newest first. Only the first five are considered.
    pub recent: Vec<OperationOutcome>,
    /// Minimum average remaining-health ratio required to move up.
    pub health_ratio_threshold: f64,
}

/// Default minimum average remaining-health ratio to raise the recommendation.
pub const DEFAULT_HEALTH_RATIO_THRESHOLD: f64 = 0.5;

/// Recommends the next Threat Level from the last few results.
///
/// Raise by one when at least 4 of the last 5 are wins with average stars at
/// least 2 and enough health left; lower by one when at least 3 of the last 5
/// are failures; otherwise unchanged. Always clamped to the public bounds. The
/// recommendation is only advice: the player still chooses.
pub fn recommend_threat_level(input: &ThreatRecommendationInput) -> i32 {
    let current = input.current.clamp(THREAT_LEVEL_MIN, THREAT_LEVEL_MAX);
    let recent = &input.recent[..input.recent.len().min(5)];
    if recent.is_empty() {
        return current;
    }

    let total = recent.len() as f64;
    let wins = recent.iter().filter(|outcome| outcome.completed).count();
    let failures = recent.len() - wins;
    let average_stars = recent
        .iter()
        .map(|outcome| f64::from(outcome.stars))
        .sum::<f64>()
        / total;
    let average_health = recent
        .iter()
        .map(|outcome| outcome.remaining_health_ratio)
        .sum::<f64>()
        / total;

    if wins >= 4 && average_stars >= 2.0 && average_health >= input.health_ratio_threshold {
        (current + 1).clamp(THREAT_LEVEL_MIN, THREAT_LEVEL_MAX)
    } else if failures >= 3 {
        (current - 1).clamp(THREAT_LEVEL_MIN, THREAT_LEVEL_MAX)
    } else {
        current
    }
}

/// Highest Threat Level a learner is currently allowed to start.
///
/// `max(recommended + 2, highest_cleared + 1)`, clamped to the public bounds, so
/// a brand-new player cannot immediately farm the top Threat Level.
pub fn unlocked_threat_level(recommended: i32, highest_cleared: i32) -> i32 {
    let recommended = recommended.clamp(THREAT_LEVEL_MIN, THREAT_LEVEL_MAX);
    (recommended + 2)
        .max(highest_cleared + 1)
        .clamp(THREAT_LEVEL_MIN, THREAT_LEVEL_MAX)
}

/// One selectable hero talent.
#[derive(Debug, Clone, Copy)]
pub struct HeroTalentChoice {
    /// Stable choice identifier, shared with the frontend.
    pub id: &'static str,
    /// Learner-facing name.
    pub name: &'static str,
}

/// One hero talent milestone and its mutually exclusive choices.
#[derive(Debug, Clone, Copy)]
pub struct HeroMilestone {
    /// Hero level required to choose.
    pub level: i32,
    /// Mutually exclusive choices.
    pub choices: &'static [HeroTalentChoice],
}

/// Persistent progression definition for one hero.
#[derive(Debug, Clone, Copy)]
pub struct HeroProgressionDefinition {
    /// Hero identifier.
    pub hero_id: &'static str,
    /// Maximum hero level.
    pub max_level: i32,
    /// Talent milestones.
    pub milestones: &'static [HeroMilestone],
}

/// The two Stage 1 heroes and their Stage 2 talent milestones.
pub const HERO_PROGRESSION: &[HeroProgressionDefinition] = &[
    HeroProgressionDefinition {
        hero_id: "security_engineer",
        max_level: HERO_MAX_LEVEL,
        milestones: &[
            HeroMilestone {
                level: 5,
                choices: &[
                    HeroTalentChoice {
                        id: "rapid_response",
                        name: "Rapid Response",
                    },
                    HeroTalentChoice {
                        id: "deep_hardening",
                        name: "Deep Hardening",
                    },
                ],
            },
            HeroMilestone {
                level: 10,
                choices: &[
                    HeroTalentChoice {
                        id: "extended_field",
                        name: "Extended Field",
                    },
                    HeroTalentChoice {
                        id: "focused_strikes",
                        name: "Focused Strikes",
                    },
                ],
            },
            HeroMilestone {
                level: 15,
                choices: &[
                    HeroTalentChoice {
                        id: "standing_rule",
                        name: "Standing Rule",
                    },
                    HeroTalentChoice {
                        id: "broad_hardening",
                        name: "Broad Hardening",
                    },
                ],
            },
            HeroMilestone {
                level: 20,
                choices: &[
                    HeroTalentChoice {
                        id: "field_mastery",
                        name: "Field Mastery",
                    },
                    HeroTalentChoice {
                        id: "strike_mastery",
                        name: "Strike Mastery",
                    },
                ],
            },
        ],
    },
    HeroProgressionDefinition {
        hero_id: "sre",
        max_level: HERO_MAX_LEVEL,
        milestones: &[
            HeroMilestone {
                level: 5,
                choices: &[
                    HeroTalentChoice {
                        id: "burst_capacity",
                        name: "Burst Capacity",
                    },
                    HeroTalentChoice {
                        id: "sustained_capacity",
                        name: "Sustained Capacity",
                    },
                ],
            },
            HeroMilestone {
                level: 10,
                choices: &[
                    HeroTalentChoice {
                        id: "rapid_recovery",
                        name: "Rapid Recovery",
                    },
                    HeroTalentChoice {
                        id: "wide_shield",
                        name: "Wide Shield",
                    },
                ],
            },
            HeroMilestone {
                level: 15,
                choices: &[
                    HeroTalentChoice {
                        id: "deep_reserves",
                        name: "Deep Reserves",
                    },
                    HeroTalentChoice {
                        id: "long_hold",
                        name: "Long Hold",
                    },
                ],
            },
            HeroMilestone {
                level: 20,
                choices: &[
                    HeroTalentChoice {
                        id: "capacity_mastery",
                        name: "Capacity Mastery",
                    },
                    HeroTalentChoice {
                        id: "resilience_mastery",
                        name: "Resilience Mastery",
                    },
                ],
            },
        ],
    },
];

/// Looks up a hero's progression definition.
pub fn hero_progression(hero_id: &str) -> Option<&'static HeroProgressionDefinition> {
    HERO_PROGRESSION
        .iter()
        .find(|definition| definition.hero_id == hero_id)
}

/// Looks up the choices for one hero milestone.
pub fn hero_milestone_choices(hero_id: &str, level: i32) -> Option<&'static [HeroTalentChoice]> {
    hero_progression(hero_id)?
        .milestones
        .iter()
        .find(|milestone| milestone.level == level)
        .map(|milestone| milestone.choices)
}

/// Returns whether `choice_id` is a legal choice for the hero's milestone.
pub fn is_legal_talent(hero_id: &str, level: i32, choice_id: &str) -> bool {
    hero_milestone_choices(hero_id, level)
        .is_some_and(|choices| choices.iter().any(|choice| choice.id == choice_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn career_thresholds_match_the_documented_curve() {
        assert_eq!(xp_for_career_level(1), Some(0));
        assert_eq!(xp_for_career_level(2), Some(100));
        assert_eq!(xp_for_career_level(3), Some(230));
        assert_eq!(xp_for_career_level(4), Some(390));
        assert_eq!(xp_for_career_level(5), Some(580));
    }

    #[test]
    fn career_level_handles_threshold_edges_and_caps() {
        assert_eq!(career_level_from_xp(0), 1);
        assert_eq!(career_level_from_xp(99), 1);
        assert_eq!(career_level_from_xp(100), 2);
        assert_eq!(career_level_from_xp(229), 2);
        assert_eq!(career_level_from_xp(230), 3);
        assert_eq!(career_level_from_xp(i64::MAX), CAREER_MAX_LEVEL);
        assert_eq!(career_level_from_xp(-500), 1);
    }

    #[test]
    fn invalid_levels_are_rejected() {
        assert_eq!(xp_for_career_level(0), None);
        assert_eq!(xp_for_career_level(-1), None);
        assert_eq!(xp_for_career_level(CAREER_MAX_LEVEL + 1), None);
        assert_eq!(xp_for_hero_level(0), None);
        assert_eq!(xp_for_hero_level(HERO_MAX_LEVEL + 1), None);
    }

    #[test]
    fn hero_levels_advance_faster_than_career() {
        assert_eq!(xp_for_hero_level(2), Some(60));
        assert_eq!(hero_level_from_xp(60), 2);
        assert!(xp_for_hero_level(5).unwrap() < xp_for_career_level(5).unwrap());
        assert_eq!(hero_level_from_xp(i64::MAX), HERO_MAX_LEVEL);
    }

    #[test]
    fn career_rank_labels_cover_every_band() {
        assert_eq!(career_rank(1), "Junior Security Analyst");
        assert_eq!(career_rank(5), "Security Analyst");
        assert_eq!(career_rank(12), "Senior Security Analyst");
        assert_eq!(career_rank(17), "Incident Responder");
        assert_eq!(career_rank(22), "Threat Hunter");
        assert_eq!(career_rank(30), "SOC Lead");
    }

    #[test]
    fn tower_costs_are_positive_and_unknown_returns_none() {
        for upgrade in TOWER_UPGRADES {
            for level in 0..upgrade.max_level {
                let cost = tower_upgrade_cost(upgrade.id, level).expect("known level");
                assert!(
                    cost > 0,
                    "{} level {} cost must be positive",
                    upgrade.id,
                    level
                );
            }
            assert_eq!(tower_upgrade_cost(upgrade.id, upgrade.max_level), None);
        }
        assert_eq!(tower_upgrade_cost("does-not-exist", 0), None);
        assert_eq!(tower_upgrade_cost("soc", -1), None);
    }

    #[test]
    fn tower_level_is_one_plus_room_levels() {
        assert_eq!(tower_level(&[]), 1);
        assert_eq!(tower_level(&[1, 2, 0, 0, 0]), 4);
        assert_eq!(tower_level(&[-3]), 1);
    }

    #[test]
    fn fixed_mission_reward_is_monotonic_and_failure_earns_no_bits() {
        let first = fixed_mission_reward("mixed-defense", 3, true);
        let lower = fixed_mission_reward("mixed-defense", 1, true);
        assert!(first.bits > lower.bits);
        assert!(first.career_xp > lower.career_xp);

        let failed = fixed_mission_reward("mixed-defense", 0, false);
        assert_eq!(failed.bits, 0);
        assert!(failed.career_xp > 0);

        // A replay earns less than the first clear and no Bits.
        let replay = fixed_mission_reward("mixed-defense", 3, false);
        assert_eq!(replay.bits, 0);
        assert!(replay.career_xp < first.career_xp);
    }

    #[test]
    fn unknown_campaign_mission_grants_nothing() {
        assert_eq!(
            fixed_mission_reward("not-a-mission", 3, true),
            CyberReward::ZERO
        );
    }

    #[test]
    fn operation_reward_scales_with_threat_and_result() {
        let low = operation_reward(1, 3, true, false);
        let high = operation_reward(10, 3, true, false);
        assert!(high.bits > low.bits);
        assert!(high.career_xp > low.career_xp);
        assert!(high.hero_xp > low.hero_xp);

        // Higher Threat never rewards less for the same result.
        for threat in 2..=THREAT_LEVEL_MAX {
            let previous = operation_reward(threat - 1, 2, true, false);
            let current = operation_reward(threat, 2, true, false);
            assert!(current.bits >= previous.bits);
            assert!(current.career_xp >= previous.career_xp);
            assert!(current.hero_xp >= previous.hero_xp);
        }
    }

    #[test]
    fn failed_operation_reward_is_lower_than_success() {
        let success = operation_reward(5, 1, true, false);
        let failed = operation_reward(5, 0, false, false);
        assert_eq!(failed.bits, 0);
        assert!(failed.career_xp < success.career_xp);
        assert!(failed.hero_xp < success.hero_xp);
    }

    #[test]
    fn first_adversary_clear_adds_a_bonus() {
        let plain = operation_reward(4, 2, true, false);
        let first = operation_reward(4, 2, true, true);
        assert!(first.bits > plain.bits);
        assert!(first.career_xp > plain.career_xp);
    }

    #[test]
    fn adversary_rank_is_monotonic_and_bounded() {
        assert_eq!(adversary_rank_from_progress(-10), 1);
        assert_eq!(adversary_rank_from_progress(0), 1);
        assert_eq!(adversary_rank_from_progress(30), 2);
        assert_eq!(adversary_rank_from_progress(629), 9);
        assert_eq!(adversary_rank_from_progress(630), 10);
        assert_eq!(adversary_rank_from_progress(i64::MAX), 10);
    }

    #[test]
    fn recommendation_rises_on_strong_recent_wins() {
        let input = ThreatRecommendationInput {
            current: 3,
            recent: vec![
                OperationOutcome {
                    completed: true,
                    stars: 3,
                    remaining_health_ratio: 0.8,
                },
                OperationOutcome {
                    completed: true,
                    stars: 2,
                    remaining_health_ratio: 0.7,
                },
                OperationOutcome {
                    completed: true,
                    stars: 3,
                    remaining_health_ratio: 0.9,
                },
                OperationOutcome {
                    completed: true,
                    stars: 2,
                    remaining_health_ratio: 0.6,
                },
                OperationOutcome {
                    completed: false,
                    stars: 0,
                    remaining_health_ratio: 0.0,
                },
            ],
            health_ratio_threshold: DEFAULT_HEALTH_RATIO_THRESHOLD,
        };
        assert_eq!(recommend_threat_level(&input), 4);
    }

    #[test]
    fn recommendation_falls_on_recent_failures() {
        let input = ThreatRecommendationInput {
            current: 6,
            recent: vec![
                OperationOutcome {
                    completed: false,
                    stars: 0,
                    remaining_health_ratio: 0.0,
                },
                OperationOutcome {
                    completed: false,
                    stars: 0,
                    remaining_health_ratio: 0.0,
                },
                OperationOutcome {
                    completed: true,
                    stars: 1,
                    remaining_health_ratio: 0.1,
                },
                OperationOutcome {
                    completed: false,
                    stars: 0,
                    remaining_health_ratio: 0.0,
                },
            ],
            health_ratio_threshold: DEFAULT_HEALTH_RATIO_THRESHOLD,
        };
        assert_eq!(recommend_threat_level(&input), 5);
    }

    #[test]
    fn recommendation_unchanged_on_mixed_performance() {
        let input = ThreatRecommendationInput {
            current: 5,
            recent: vec![
                OperationOutcome {
                    completed: true,
                    stars: 1,
                    remaining_health_ratio: 0.2,
                },
                OperationOutcome {
                    completed: false,
                    stars: 0,
                    remaining_health_ratio: 0.0,
                },
                OperationOutcome {
                    completed: true,
                    stars: 2,
                    remaining_health_ratio: 0.4,
                },
                OperationOutcome {
                    completed: true,
                    stars: 1,
                    remaining_health_ratio: 0.3,
                },
            ],
            health_ratio_threshold: DEFAULT_HEALTH_RATIO_THRESHOLD,
        };
        assert_eq!(recommend_threat_level(&input), 5);
    }

    #[test]
    fn recommendation_is_clamped_at_both_ends() {
        let high = ThreatRecommendationInput {
            current: THREAT_LEVEL_MAX,
            recent: vec![
                OperationOutcome {
                    completed: true,
                    stars: 3,
                    remaining_health_ratio: 1.0,
                },
                OperationOutcome {
                    completed: true,
                    stars: 3,
                    remaining_health_ratio: 1.0,
                },
                OperationOutcome {
                    completed: true,
                    stars: 3,
                    remaining_health_ratio: 1.0,
                },
                OperationOutcome {
                    completed: true,
                    stars: 3,
                    remaining_health_ratio: 1.0,
                },
                OperationOutcome {
                    completed: true,
                    stars: 3,
                    remaining_health_ratio: 1.0,
                },
            ],
            health_ratio_threshold: DEFAULT_HEALTH_RATIO_THRESHOLD,
        };
        assert_eq!(recommend_threat_level(&high), THREAT_LEVEL_MAX);

        let low = ThreatRecommendationInput {
            current: THREAT_LEVEL_MIN,
            recent: vec![
                OperationOutcome {
                    completed: false,
                    stars: 0,
                    remaining_health_ratio: 0.0,
                },
                OperationOutcome {
                    completed: false,
                    stars: 0,
                    remaining_health_ratio: 0.0,
                },
                OperationOutcome {
                    completed: false,
                    stars: 0,
                    remaining_health_ratio: 0.0,
                },
            ],
            health_ratio_threshold: DEFAULT_HEALTH_RATIO_THRESHOLD,
        };
        assert_eq!(recommend_threat_level(&low), THREAT_LEVEL_MIN);
    }

    #[test]
    fn recommendation_with_no_history_is_unchanged() {
        let input = ThreatRecommendationInput {
            current: 7,
            recent: Vec::new(),
            health_ratio_threshold: DEFAULT_HEALTH_RATIO_THRESHOLD,
        };
        assert_eq!(recommend_threat_level(&input), 7);
    }

    #[test]
    fn unlocked_threat_level_stays_in_bounds() {
        assert_eq!(unlocked_threat_level(1, 0), 3);
        assert_eq!(unlocked_threat_level(5, 2), 7);
        assert_eq!(unlocked_threat_level(10, 10), THREAT_LEVEL_MAX);
        assert_eq!(unlocked_threat_level(0, -5), THREAT_LEVEL_MIN + 2);
        assert!(unlocked_threat_level(9, 9) <= THREAT_LEVEL_MAX);
    }

    #[test]
    fn progress_award_never_regresses_and_boss_bonus_applies_once() {
        let encounter = adversary_progress_award(3, false, false, false);
        let victory = adversary_progress_award(3, true, false, false);
        assert!(victory > encounter);
        let first_boss = adversary_progress_award(5, true, true, true);
        let repeat_boss = adversary_progress_award(5, true, true, false);
        assert!(first_boss > repeat_boss);
    }

    #[test]
    fn hero_talents_validate_against_milestones() {
        assert!(is_legal_talent("security_engineer", 5, "rapid_response"));
        assert!(is_legal_talent("sre", 5, "burst_capacity"));
        assert!(!is_legal_talent("security_engineer", 5, "burst_capacity"));
        assert!(!is_legal_talent("security_engineer", 6, "rapid_response"));
        assert!(!is_legal_talent("ghost", 5, "rapid_response"));
        assert!(hero_progression("security_engineer").is_some());
        assert!(hero_progression("nobody").is_none());
    }

    #[test]
    fn campaign_is_complete_only_after_the_chapter_one_boss() {
        assert!(!campaign_complete(&[]));
        assert!(!campaign_complete(&["ddos-basics".to_owned()]));
        assert!(campaign_complete(&[
            "ddos-basics".to_owned(),
            "botnet-boss".to_owned()
        ]));
    }

    #[test]
    fn training_center_bonus_is_small_and_monotonic() {
        assert_eq!(training_center_hero_xp_multiplier(0), 1.0);
        assert_eq!(training_center_hero_xp_multiplier(1), 1.0);
        assert_eq!(
            training_center_hero_xp_multiplier(2),
            TRAINING_CENTER_HERO_XP_BONUS_LV2
        );
        assert_eq!(
            training_center_hero_xp_multiplier(3),
            TRAINING_CENTER_HERO_XP_BONUS_LV3
        );
        // Never more than +15%, so hero XP cannot be farmed absurdly.
        assert!(training_center_hero_xp_multiplier(99) <= 1.15);
        assert!(scale_xp(35, training_center_hero_xp_multiplier(2)) > 35);
        assert_eq!(scale_xp(0, 1.1), 0);
        assert_eq!(scale_xp(35, 1.0), 35);
    }

    #[test]
    fn every_hero_milestone_has_two_distinct_choices() {
        for definition in HERO_PROGRESSION {
            assert!(DEFAULT_HERO_IDS.contains(&definition.hero_id));
            assert_eq!(definition.milestones.len(), 4);
            for milestone in definition.milestones {
                assert_eq!(milestone.choices.len(), 2);
                assert_ne!(milestone.choices[0].id, milestone.choices[1].id);
                assert!(is_legal_talent(
                    definition.hero_id,
                    milestone.level,
                    milestone.choices[0].id
                ));
            }
        }
    }
}
