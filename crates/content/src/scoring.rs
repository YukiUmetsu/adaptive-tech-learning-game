//! Canonical, server-side scoring for the three Phase 1 interactions.
//!
//! Scoring never trusts client-provided correctness or score. It validates the
//! submitted answer against the canonical content and returns a partial score
//! plus structured error codes.

use std::collections::{BTreeMap, HashSet};

use crate::model::{CanonicalAnswer, Interaction, Question};

/// Answer primitives submitted by a client.
#[derive(Debug, Clone, PartialEq)]
pub enum SubmittedAnswer {
    /// Item id to category id placements.
    Classification(BTreeMap<String, String>),
    /// Item ids in submitted order.
    Ordering(Vec<String>),
    /// Directed `(from, to)` relationships.
    NodeConnection(Vec<(String, String)>),
}

/// The outcome of scoring one attempt.
#[derive(Debug, Clone, PartialEq)]
pub struct ScoredAnswer {
    /// Whether the attempt was fully correct.
    pub correct: bool,
    /// Partial score in `[0, 1]`.
    pub score: f64,
    /// Structured error codes drawn from the question's declarations.
    pub error_codes: Vec<String>,
    /// Canonical answer, safe to reveal after scoring.
    pub canonical: CanonicalAnswer,
}

/// A malformed answer that cannot be scored.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ScoringError {
    /// The answer shape does not match the question interaction.
    #[error("answer does not match the question interaction type")]
    InteractionMismatch,
    /// An item id is not part of the question.
    #[error("unknown item id {0}")]
    UnknownItem(String),
    /// A category id is not part of the question.
    #[error("unknown category id {0}")]
    UnknownCategory(String),
    /// A node id is not part of the question.
    #[error("unknown node id {0}")]
    UnknownNode(String),
    /// An ordering answer is missing items or contains duplicates.
    #[error("ordering answer must contain each item exactly once")]
    InvalidOrdering,
    /// An edge is malformed (wrong shape or a self-loop).
    #[error("edge is malformed")]
    InvalidEdge,
}

impl ScoringError {
    /// Stable code suitable for a structured error field.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InteractionMismatch => "interaction_mismatch",
            Self::UnknownItem(_) => "unknown_item",
            Self::UnknownCategory(_) => "unknown_category",
            Self::UnknownNode(_) => "unknown_node",
            Self::InvalidOrdering => "invalid_ordering",
            Self::InvalidEdge => "invalid_edge",
        }
    }
}

/// Scores an answer against the question's canonical content.
pub fn score(question: &Question, answer: &SubmittedAnswer) -> Result<ScoredAnswer, ScoringError> {
    match (&question.interaction, answer) {
        (
            Interaction::Classification { items, categories },
            SubmittedAnswer::Classification(placements),
        ) => score_classification(question, items, categories, placements),
        (Interaction::Ordering { items }, SubmittedAnswer::Ordering(ordered_ids)) => {
            score_ordering(question, items, ordered_ids)
        }
        (Interaction::NodeConnection { nodes }, SubmittedAnswer::NodeConnection(edges)) => {
            score_connection(question, nodes, edges)
        }
        _ => Err(ScoringError::InteractionMismatch),
    }
}

