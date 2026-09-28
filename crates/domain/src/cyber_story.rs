//! Stage 2 story progression.
//!
//! Story nodes are small, data-driven beats triggered by concrete progress:
//! campaign completion, Operation counts, adversary ranks, cleared Threat
//! Levels, and earlier story nodes. There are deliberately no calendar or
//! date-based triggers, and story never blocks gameplay.
//!
//! See `docs/cyber-defense-game/Stage2.md` step 16.

use serde::{Deserialize, Serialize};

/// Why a story node becomes available.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StoryTrigger {
    /// A specific campaign mission was completed.
    CampaignMissionCompleted {
        /// Campaign mission id.
        mission_id: &'static str,
    },
    /// At least this many repeatable Operations were completed.
    OperationsCompleted {
        /// Required count.
        count: i32,
    },
    /// An adversary reached at least this rank.
    AdversaryRankReached {
        /// Adversary id.
        adversary_id: &'static str,
        /// Required rank.
        rank: i32,
    },
    /// A Threat Level was cleared.
    ThreatLevelCleared {
        /// Required Threat Level.
        threat_level: i32,
    },
    /// A specific Operation template was completed.
    ///
    /// Used by the Stage 2 climax, which must be an actual battle rather than a
    /// rank number crossing a threshold.
    OperationTemplateCompleted {
        /// Required Operation template id.
        template_id: &'static str,
    },
    /// Another story node was completed.
    StoryNodeCompleted {
        /// Required node id.
        node_id: &'static str,
    },
}

/// The special Operation that resolves the Stage 2 climax.
pub const CONFRONTATION_TEMPLATE_ID: &str = "ghost7-confrontation";

/// The story node that must be complete before the confrontation can appear.
pub const CONFRONTATION_PREREQUISITE_NODE: &str = "chapter-4-biolab";

/// The GHOST-7 rank required to unlock the confrontation Operation.
pub const CONFRONTATION_ADVERSARY_RANK: i32 = 5;

/// One story beat.
#[derive(Debug, Clone, Copy)]
pub struct StoryNodeDefinition {
    /// Node id.
    pub id: &'static str,
    /// Chapter id.
    pub chapter_id: &'static str,
    /// Learner-facing title.
    pub title: &'static str,
    /// Two to four short paragraphs.
    pub body: &'static [&'static str],
    /// Trigger condition.
    pub trigger: StoryTrigger,
    /// Optional earlier node that must be completed first.
    pub requires: Option<&'static str>,
}

/// The Stage 2 story beats.
pub const STORY_NODES: &[StoryNodeDefinition] = &[
    StoryNodeDefinition {
        id: "chapter-1-complete",
        chapter_id: "chapter-1",
        title: "Chapter 1 — First Contact",
        body: &[
            "The botnet is contained and the storefront is stable.",
            "The pattern behind the attacks is bigger than one flood. Repeatable Operations are now unlocked.",
        ],
        trigger: StoryTrigger::CampaignMissionCompleted {
            mission_id: "botnet-boss",
        },
        requires: None,
    },
    StoryNodeDefinition {
        id: "chapter-2-ghost7",
        chapter_id: "chapter-2",
        title: "Chapter 2 — Pattern Recognition",
        body: &[
            "A recurring signature shows up in the identity logs: GHOST-7.",
            "It rarely forces a door. It waits for a reused credential instead.",
        ],
        trigger: StoryTrigger::OperationsCompleted { count: 1 },
        requires: Some("chapter-1-complete"),
    },
    StoryNodeDefinition {
        id: "chapter-2-clue",
        chapter_id: "chapter-2",
        title: "Chapter 2 — The Quiet Signal",
        body: &[
            "GHOST-7 changed tactics. Some of its traffic no longer announces itself.",
            "Detection is no longer optional against this adversary.",
        ],
        trigger: StoryTrigger::AdversaryRankReached {
            adversary_id: "ghost-7",
            rank: 2,
        },
        requires: Some("chapter-2-ghost7"),
    },
    StoryNodeDefinition {
        id: "chapter-3-null",
        chapter_id: "chapter-3",
        title: "Chapter 3 — Multiple Vectors",
        body: &[
            "The attacks are coordinating. While one front distracts you, another probes the application.",
            "NULL specializes in exactly that misdirection.",
        ],
        trigger: StoryTrigger::OperationsCompleted { count: 3 },
        requires: Some("chapter-2-ghost7"),
    },
    StoryNodeDefinition {
        id: "chapter-3-viper",
        chapter_id: "chapter-3",
        title: "Chapter 3 — Impact",
        body: &[
            "VIPER does not care about stealth. It wants to encrypt everything it can reach.",
            "Containment and recovery are now part of the same fight.",
        ],
        trigger: StoryTrigger::AdversaryRankReached {
            adversary_id: "viper",
            rank: 2,
        },
        requires: Some("chapter-3-null"),
    },
    StoryNodeDefinition {
        id: "chapter-4-biolab",
        chapter_id: "chapter-4",
        title: "Chapter 4 — Targeted Research",
        body: &[
            "The targeting was never random. A specific research network is being mapped.",
            "Every adversary is a different instrument pointed at the same target.",
        ],
        trigger: StoryTrigger::ThreatLevelCleared { threat_level: 5 },
        requires: Some("chapter-3-null"),
    },
    StoryNodeDefinition {
        id: "chapter-5-climax",
        chapter_id: "chapter-5",
        title: "Chapter 5 — The Confrontation",
        body: &[
            "GHOST-7 has stopped hiding. This is the operation the last months were building toward.",
            "Hold the line.",
        ],
        trigger: StoryTrigger::OperationTemplateCompleted {
            template_id: CONFRONTATION_TEMPLATE_ID,
        },
        requires: Some(CONFRONTATION_PREREQUISITE_NODE),
    },
    StoryNodeDefinition {
        id: "chapter-5-hook",
        chapter_id: "chapter-5",
        title: "Chapter 5 — Open Thread",
        body: &[
            "The immediate threat is over, but the adversary's sponsor was never identified.",
            "The story continues in a later stage.",
        ],
        trigger: StoryTrigger::StoryNodeCompleted {
            node_id: "chapter-5-climax",
        },
        requires: Some("chapter-5-climax"),
    },
];