fn score_classification(
    question: &Question,
    items: &[crate::model::Choice],
    categories: &[crate::model::Choice],
    placements: &BTreeMap<String, String>,
) -> Result<ScoredAnswer, ScoringError> {
    let item_ids: HashSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
    let category_ids: HashSet<&str> = categories.iter().map(|c| c.id.as_str()).collect();

    for (item, category) in placements {
        if !item_ids.contains(item.as_str()) {
            return Err(ScoringError::UnknownItem(item.clone()));
        }
        if !category_ids.contains(category.as_str()) {
            return Err(ScoringError::UnknownCategory(category.clone()));
        }
    }

    let canonical = match &question.canonical_answer {
        CanonicalAnswer::Classification { placements } => placements,
        _ => return Err(ScoringError::InteractionMismatch),
    };

    let mut correct_count = 0_usize;
    let mut misplaced = false;
    let mut incomplete = false;

    for item in items {
        match placements.get(&item.id) {
            None => incomplete = true,
            Some(category) if canonical.get(&item.id) == Some(category) => correct_count += 1,
            Some(_) => misplaced = true,
        }
    }

    let score = correct_count as f64 / items.len() as f64;
    let mut error_codes = Vec::new();
    if misplaced {
        error_codes.push("classification_misplaced".to_owned());
    }
    if incomplete {
        error_codes.push("classification_incomplete".to_owned());
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

fn score_ordering(
    question: &Question,
    items: &[crate::model::Choice],
    ordered_ids: &[String],
) -> Result<ScoredAnswer, ScoringError> {
    let item_ids: HashSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
    let submitted: HashSet<&str> = ordered_ids.iter().map(String::as_str).collect();

    if ordered_ids.len() != items.len() || submitted.len() != ordered_ids.len() {
        return Err(ScoringError::InvalidOrdering);
    }
    for id in ordered_ids {
        if !item_ids.contains(id.as_str()) {
            return Err(ScoringError::UnknownItem(id.clone()));
        }
    }

    let canonical = match &question.canonical_answer {
        CanonicalAnswer::Ordering { ordered_ids } => ordered_ids,
        _ => return Err(ScoringError::InteractionMismatch),
    };

    let matches = canonical
        .iter()
        .zip(ordered_ids.iter())
        .filter(|(expected, submitted)| expected == submitted)
        .count();
    let score = matches as f64 / canonical.len() as f64;

    let error_codes = if score >= 1.0 {
        Vec::new()
    } else {
        vec!["ordering_invalid_sequence".to_owned()]
    };

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

fn score_connection(
    question: &Question,
    nodes: &[crate::model::Node],
    edges: &[(String, String)],
) -> Result<ScoredAnswer, ScoringError> {
    let node_ids: HashSet<&str> = nodes.iter().map(|node| node.id.as_str()).collect();

    let mut submitted: HashSet<(String, String)> = HashSet::new();
    for (from, to) in edges {
        if from == to || from.is_empty() || to.is_empty() {
            return Err(ScoringError::InvalidEdge);
        }
        if !node_ids.contains(from.as_str()) {
            return Err(ScoringError::UnknownNode(from.clone()));
        }
        if !node_ids.contains(to.as_str()) {
            return Err(ScoringError::UnknownNode(to.clone()));
        }
        submitted.insert((from.clone(), to.clone()));
    }

    let canonical: HashSet<(String, String)> = match &question.canonical_answer {
        CanonicalAnswer::NodeConnection { edges } => edges
            .iter()
            .filter(|edge| edge.len() == 2)
            .map(|edge| (edge[0].clone(), edge[1].clone()))
            .collect(),
        _ => return Err(ScoringError::InteractionMismatch),
    };

    let hits = submitted.intersection(&canonical).count();
    let wrong = submitted.difference(&canonical).count();
    let total = canonical.len().max(1);
    let score = ((hits as f64 - wrong as f64) / total as f64).clamp(0.0, 1.0);

    let mut error_codes = Vec::new();
    if hits < canonical.len() {
        error_codes.push("connection_missing_relationship".to_owned());
    }
    if wrong > 0 {
        error_codes.push("connection_invalid_relationship".to_owned());
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Choice;

    fn question(interaction: Interaction, canonical: CanonicalAnswer) -> Question {
        Question {
            id: "q".to_owned(),
            content_version: "v1".to_owned(),
            certification_version: "cert".to_owned(),
            domain_id: "domain-1".to_owned(),
            task_id: "1.1".to_owned(),
            assessment_mode: adaptive_learn_domain::AssessmentMode::Recognition,
            interaction_type: adaptive_learn_domain::InteractionType::Classification,
            difficulty_prior: 0.3,
            prompt: "prompt".to_owned(),
            interaction,
            canonical_answer: canonical,
            concepts: Vec::new(),
            explanation: "because".to_owned(),
            hints: Vec::new(),
            error_codes: Vec::new(),
            source_refs: Vec::new(),
        }
    }

    #[test]
    fn classification_scores_partial_credit() {
        let mut placements = BTreeMap::new();
        placements.insert("a".to_owned(), "x".to_owned());
        placements.insert("b".to_owned(), "y".to_owned());

        let q = question(
            Interaction::Classification {
                items: vec![
                    Choice {
                        id: "a".to_owned(),
                        label: "A".to_owned(),
                    },
                    Choice {
                        id: "b".to_owned(),
                        label: "B".to_owned(),
                    },
                ],
                categories: vec![
                    Choice {
                        id: "x".to_owned(),
                        label: "X".to_owned(),
                    },
                    Choice {
                        id: "y".to_owned(),
                        label: "Y".to_owned(),
                    },
                ],
            },
            CanonicalAnswer::Classification { placements },
        );

        let mut submitted = BTreeMap::new();
        submitted.insert("a".to_owned(), "x".to_owned());
        submitted.insert("b".to_owned(), "x".to_owned());

        let scored = score(&q, &SubmittedAnswer::Classification(submitted)).expect("score");
        assert_eq!(scored.score, 0.5);
        assert!(!scored.correct);
        assert_eq!(scored.error_codes, vec!["classification_misplaced"]);
    }

    #[test]
    fn ordering_scores_positions() {
        let q = question(
            Interaction::Ordering {
                items: vec![
                    Choice {
                        id: "a".to_owned(),
                        label: "A".to_owned(),
                    },
                    Choice {
                        id: "b".to_owned(),
                        label: "B".to_owned(),
                    },
                    Choice {
                        id: "c".to_owned(),
                        label: "C".to_owned(),
                    },
                ],
            },
            CanonicalAnswer::Ordering {
                ordered_ids: vec!["a".to_owned(), "b".to_owned(), "c".to_owned()],
            },
        );

        let scored = score(
            &q,
            &SubmittedAnswer::Ordering(vec!["a".to_owned(), "c".to_owned(), "b".to_owned()]),
        )
        .expect("score");

        assert!((scored.score - 1.0 / 3.0).abs() < 1e-9);
        assert_eq!(scored.error_codes, vec!["ordering_invalid_sequence"]);
    }

    #[test]
    fn ordering_rejects_duplicate_items() {
        let q = question(
            Interaction::Ordering {
                items: vec![
                    Choice {
                        id: "a".to_owned(),
                        label: "A".to_owned(),
                    },
                    Choice {
                        id: "b".to_owned(),
                        label: "B".to_owned(),
                    },
                ],
            },
            CanonicalAnswer::Ordering {
                ordered_ids: vec!["a".to_owned(), "b".to_owned()],
            },
        );

        let result = score(
            &q,
            &SubmittedAnswer::Ordering(vec!["a".to_owned(), "a".to_owned()]),
        );
        assert_eq!(result, Err(ScoringError::InvalidOrdering));
    }

    #[test]
    fn connection_penalizes_invalid_edges() {
        let q = question(
            Interaction::NodeConnection {
                nodes: vec![
                    crate::model::Node {
                        id: "a".to_owned(),
                        label: "A".to_owned(),
                        x: 0.0,
                        y: 0.0,
                    },
                    crate::model::Node {
                        id: "b".to_owned(),
                        label: "B".to_owned(),
                        x: 1.0,
                        y: 0.0,
                    },
                    crate::model::Node {
                        id: "c".to_owned(),
                        label: "C".to_owned(),
                        x: 1.0,
                        y: 1.0,
                    },
                ],
            },
            CanonicalAnswer::NodeConnection {
                edges: vec![
                    vec!["a".to_owned(), "b".to_owned()],
                    vec!["b".to_owned(), "c".to_owned()],
                ],
            },
        );

        let scored = score(
            &q,
            &SubmittedAnswer::NodeConnection(vec![("a".to_owned(), "b".to_owned())]),
        )
        .expect("score");

        assert_eq!(scored.score, 0.5);
        assert_eq!(scored.error_codes, vec!["connection_missing_relationship"]);

        let invalid = score(
            &q,
            &SubmittedAnswer::NodeConnection(vec![
                ("a".to_owned(), "b".to_owned()),
                ("c".to_owned(), "a".to_owned()),
            ]),
        )
        .expect("score");
        assert_eq!(invalid.score, 0.0);
        assert!(
            invalid
                .error_codes
                .contains(&"connection_invalid_relationship".to_owned())
        );
    }

    #[test]
    fn connection_rejects_unknown_nodes() {
        let q = question(
            Interaction::NodeConnection {
                nodes: vec![
                    crate::model::Node {
                        id: "a".to_owned(),
                        label: "A".to_owned(),
                        x: 0.0,
                        y: 0.0,
                    },
                    crate::model::Node {
                        id: "b".to_owned(),
                        label: "B".to_owned(),
                        x: 1.0,
                        y: 0.0,
                    },
                ],
            },
            CanonicalAnswer::NodeConnection {
                edges: vec![vec!["a".to_owned(), "b".to_owned()]],
            },
        );

        let result = score(
            &q,
            &SubmittedAnswer::NodeConnection(vec![("a".to_owned(), "zzz".to_owned())]),
        );
        assert_eq!(result, Err(ScoringError::UnknownNode("zzz".to_owned())));
    }
}