/// Looks up a story node by id.
pub fn story_node(id: &str) -> Option<&'static StoryNodeDefinition> {
    STORY_NODES.iter().find(|node| node.id == id)
}

/// Progress facts used to evaluate story triggers.
#[derive(Debug, Clone, Default)]
pub struct StoryProgressInput {
    /// Completed campaign mission ids.
    pub completed_campaign_missions: Vec<String>,
    /// Total completed repeatable Operations.
    pub total_operations_completed: i32,
    /// Highest Threat Level ever cleared.
    pub highest_threat_level_cleared: i32,
    /// `(adversary_id, rank)` pairs.
    pub adversary_ranks: Vec<(String, i32)>,
    /// Completed repeatable Operation template ids.
    pub completed_operation_templates: Vec<String>,
    /// Already-completed story node ids.
    pub completed_nodes: Vec<String>,
}

fn trigger_met(trigger: &StoryTrigger, input: &StoryProgressInput, completed: &[String]) -> bool {
    match trigger {
        StoryTrigger::CampaignMissionCompleted { mission_id } => input
            .completed_campaign_missions
            .iter()
            .any(|done| done == mission_id),
        StoryTrigger::OperationsCompleted { count } => input.total_operations_completed >= *count,
        StoryTrigger::AdversaryRankReached { adversary_id, rank } => input
            .adversary_ranks
            .iter()
            .any(|(id, current)| id == adversary_id && current >= rank),
        StoryTrigger::ThreatLevelCleared { threat_level } => {
            input.highest_threat_level_cleared >= *threat_level
        }
        StoryTrigger::OperationTemplateCompleted { template_id } => input
            .completed_operation_templates
            .iter()
            .any(|id| id == template_id),
        // Checked against the evolving set so a node completed earlier in this
        // same pass can unlock its successor immediately.
        StoryTrigger::StoryNodeCompleted { node_id } => completed.iter().any(|id| id == node_id),
    }
}

/// Whether the Stage 2 climax Operation should be offered.
///
/// It is gated on a real story milestone *and* GHOST-7 reaching its rank, and
/// it is only resolved by winning the battle (the story node triggers on the
/// Operation template completing), never by the rank number alone.
pub fn confrontation_available(input: &StoryProgressInput) -> bool {
    let story_ready = input
        .completed_nodes
        .iter()
        .any(|id| id == CONFRONTATION_PREREQUISITE_NODE);
    let rank_ready = input
        .adversary_ranks
        .iter()
        .any(|(id, rank)| id == "ghost-7" && *rank >= CONFRONTATION_ADVERSARY_RANK);
    story_ready && rank_ready
}

/// Returns newly triggered story node ids, in story order.
///
/// Evaluation is pure and idempotent: already-completed nodes are skipped, and
/// nodes are only considered once their prerequisite is completed.
pub fn evaluate_story_nodes(input: &StoryProgressInput) -> Vec<String> {
    let mut completed = input.completed_nodes.clone();
    let mut newly = Vec::new();
    // Iterate until stable so a node triggered by an earlier node in the same
    // pass is picked up.
    loop {
        let mut progressed = false;
        for node in STORY_NODES {
            if completed.iter().any(|id| id == node.id) {
                continue;
            }
            if let Some(required) = node.requires {
                if !completed.iter().any(|id| id == required) {
                    continue;
                }
            }
            if trigger_met(&node.trigger, input, &completed) {
                completed.push(node.id.to_owned());
                newly.push(node.id.to_owned());
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }
    newly
}

/// The active chapter implied by the completed nodes.
pub fn active_chapter(completed_nodes: &[String]) -> &'static str {
    let mut chapter = "chapter-1";
    for node in STORY_NODES {
        if completed_nodes.iter().any(|id| id == node.id) {
            chapter = node.chapter_id;
        }
    }
    chapter
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boss_clear_unlocks_operations_story() {
        let input = StoryProgressInput {
            completed_campaign_missions: vec!["botnet-boss".to_owned()],
            ..Default::default()
        };
        assert_eq!(evaluate_story_nodes(&input), vec!["chapter-1-complete"]);
    }

    #[test]
    fn story_nodes_trigger_once_and_in_order() {
        let input = StoryProgressInput {
            completed_campaign_missions: vec!["botnet-boss".to_owned()],
            total_operations_completed: 3,
            highest_threat_level_cleared: 5,
            adversary_ranks: vec![("ghost-7".to_owned(), 5), ("viper".to_owned(), 2)],
            completed_operation_templates: Vec::new(),
            completed_nodes: Vec::new(),
        };
        let first = evaluate_story_nodes(&input);
        assert!(first.contains(&"chapter-1-complete".to_owned()));
        assert!(first.contains(&"chapter-4-biolab".to_owned()));
        // The climax is not resolved by rank alone: it needs the battle.
        assert!(!first.contains(&"chapter-5-climax".to_owned()));
        assert!(!first.contains(&"chapter-5-hook".to_owned()));

        // Re-evaluating with the nodes now completed yields nothing new.
        let mut with_completed = input.clone();
        with_completed.completed_nodes = first.clone();
        assert!(evaluate_story_nodes(&with_completed).is_empty());
    }

    #[test]
    fn climax_requires_completing_the_confrontation_battle() {
        let mut input = StoryProgressInput {
            completed_campaign_missions: vec!["botnet-boss".to_owned()],
            total_operations_completed: 3,
            highest_threat_level_cleared: 5,
            adversary_ranks: vec![("ghost-7".to_owned(), 5)],
            completed_operation_templates: Vec::new(),
            completed_nodes: Vec::new(),
        };
        let prerequisite = evaluate_story_nodes(&input);
        assert!(prerequisite.contains(&"chapter-4-biolab".to_owned()));
        assert!(!prerequisite.contains(&"chapter-5-climax".to_owned()));

        // The confrontation Operation is now available.
        input.completed_nodes = prerequisite;
        assert!(confrontation_available(&input));

        // Winning it (recorded as a completed template) resolves the climax and
        // only then the hook.
        input.completed_operation_templates = vec![CONFRONTATION_TEMPLATE_ID.to_owned()];
        let resolved = evaluate_story_nodes(&input);
        assert_eq!(
            resolved,
            vec!["chapter-5-climax".to_owned(), "chapter-5-hook".to_owned()]
        );
    }

    #[test]
    fn confrontation_is_not_available_before_rank_or_story() {
        let rank_only = StoryProgressInput {
            adversary_ranks: vec![("ghost-7".to_owned(), 9)],
            ..Default::default()
        };
        assert!(!confrontation_available(&rank_only));

        let story_only = StoryProgressInput {
            completed_nodes: vec![CONFRONTATION_PREREQUISITE_NODE.to_owned()],
            ..Default::default()
        };
        assert!(!confrontation_available(&story_only));
    }

    #[test]
    fn unmet_prerequisite_blocks_a_node() {
        let input = StoryProgressInput {
            total_operations_completed: 3,
            ..Default::default()
        };
        // chapter-3-null requires chapter-2-ghost7, which requires chapter-1.
        assert!(evaluate_story_nodes(&input).is_empty());
    }

    #[test]
    fn active_chapter_tracks_latest_node() {
        let completed = vec!["chapter-1-complete".to_owned(), "chapter-3-null".to_owned()];
        assert_eq!(active_chapter(&completed), "chapter-3");
        assert_eq!(active_chapter(&[]), "chapter-1");
    }
}
