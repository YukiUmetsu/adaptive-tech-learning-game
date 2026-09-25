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
    /// Slot placements and optional directed relationships.
    Reconstruction {
        /// Slot id to piece id.
        placements: BTreeMap<String, String>,
        /// Directed `(from, to)` relationships the learner drew.
        edges: Vec<(String, String)>,
    },
    /// Selected evidence source ids.
    EvidenceSelection(Vec<String>),
    /// Selected faulty element ids.
    SpotTheFault(Vec<String>),
    /// Slot id to option id values.
    FillSlots(BTreeMap<String, String>),
    /// Ordered choice ids navigating a branching scenario.
    Branching(Vec<String>),
    /// Slot id to piece id assignments.
    ConfigurationBuilder(BTreeMap<String, String>),
    /// Item id to submitted point.
    TwoDimensionalPlacement(BTreeMap<String, crate::model::PlacementPoint>),
    /// Slot id to token id values.
    CommandAssembly(BTreeMap<String, String>),
    /// Slot id to raw typed text for inline blanks.
    TypedFillBlank(BTreeMap<String, String>),
    /// Selected choice id for a multiple-choice question.
    MultipleChoice(String),
    /// Selected choice ids for a multiple-response question.
    MultipleResponse(Vec<String>),
    /// Count of authored Python tests that passed in the browser runtime.
    ///
    /// Execution happens client-side, so the server can validate the shape and
    /// the reported total but cannot independently re-run the learner program.
    /// See `docs/14-security-privacy.md` for the trust model.
    PythonCode {
        /// Tests that passed.
        passed: usize,
        /// Tests that were run; must equal the authored test count.
        total: usize,
    },
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
    /// An evidence id is not part of the question.
    #[error("unknown evidence id {0}")]
    UnknownEvidence(String),
    /// An element id is not part of the question.
    #[error("unknown element id {0}")]
    UnknownElement(String),
    /// A slot id is not part of the question.
    #[error("unknown slot id {0}")]
    UnknownSlot(String),
    /// An option id is not part of the question.
    #[error("unknown option id {0}")]
    UnknownOption(String),
    /// A component piece id is not part of the question.
    #[error("unknown piece id {0}")]
    UnknownPiece(String),
    /// A branching-scenario path violates the authored transitions.
    #[error("scenario path is not valid for this scenario")]
    InvalidScenarioPath,
    /// A submitted point is outside the valid `0..=1` placement space.
    #[error("placement point is outside the valid space")]
    InvalidPlacement,
    /// A token id is not part of the question.
    #[error("unknown token id {0}")]
    UnknownToken(String),
    /// A choice id is not part of the question.
    #[error("unknown choice id {0}")]
    UnknownChoice(String),
    /// A multiple-response answer repeats a choice id.
    #[error("duplicate choice id {0}")]
    DuplicateChoice(String),
    /// A Python result reports a test total that does not match the content.
    #[error("python result reported {reported} tests but content has {expected}")]
    PythonTestCountMismatch {
        /// Number of authored tests.
        expected: usize,
        /// Number of tests the client claims to have run.
        reported: usize,
    },
    /// A Python result is internally inconsistent.
    #[error("python result is not internally consistent")]
    PythonResultInvalid,
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
            Self::UnknownEvidence(_) => "unknown_evidence",
            Self::UnknownElement(_) => "unknown_element",
            Self::UnknownSlot(_) => "unknown_slot",
            Self::UnknownOption(_) => "unknown_option",
            Self::UnknownPiece(_) => "unknown_piece",
            Self::InvalidScenarioPath => "invalid_scenario_path",
            Self::InvalidPlacement => "invalid_placement",
            Self::UnknownToken(_) => "unknown_token",
            Self::UnknownChoice(_) => "unknown_choice",
            Self::DuplicateChoice(_) => "duplicate_choice",
            Self::PythonTestCountMismatch { .. } => "python_test_count_mismatch",
            Self::PythonResultInvalid => "python_result_invalid",
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
        (
            Interaction::Reconstruction {
                layout,
                fixed_nodes,
                pieces,
                slots,
                ..
            },
            SubmittedAnswer::Reconstruction { placements, edges },
        ) => score_reconstruction(
            question,
            *layout,
            fixed_nodes,
            pieces,
            slots,
            placements,
            edges,
        ),
        (
            Interaction::EvidenceSelection { evidence },
            SubmittedAnswer::EvidenceSelection(selected),
        ) => score_evidence_selection(question, evidence, selected),
        (Interaction::SpotTheFault { elements }, SubmittedAnswer::SpotTheFault(selected)) => {
            score_spot_the_fault(question, elements, selected)
        }
        (Interaction::FillSlots { slots, options }, SubmittedAnswer::FillSlots(values)) => {
            score_fill_slots(question, slots, options, values)
        }
        (
            Interaction::Troubleshooting {
                start_step_id,
                steps,
            },
            SubmittedAnswer::Branching(path),
        ) => score_branching(question, start_step_id, steps, path, "troubleshooting"),
        (
            Interaction::ScenarioChoiceChain {
                start_step_id,
                steps,
            },
            SubmittedAnswer::Branching(path),
        ) => score_branching(question, start_step_id, steps, path, "scenario_choice"),
        (
            Interaction::ConfigurationBuilder { slots, pieces },
            SubmittedAnswer::ConfigurationBuilder(assignments),
        ) => score_configuration(question, slots, pieces, assignments),
        (
            Interaction::TwoDimensionalPlacement { items, .. },
            SubmittedAnswer::TwoDimensionalPlacement(points),
        ) => score_placement(question, items, points),
        (
            Interaction::CommandAssembly { slots, tokens },
            SubmittedAnswer::CommandAssembly(values),
        ) => score_command_assembly(question, slots, tokens, values),
        (Interaction::TypedFillBlank { slots, .. }, SubmittedAnswer::TypedFillBlank(values)) => {
            score_typed_fill_blank(question, slots, values)
        }
        (Interaction::MultipleChoice { choices }, SubmittedAnswer::MultipleChoice(choice_id)) => {
            score_multiple_choice(question, choices, choice_id)
        }
        (
            Interaction::MultipleResponse { choices, .. },
            SubmittedAnswer::MultipleResponse(choice_ids),
        ) => score_multiple_response(question, choices, choice_ids),
        (Interaction::PythonCode { .. }, SubmittedAnswer::PythonCode { passed, total }) => {
            score_python_code(question, *passed, *total)
        }
        _ => Err(ScoringError::InteractionMismatch),
    }
}

/// Scores a browser-executed Python attempt from its reported test counts.
///
/// The server cannot re-run the learner's program, so it validates that the
/// reported total matches the authored tests and derives partial credit from
/// the pass count. This mirrors the local-only trust already accepted for
/// offline study; see `docs/14-security-privacy.md`.
fn score_python_code(
    question: &Question,
    passed: usize,
    total: usize,
) -> Result<ScoredAnswer, ScoringError> {
    let CanonicalAnswer::PythonCode { tests } = &question.canonical_answer else {
        return Err(ScoringError::InteractionMismatch);
    };

    let expected = tests.len();
    if total != expected {
        return Err(ScoringError::PythonTestCountMismatch {
            expected,
            reported: total,
        });
    }
    if passed > total {
        return Err(ScoringError::PythonResultInvalid);
    }

    let score = if expected == 0 {
        0.0
    } else {
        passed as f64 / expected as f64
    };
    let correct = expected > 0 && passed == expected;
    let error_codes = if correct {
        Vec::new()
    } else {
        vec!["python_tests_failed".to_owned()]
    };

    Ok(ScoredAnswer {
        correct,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
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

/// Set overlap shared by selection-style interactions.
struct SelectionOutcome {
    /// Selected ids that are canonical.
    hits: usize,
    /// Selected ids that are not canonical.
    false_positives: usize,
    /// Canonical ids that were not selected.
    missed: usize,
}

fn evaluate_selection(canonical: &[String], selected: &[String]) -> SelectionOutcome {
    let canonical_set: HashSet<&str> = canonical.iter().map(String::as_str).collect();
    let unique: HashSet<&str> = selected.iter().map(String::as_str).collect();

    let hits = unique
        .iter()
        .filter(|id| canonical_set.contains(**id))
        .count();
    let false_positives = unique.len() - hits;
    let missed = canonical_set.len() - hits;

    SelectionOutcome {
        hits,
        false_positives,
        missed,
    }
}

/// Placement and topology weights for graph reconstruction. Fixed so scoring is
/// deterministic and comparable across attempts.
const GRAPH_PLACEMENT_WEIGHT: f64 = 0.7;
const GRAPH_EDGE_WEIGHT: f64 = 0.3;

fn score_reconstruction(
    question: &Question,
    layout: crate::model::ReconstructionLayout,
    fixed_nodes: &[crate::model::FixedNode],
    pieces: &[crate::model::Choice],
    slots: &[crate::model::ReconstructionSlot],
    placements: &BTreeMap<String, String>,
    edges: &[(String, String)],
) -> Result<ScoredAnswer, ScoringError> {
    let piece_ids: HashSet<&str> = pieces.iter().map(|piece| piece.id.as_str()).collect();
    // Edges may reference either a candidate piece or a provided fixed node.
    let node_ids: HashSet<&str> = piece_ids
        .iter()
        .copied()
        .chain(fixed_nodes.iter().map(|node| node.id.as_str()))
        .collect();
    let slot_ids: HashSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();

    for (slot_id, piece_id) in placements {
        if !slot_ids.contains(slot_id.as_str()) {
            return Err(ScoringError::UnknownSlot(slot_id.clone()));
        }
        if !piece_ids.contains(piece_id.as_str()) {
            return Err(ScoringError::UnknownPiece(piece_id.clone()));
        }
    }

    let mut submitted_edges: HashSet<(String, String)> = HashSet::new();
    for (from, to) in edges {
        if from == to || from.is_empty() || to.is_empty() {
            return Err(ScoringError::InvalidEdge);
        }
        if !node_ids.contains(from.as_str()) {
            return Err(ScoringError::UnknownPiece(from.clone()));
        }
        if !node_ids.contains(to.as_str()) {
            return Err(ScoringError::UnknownPiece(to.clone()));
        }
        submitted_edges.insert((from.clone(), to.clone()));
    }

    let CanonicalAnswer::Reconstruction {
        placements: canonical_placements,
        edges: canonical_edges,
    } = &question.canonical_answer
    else {
        return Err(ScoringError::InteractionMismatch);
    };

    let required_pieces: HashSet<&str> =
        canonical_placements.values().map(String::as_str).collect();
    let placed: HashSet<&str> = placements.values().map(String::as_str).collect();

    let mut correct_slots = 0_usize;
    let mut unfilled = false;
    let mut wrong_position = false;
    let mut wrong_component = false;
    let linear = layout == crate::model::ReconstructionLayout::Linear;

    if linear {
        // Slot order is the structure, so each slot must hold its exact piece.
        for slot in slots {
            match placements.get(&slot.id) {
                None => unfilled = true,
                Some(piece) if canonical_placements.get(&slot.id) == Some(piece) => {
                    correct_slots += 1;
                }
                Some(piece) if required_pieces.contains(piece.as_str()) => wrong_position = true,
                Some(_) => wrong_component = true,
            }
        }
    } else {
        // In a graph, authored slot positions are only a display scaffold: the
        // topology is defined by relationships. A required piece therefore
        // counts wherever it was placed, so swapping two pieces between slots
        // is not penalized when the relationships are unchanged.
        correct_slots = required_pieces
            .iter()
            .filter(|piece| placed.contains(*piece))
            .count();
        for piece in &placed {
            if !required_pieces.contains(piece) {
                wrong_component = true;
            }
        }
        unfilled = slots.iter().any(|slot| placements.get(&slot.id).is_none());
    }

    let missing_components = required_pieces
        .iter()
        .filter(|piece| !placed.contains(**piece))
        .count();

    let denominator = canonical_placements.len().max(1);
    let placement_score = correct_slots as f64 / denominator as f64;

    let canonical_edge_set: HashSet<(String, String)> = canonical_edges
        .iter()
        .filter(|edge| edge.len() == 2)
        .map(|edge| (edge[0].clone(), edge[1].clone()))
        .collect();

    // Linear scaffolds encode relationships in slot order, so explicit edges
    // are only scored for graph layouts that actually author topology.
    let use_edges = !linear && !canonical_edge_set.is_empty();

    let hits_edges = submitted_edges.intersection(&canonical_edge_set).count();
    let invalid_edges = submitted_edges.difference(&canonical_edge_set).count();
    let missing_edges = canonical_edge_set.len() - hits_edges;
    let edge_score = ((hits_edges as f64 - invalid_edges as f64)
        / canonical_edge_set.len().max(1) as f64)
        .clamp(0.0, 1.0);

    let score = if use_edges {
        (GRAPH_PLACEMENT_WEIGHT * placement_score + GRAPH_EDGE_WEIGHT * edge_score).clamp(0.0, 1.0)
    } else {
        placement_score
    };

    let mut error_codes = Vec::new();
    if unfilled {
        error_codes.push("reconstruction_unfilled_slot".to_owned());
    }
    if wrong_position {
        error_codes.push("reconstruction_wrong_position".to_owned());
    }
    if wrong_component {
        error_codes.push("reconstruction_wrong_component".to_owned());
    }
    if missing_components > 0 {
        error_codes.push("reconstruction_missing_component".to_owned());
    }
    if use_edges {
        if missing_edges > 0 {
            error_codes.push("reconstruction_missing_relationship".to_owned());
        }
        if invalid_edges > 0 {
            error_codes.push("reconstruction_invalid_relationship".to_owned());
        }
    }

    // "Correct" means every required piece is present in the right structure
    // and, for graph layouts with authored topology, every required edge exists.
    let placements_perfect = if linear {
        correct_slots == slots.len() && missing_components == 0
    } else {
        correct_slots == required_pieces.len() && missing_components == 0 && !wrong_component
    };
    let topology_perfect = !use_edges || (missing_edges == 0 && invalid_edges == 0);
    let correct = placements_perfect && topology_perfect;

    Ok(ScoredAnswer {
        correct,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

fn score_evidence_selection(
    question: &Question,
    evidence: &[crate::model::Choice],
    selected: &[String],
) -> Result<ScoredAnswer, ScoringError> {
    let available: HashSet<&str> = evidence.iter().map(|c| c.id.as_str()).collect();
    for id in selected {
        if !available.contains(id.as_str()) {
            return Err(ScoringError::UnknownEvidence(id.clone()));
        }
    }

    let CanonicalAnswer::EvidenceSelection { relevant_ids } = &question.canonical_answer else {
        return Err(ScoringError::InteractionMismatch);
    };

    let outcome = evaluate_selection(relevant_ids, selected);
    let score = ((outcome.hits as f64 - outcome.false_positives as f64)
        / relevant_ids.len().max(1) as f64)
        .clamp(0.0, 1.0);

    let mut error_codes = Vec::new();
    if outcome.missed > 0 {
        error_codes.push("evidence_missing_relevant".to_owned());
    }
    if outcome.false_positives > 0 {
        error_codes.push("evidence_selected_irrelevant".to_owned());
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

fn score_spot_the_fault(
    question: &Question,
    elements: &[crate::model::Choice],
    selected: &[String],
) -> Result<ScoredAnswer, ScoringError> {
    let available: HashSet<&str> = elements.iter().map(|c| c.id.as_str()).collect();
    for id in selected {
        if !available.contains(id.as_str()) {
            return Err(ScoringError::UnknownElement(id.clone()));
        }
    }

    let CanonicalAnswer::SpotTheFault { faulty_ids } = &question.canonical_answer else {
        return Err(ScoringError::InteractionMismatch);
    };

    let outcome = evaluate_selection(faulty_ids, selected);
    let score = ((outcome.hits as f64 - outcome.false_positives as f64)
        / faulty_ids.len().max(1) as f64)
        .clamp(0.0, 1.0);

    let mut error_codes = Vec::new();
    if outcome.missed > 0 {
        error_codes.push("fault_missed".to_owned());
    }
    if outcome.false_positives > 0 {
        error_codes.push("fault_false_positive".to_owned());
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

fn score_fill_slots(
    question: &Question,
    slots: &[crate::model::FillSlot],
    options: &[crate::model::Choice],
    values: &BTreeMap<String, String>,
) -> Result<ScoredAnswer, ScoringError> {
    let slot_ids: HashSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
    let option_ids: HashSet<&str> = options.iter().map(|option| option.id.as_str()).collect();

    for (slot_id, option_id) in values {
        if !slot_ids.contains(slot_id.as_str()) {
            return Err(ScoringError::UnknownSlot(slot_id.clone()));
        }
        if !option_ids.contains(option_id.as_str()) {
            return Err(ScoringError::UnknownOption(option_id.clone()));
        }
    }

    let CanonicalAnswer::FillSlots { values: canonical } = &question.canonical_answer else {
        return Err(ScoringError::InteractionMismatch);
    };

    let mut correct_count = 0_usize;
    let mut incorrect = false;
    let mut unfilled = false;

    for slot in slots {
        match values.get(&slot.id) {
            None => unfilled = true,
            Some(option) if canonical.get(&slot.id) == Some(option) => correct_count += 1,
            Some(_) => incorrect = true,
        }
    }

    let score = if slots.is_empty() {
        0.0
    } else {
        correct_count as f64 / slots.len() as f64
    };

    let mut error_codes = Vec::new();
    if incorrect {
        error_codes.push("slot_incorrect".to_owned());
    }
    if unfilled {
        error_codes.push("slot_unfilled".to_owned());
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

fn score_branching(
    question: &Question,
    start_step_id: &str,
    steps: &[crate::model::ScenarioStep],
    path: &[String],
    prefix: &str,
) -> Result<ScoredAnswer, ScoringError> {
    use crate::model::ScenarioStage;

    let step_by_id: HashSet<&str> = steps.iter().map(|step| step.id.as_str()).collect();
    if !step_by_id.contains(start_step_id) {
        return Err(ScoringError::InvalidScenarioPath);
    }

    let (correct_choice_ids, expected_path) = match &question.canonical_answer {
        CanonicalAnswer::Troubleshooting {
            correct_choice_ids,
            expected_path,
        }
        | CanonicalAnswer::ScenarioChoiceChain {
            correct_choice_ids,
            expected_path,
        } => (correct_choice_ids, expected_path),
        _ => return Err(ScoringError::InteractionMismatch),
    };

    let mut decisions: Vec<(ScenarioStage, bool)> = Vec::with_capacity(path.len());
    let mut current = start_step_id;

    for (index, choice_id) in path.iter().enumerate() {
        let Some(step) = steps.iter().find(|step| step.id == current) else {
            return Err(ScoringError::InvalidScenarioPath);
        };
        if !step.choices.iter().any(|choice| &choice.id == choice_id) {
            return Err(ScoringError::InvalidScenarioPath);
        }

        let correct = correct_choice_ids
            .get(step.id.as_str())
            .is_some_and(|ids| ids.iter().any(|id| id == choice_id));
        decisions.push((step.stage, correct));

        match step.next_step_by_choice.get(choice_id) {
            Some(next) => current = next.as_str(),
            None if index + 1 == path.len() => {}
            None => return Err(ScoringError::InvalidScenarioPath),
        }
    }

    let hits = decisions.iter().filter(|(_, correct)| *correct).count();
    let wrong = decisions.len() - hits;
    let denominator = expected_path.len().max(1);
    let score = ((hits as f64 - wrong as f64) / denominator as f64).clamp(0.0, 1.0);

    let mut error_codes: Vec<String> = Vec::new();
    let mut push = |code: String| {
        if !error_codes.contains(&code) {
            error_codes.push(code);
        }
    };
    for (stage, correct) in &decisions {
        if *correct {
            continue;
        }
        let suffix = match stage {
            ScenarioStage::Diagnosis => "wrong_diagnosis",
            ScenarioStage::Action => "wrong_next_action",
            ScenarioStage::Remediation => "wrong_remediation",
            ScenarioStage::Verification => "wrong_verification",
        };
        push(format!("{prefix}_{suffix}"));
    }
    if path.len() < expected_path.len() {
        push(format!("{prefix}_incomplete_path"));
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

fn score_configuration(
    question: &Question,
    slots: &[crate::model::ConfigSlot],
    pieces: &[crate::model::Choice],
    assignments: &BTreeMap<String, String>,
) -> Result<ScoredAnswer, ScoringError> {
    let slot_ids: HashSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
    let piece_ids: HashSet<&str> = pieces.iter().map(|piece| piece.id.as_str()).collect();

    for (slot_id, piece_id) in assignments {
        if !slot_ids.contains(slot_id.as_str()) {
            return Err(ScoringError::UnknownSlot(slot_id.clone()));
        }
        if !piece_ids.contains(piece_id.as_str()) {
            return Err(ScoringError::UnknownPiece(piece_id.clone()));
        }
    }

    let CanonicalAnswer::ConfigurationBuilder {
        assignments: canonical,
    } = &question.canonical_answer
    else {
        return Err(ScoringError::InteractionMismatch);
    };

    let required: HashSet<&str> = canonical.values().map(String::as_str).collect();
    let mut correct = 0_usize;
    let mut missing = false;
    let mut wrong_assignment = false;
    let mut unnecessary = false;

    for (slot_id, expected_piece) in canonical {
        match assignments.get(slot_id) {
            None => missing = true,
            Some(piece) if piece == expected_piece => correct += 1,
            Some(piece) if required.contains(piece.as_str()) => wrong_assignment = true,
            Some(_) => unnecessary = true,
        }
    }

    let denominator = canonical.len().max(1);
    let penalty = usize::from(unnecessary);
    let score = ((correct as f64 - penalty as f64) / denominator as f64).clamp(0.0, 1.0);

    let mut error_codes = Vec::new();
    if missing {
        error_codes.push("config_missing_required".to_owned());
    }
    if wrong_assignment {
        error_codes.push("config_wrong_assignment".to_owned());
    }
    if unnecessary {
        error_codes.push("config_unnecessary_component".to_owned());
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

fn score_placement(
    question: &Question,
    items: &[crate::model::Choice],
    points: &BTreeMap<String, crate::model::PlacementPoint>,
) -> Result<ScoredAnswer, ScoringError> {
    let item_ids: HashSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
    for (item_id, point) in points {
        if !item_ids.contains(item_id.as_str()) {
            return Err(ScoringError::UnknownItem(item_id.clone()));
        }
        if !(0.0..=1.0).contains(&point.x) || !(0.0..=1.0).contains(&point.y) {
            return Err(ScoringError::InvalidPlacement);
        }
    }

    let CanonicalAnswer::TwoDimensionalPlacement { regions } = &question.canonical_answer else {
        return Err(ScoringError::InteractionMismatch);
    };

    let mut correct_axes = 0_usize;
    let mut wrong_x = false;
    let mut wrong_y = false;
    let mut missing = false;

    for item in items {
        let Some(point) = points.get(&item.id) else {
            missing = true;
            continue;
        };
        let Some(region) = regions.get(&item.id) else {
            return Err(ScoringError::InteractionMismatch);
        };
        let x_ok = region.x.len() == 2 && point.x >= region.x[0] && point.x <= region.x[1];
        let y_ok = region.y.len() == 2 && point.y >= region.y[0] && point.y <= region.y[1];
        if x_ok {
            correct_axes += 1;
        } else {
            wrong_x = true;
        }
        if y_ok {
            correct_axes += 1;
        } else {
            wrong_y = true;
        }
    }

    let total_axes = items.len() * 2;
    let score = if total_axes == 0 {
        0.0
    } else {
        correct_axes as f64 / total_axes as f64
    };

    let mut error_codes = Vec::new();
    if missing {
        error_codes.push("placement_missing".to_owned());
    }
    if wrong_x {
        error_codes.push("placement_wrong_x".to_owned());
    }
    if wrong_y {
        error_codes.push("placement_wrong_y".to_owned());
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

fn score_command_assembly(
    question: &Question,
    slots: &[crate::model::FillSlot],
    tokens: &[crate::model::Choice],
    values: &BTreeMap<String, String>,
) -> Result<ScoredAnswer, ScoringError> {
    let slot_ids: HashSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
    let token_ids: HashSet<&str> = tokens.iter().map(|token| token.id.as_str()).collect();

    for (slot_id, token_id) in values {
        if !slot_ids.contains(slot_id.as_str()) {
            return Err(ScoringError::UnknownSlot(slot_id.clone()));
        }
        if !token_ids.contains(token_id.as_str()) {
            return Err(ScoringError::UnknownToken(token_id.clone()));
        }
    }

    let CanonicalAnswer::CommandAssembly { values: canonical } = &question.canonical_answer else {
        return Err(ScoringError::InteractionMismatch);
    };

    let required: HashSet<&str> = canonical.values().map(String::as_str).collect();
    let mut correct = 0_usize;
    let mut missing = false;
    let mut order_wrong = false;
    let mut token_wrong = false;

    for slot in slots {
        match values.get(&slot.id) {
            None => missing = true,
            Some(token) if canonical.get(&slot.id) == Some(token) => correct += 1,
            Some(token) if required.contains(token.as_str()) => order_wrong = true,
            Some(_) => token_wrong = true,
        }
    }

    let score = if slots.is_empty() {
        0.0
    } else {
        correct as f64 / slots.len() as f64
    };

    let mut error_codes = Vec::new();
    if missing {
        error_codes.push("command_token_missing".to_owned());
    }
    if order_wrong {
        error_codes.push("command_order_wrong".to_owned());
    }
    if token_wrong {
        error_codes.push("command_token_wrong".to_owned());
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

/// Normalizes a typed answer for deterministic comparison.
///
/// Steps: collapse all whitespace runs (which also trims), strip harmless
/// trailing punctuation, then lowercase with Unicode-aware case folding.
///
/// This is intentionally not fuzzy. `SQS` and `SNS`, or `ALB` and `NLB`, stay
/// distinct because correctness requires an exact normalized match.
pub fn normalize_typed_answer(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(['.', ',', ';', ':', '!', '?'])
        .trim_end()
        .to_lowercase()
}

fn score_typed_fill_blank(
    question: &Question,
    slots: &[crate::model::TypedBlankSlot],
    values: &BTreeMap<String, String>,
) -> Result<ScoredAnswer, ScoringError> {
    let slot_ids: HashSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();

    for slot_id in values.keys() {
        if !slot_ids.contains(slot_id.as_str()) {
            return Err(ScoringError::UnknownSlot(slot_id.clone()));
        }
    }

    let CanonicalAnswer::TypedFillBlank { answers } = &question.canonical_answer else {
        return Err(ScoringError::InteractionMismatch);
    };

    let mut correct_count = 0_usize;
    let mut incorrect = false;
    let mut incomplete = false;

    for slot in slots {
        let normalized = values
            .get(&slot.id)
            .map(|raw| normalize_typed_answer(raw))
            .unwrap_or_default();

        if normalized.is_empty() {
            incomplete = true;
            continue;
        }

        let Some(answer) = answers.get(&slot.id) else {
            return Err(ScoringError::InteractionMismatch);
        };

        if answer
            .accepted_answers
            .iter()
            .any(|accepted| normalize_typed_answer(accepted) == normalized)
        {
            correct_count += 1;
        } else {
            incorrect = true;
        }
    }

    let score = if slots.is_empty() {
        0.0
    } else {
        correct_count as f64 / slots.len() as f64
    };

    let mut error_codes = Vec::new();
    if incorrect {
        error_codes.push("typed_fill_blank_incorrect".to_owned());
    }
    if incomplete {
        error_codes.push("typed_fill_blank_incomplete".to_owned());
    }

    Ok(ScoredAnswer {
        correct: score >= 1.0,
        score,
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

/// Scores a single-selection answer.
///
/// The submitted choice must be an authored choice; scoring compares stable
/// choice ids, never display order or label text.
fn score_multiple_choice(
    question: &Question,
    choices: &[crate::model::Choice],
    choice_id: &str,
) -> Result<ScoredAnswer, ScoringError> {
    let available: HashSet<&str> = choices.iter().map(|choice| choice.id.as_str()).collect();
    if !available.contains(choice_id) {
        return Err(ScoringError::UnknownChoice(choice_id.to_owned()));
    }

    let CanonicalAnswer::MultipleChoice {
        choice_id: canonical_choice,
    } = &question.canonical_answer
    else {
        return Err(ScoringError::InteractionMismatch);
    };

    let correct = choice_id == canonical_choice;
    let error_codes = if correct {
        Vec::new()
    } else {
        vec!["multiple_choice_incorrect".to_owned()]
    };

    Ok(ScoredAnswer {
        correct,
        score: if correct { 1.0 } else { 0.0 },
        error_codes,
        canonical: question.canonical_answer.clone(),
    })
}

/// Scores a multiple-response answer as an exact set.
///
/// There is no partial credit: the submitted set must equal the canonical set.
/// Ordering is irrelevant, duplicate submissions are rejected, and every
/// submitted id must be an authored choice.
fn score_multiple_response(
    question: &Question,
    choices: &[crate::model::Choice],
    choice_ids: &[String],
) -> Result<ScoredAnswer, ScoringError> {
    let available: HashSet<&str> = choices.iter().map(|choice| choice.id.as_str()).collect();
    for choice_id in choice_ids {
        if !available.contains(choice_id.as_str()) {
            return Err(ScoringError::UnknownChoice(choice_id.clone()));
        }
    }

    let mut submitted: HashSet<&str> = HashSet::with_capacity(choice_ids.len());
    for choice_id in choice_ids {
        if !submitted.insert(choice_id.as_str()) {
            return Err(ScoringError::DuplicateChoice(choice_id.clone()));
        }
    }

    let CanonicalAnswer::MultipleResponse {
        choice_ids: canonical_ids,
    } = &question.canonical_answer
    else {
        return Err(ScoringError::InteractionMismatch);
    };

    let canonical: HashSet<&str> = canonical_ids.iter().map(String::as_str).collect();
    let correct = submitted == canonical;

    let mut error_codes = Vec::new();
    if !correct {
        if submitted.len() < canonical.len() {
            error_codes.push("multiple_response_incomplete".to_owned());
        }
        if submitted.len() > canonical.len() {
            error_codes.push("multiple_response_extra".to_owned());
        }
        if submitted.len() == canonical.len() {
            error_codes.push("multiple_response_incorrect".to_owned());
        }
    }

    Ok(ScoredAnswer {
        correct,
        score: if correct { 1.0 } else { 0.0 },
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
            pedagogy: None,
            prompt: "prompt".to_owned(),
            instruction: None,
            interaction,
            canonical_answer: canonical,
            concepts: Vec::new(),
            explanation: "because".to_owned(),
            choice_feedback: BTreeMap::new(),
            blueprint_skill_ids: Vec::new(),
            difficulty_label: None,
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

    fn choice(id: &str) -> Choice {
        Choice {
            id: id.to_owned(),
            label: id.to_owned(),
        }
    }

    fn reconstruction_slot(id: &str) -> crate::model::ReconstructionSlot {
        crate::model::ReconstructionSlot {
            id: id.to_owned(),
            x: None,
            y: None,
        }
    }

    fn linear_reconstruction_question() -> Question {
        question(
            Interaction::Reconstruction {
                layout: crate::model::ReconstructionLayout::Linear,
                fixed_nodes: vec![crate::model::FixedNode {
                    id: "metric".to_owned(),
                    label: "Metric crosses threshold".to_owned(),
                    position: crate::model::FixedNodePosition::Start,
                    x: None,
                    y: None,
                }],
                pieces: vec![
                    choice("alarm"),
                    choice("sns"),
                    choice("operator"),
                    choice("cloudtrail"),
                ],
                slots: vec![
                    reconstruction_slot("slot_1"),
                    reconstruction_slot("slot_2"),
                    reconstruction_slot("slot_3"),
                ],
            },
            CanonicalAnswer::Reconstruction {
                placements: BTreeMap::from([
                    ("slot_1".to_owned(), "alarm".to_owned()),
                    ("slot_2".to_owned(), "sns".to_owned()),
                    ("slot_3".to_owned(), "operator".to_owned()),
                ]),
                edges: Vec::new(),
            },
        )
    }

    #[test]
    fn reconstruction_scores_slot_placements() {
        let q = linear_reconstruction_question();

        let perfect = score(
            &q,
            &SubmittedAnswer::Reconstruction {
                placements: BTreeMap::from([
                    ("slot_1".to_owned(), "alarm".to_owned()),
                    ("slot_2".to_owned(), "sns".to_owned()),
                    ("slot_3".to_owned(), "operator".to_owned()),
                ]),
                edges: Vec::new(),
            },
        )
        .expect("score");
        assert!(perfect.correct);
        assert_eq!(perfect.score, 1.0);
        assert!(perfect.error_codes.is_empty());
    }

    #[test]
    fn reconstruction_distinguishes_wrong_position_and_wrong_component() {
        let q = linear_reconstruction_question();

        // `operator` and `sns` are swapped: both required, both in the wrong slot.
        let swapped = score(
            &q,
            &SubmittedAnswer::Reconstruction {
                placements: BTreeMap::from([
                    ("slot_1".to_owned(), "alarm".to_owned()),
                    ("slot_2".to_owned(), "operator".to_owned()),
                    ("slot_3".to_owned(), "sns".to_owned()),
                ]),
                edges: Vec::new(),
            },
        )
        .expect("score");
        assert_eq!(swapped.score, 1.0 / 3.0);
        assert!(!swapped.correct);
        assert!(
            swapped
                .error_codes
                .contains(&"reconstruction_wrong_position".to_owned())
        );

        // A distractor in a slot is a wrong component and lowers the score.
        let distractor = score(
            &q,
            &SubmittedAnswer::Reconstruction {
                placements: BTreeMap::from([
                    ("slot_1".to_owned(), "alarm".to_owned()),
                    ("slot_2".to_owned(), "cloudtrail".to_owned()),
                    ("slot_3".to_owned(), "operator".to_owned()),
                ]),
                edges: Vec::new(),
            },
        )
        .expect("score");
        assert_eq!(distractor.score, 2.0 / 3.0);
        assert!(
            distractor
                .error_codes
                .contains(&"reconstruction_wrong_component".to_owned())
        );
    }

    #[test]
    fn reconstruction_reports_incomplete_and_duplicate_slots() {
        let q = linear_reconstruction_question();

        let partial = score(
            &q,
            &SubmittedAnswer::Reconstruction {
                placements: BTreeMap::from([
                    ("slot_1".to_owned(), "alarm".to_owned()),
                    ("slot_2".to_owned(), "sns".to_owned()),
                ]),
                edges: Vec::new(),
            },
        )
        .expect("score");
        assert_eq!(partial.score, 2.0 / 3.0);
        assert!(
            partial
                .error_codes
                .contains(&"reconstruction_unfilled_slot".to_owned())
        );
        assert!(
            partial
                .error_codes
                .contains(&"reconstruction_missing_component".to_owned())
        );

        // The same required piece twice leaves another piece missing.
        let duplicate = score(
            &q,
            &SubmittedAnswer::Reconstruction {
                placements: BTreeMap::from([
                    ("slot_1".to_owned(), "alarm".to_owned()),
                    ("slot_2".to_owned(), "alarm".to_owned()),
                    ("slot_3".to_owned(), "operator".to_owned()),
                ]),
                edges: Vec::new(),
            },
        )
        .expect("score");
        assert_eq!(duplicate.score, 2.0 / 3.0);
        assert!(
            duplicate
                .error_codes
                .contains(&"reconstruction_missing_component".to_owned())
        );
        assert!(
            duplicate
                .error_codes
                .contains(&"reconstruction_wrong_position".to_owned())
        );
    }

    #[test]
    fn reconstruction_rejects_unknown_slots_and_pieces() {
        let q = linear_reconstruction_question();

        assert_eq!(
            score(
                &q,
                &SubmittedAnswer::Reconstruction {
                    placements: BTreeMap::from([("ghost_slot".to_owned(), "alarm".to_owned())]),
                    edges: Vec::new(),
                },
            ),
            Err(ScoringError::UnknownSlot("ghost_slot".to_owned()))
        );

        assert_eq!(
            score(
                &q,
                &SubmittedAnswer::Reconstruction {
                    placements: BTreeMap::from([("slot_1".to_owned(), "ghost".to_owned())]),
                    edges: Vec::new(),
                },
            ),
            Err(ScoringError::UnknownPiece("ghost".to_owned()))
        );
    }

    fn graph_reconstruction_question() -> Question {
        question(
            Interaction::Reconstruction {
                layout: crate::model::ReconstructionLayout::Graph,
                fixed_nodes: vec![crate::model::FixedNode {
                    id: "alarm".to_owned(),
                    label: "CloudWatch alarm".to_owned(),
                    position: crate::model::FixedNodePosition::Start,
                    x: Some(0.5),
                    y: Some(0.15),
                }],
                pieces: vec![choice("sns"), choice("operator"), choice("eventbridge")],
                slots: vec![
                    crate::model::ReconstructionSlot {
                        id: "sns_slot".to_owned(),
                        x: Some(0.25),
                        y: Some(0.3),
                    },
                    crate::model::ReconstructionSlot {
                        id: "operator_slot".to_owned(),
                        x: Some(0.25),
                        y: Some(0.8),
                    },
                    crate::model::ReconstructionSlot {
                        id: "eventbridge_slot".to_owned(),
                        x: Some(0.75),
                        y: Some(0.3),
                    },
                ],
            },
            CanonicalAnswer::Reconstruction {
                placements: BTreeMap::from([
                    ("sns_slot".to_owned(), "sns".to_owned()),
                    ("operator_slot".to_owned(), "operator".to_owned()),
                    ("eventbridge_slot".to_owned(), "eventbridge".to_owned()),
                ]),
                edges: vec![
                    vec!["alarm".to_owned(), "sns".to_owned()],
                    vec!["sns".to_owned(), "operator".to_owned()],
                    vec!["alarm".to_owned(), "eventbridge".to_owned()],
                ],
            },
        )
    }

    #[test]
    fn graph_reconstruction_weights_placements_and_topology() {
        let q = graph_reconstruction_question();

        let placements = BTreeMap::from([
            ("sns_slot".to_owned(), "sns".to_owned()),
            ("operator_slot".to_owned(), "operator".to_owned()),
            ("eventbridge_slot".to_owned(), "eventbridge".to_owned()),
        ]);

        let perfect = score(
            &q,
            &SubmittedAnswer::Reconstruction {
                placements: placements.clone(),
                edges: vec![
                    ("alarm".to_owned(), "sns".to_owned()),
                    ("sns".to_owned(), "operator".to_owned()),
                    ("alarm".to_owned(), "eventbridge".to_owned()),
                ],
            },
        )
        .expect("score");
        assert!(perfect.correct);
        assert!((perfect.score - 1.0).abs() < 1e-9);

        // Correct placements with no edges lose only the topology weight.
        let placements_only = score(
            &q,
            &SubmittedAnswer::Reconstruction {
                placements,
                edges: Vec::new(),
            },
        )
        .expect("score");
        assert!(!placements_only.correct);
        assert!((placements_only.score - 0.7).abs() < 1e-9);
        assert!(
            placements_only
                .error_codes
                .contains(&"reconstruction_missing_relationship".to_owned())
        );

        // Slot identity is not meaningful in a graph: swapping two pieces
        // between slots is the same structure when the relationships match.
        let swapped = score(
            &q,
            &SubmittedAnswer::Reconstruction {
                placements: BTreeMap::from([
                    ("sns_slot".to_owned(), "sns".to_owned()),
                    ("operator_slot".to_owned(), "eventbridge".to_owned()),
                    ("eventbridge_slot".to_owned(), "operator".to_owned()),
                ]),
                edges: vec![
                    ("alarm".to_owned(), "sns".to_owned()),
                    ("sns".to_owned(), "operator".to_owned()),
                    ("alarm".to_owned(), "eventbridge".to_owned()),
                ],
            },
        )
        .expect("score");
        assert!(swapped.correct);
        assert!((swapped.score - 1.0).abs() < 1e-9);
        assert!(swapped.error_codes.is_empty());
    }

    fn evidence_question() -> Question {
        question(
            Interaction::EvidenceSelection {
                evidence: vec![
                    choice("cpu"),
                    choice("cloudtrail"),
                    choice("flow_logs"),
                    choice("rds_pi"),
                ],
            },
            CanonicalAnswer::EvidenceSelection {
                relevant_ids: vec!["cloudtrail".to_owned(), "flow_logs".to_owned()],
            },
        )
    }

    #[test]
    fn evidence_selection_balances_precision_and_recall() {
        let q = evidence_question();

        let perfect = score(
            &q,
            &SubmittedAnswer::EvidenceSelection(vec![
                "cloudtrail".to_owned(),
                "flow_logs".to_owned(),
            ]),
        )
        .expect("score");
        assert!(perfect.correct);
        assert_eq!(perfect.score, 1.0);

        // One hit, one false positive: (1 - 1) / 2 = 0.
        let mixed = score(
            &q,
            &SubmittedAnswer::EvidenceSelection(vec!["cloudtrail".to_owned(), "cpu".to_owned()]),
        )
        .expect("score");
        assert_eq!(mixed.score, 0.0);
        assert!(
            mixed
                .error_codes
                .contains(&"evidence_selected_irrelevant".to_owned())
        );
        assert!(
            mixed
                .error_codes
                .contains(&"evidence_missing_relevant".to_owned())
        );

        // Selecting nothing earns nothing.
        let empty = score(&q, &SubmittedAnswer::EvidenceSelection(Vec::new())).expect("score");
        assert_eq!(empty.score, 0.0);
        assert_eq!(empty.error_codes, vec!["evidence_missing_relevant"]);

        let unknown = score(
            &q,
            &SubmittedAnswer::EvidenceSelection(vec!["ghost".to_owned()]),
        );
        assert_eq!(
            unknown,
            Err(ScoringError::UnknownEvidence("ghost".to_owned()))
        );
    }

    fn fault_question() -> Question {
        question(
            Interaction::SpotTheFault {
                elements: vec![
                    choice("route_destination"),
                    choice("route_target"),
                    choice("security_group"),
                ],
            },
            CanonicalAnswer::SpotTheFault {
                faulty_ids: vec!["route_target".to_owned()],
            },
        )
    }

    #[test]
    fn spot_the_fault_penalizes_false_positives() {
        let q = fault_question();

        let correct = score(
            &q,
            &SubmittedAnswer::SpotTheFault(vec!["route_target".to_owned()]),
        )
        .expect("score");
        assert!(correct.correct);

        let false_positive = score(
            &q,
            &SubmittedAnswer::SpotTheFault(vec![
                "route_target".to_owned(),
                "security_group".to_owned(),
            ]),
        )
        .expect("score");
        assert_eq!(false_positive.score, 0.0);
        assert_eq!(false_positive.error_codes, vec!["fault_false_positive"]);

        let missed = score(&q, &SubmittedAnswer::SpotTheFault(Vec::new())).expect("score");
        assert_eq!(missed.score, 0.0);
        assert_eq!(missed.error_codes, vec!["fault_missed"]);

        let unknown = score(&q, &SubmittedAnswer::SpotTheFault(vec!["ghost".to_owned()]));
        assert_eq!(
            unknown,
            Err(ScoringError::UnknownElement("ghost".to_owned()))
        );
    }

    fn fill_question() -> Question {
        question(
            Interaction::FillSlots {
                slots: vec![
                    crate::model::FillSlot {
                        id: "destination".to_owned(),
                        label: "Destination".to_owned(),
                    },
                    crate::model::FillSlot {
                        id: "target".to_owned(),
                        label: "Target".to_owned(),
                    },
                ],
                options: vec![choice("0.0.0.0/0"), choice("nat_gateway"), choice("igw")],
            },
            CanonicalAnswer::FillSlots {
                values: BTreeMap::from([
                    ("destination".to_owned(), "0.0.0.0/0".to_owned()),
                    ("target".to_owned(), "nat_gateway".to_owned()),
                ]),
            },
        )
    }

    #[test]
    fn fill_slots_scores_each_blank() {
        let q = fill_question();

        let all_correct = score(
            &q,
            &SubmittedAnswer::FillSlots(BTreeMap::from([
                ("destination".to_owned(), "0.0.0.0/0".to_owned()),
                ("target".to_owned(), "nat_gateway".to_owned()),
            ])),
        )
        .expect("score");
        assert!(all_correct.correct);

        let half = score(
            &q,
            &SubmittedAnswer::FillSlots(BTreeMap::from([
                ("destination".to_owned(), "0.0.0.0/0".to_owned()),
                ("target".to_owned(), "igw".to_owned()),
            ])),
        )
        .expect("score");
        assert_eq!(half.score, 0.5);
        assert_eq!(half.error_codes, vec!["slot_incorrect"]);

        let unfilled = score(
            &q,
            &SubmittedAnswer::FillSlots(BTreeMap::from([(
                "destination".to_owned(),
                "0.0.0.0/0".to_owned(),
            )])),
        )
        .expect("score");
        assert_eq!(unfilled.score, 0.5);
        assert_eq!(unfilled.error_codes, vec!["slot_unfilled"]);

        let unknown_slot = score(
            &q,
            &SubmittedAnswer::FillSlots(BTreeMap::from([("ghost".to_owned(), "igw".to_owned())])),
        );
        assert_eq!(
            unknown_slot,
            Err(ScoringError::UnknownSlot("ghost".to_owned()))
        );

        let unknown_option = score(
            &q,
            &SubmittedAnswer::FillSlots(BTreeMap::from([(
                "target".to_owned(),
                "ghost".to_owned(),
            )])),
        );
        assert_eq!(
            unknown_option,
            Err(ScoringError::UnknownOption("ghost".to_owned()))
        );
    }

    fn scenario_step(
        id: &str,
        stage: crate::model::ScenarioStage,
        choices: &[&str],
        transitions: &[(&str, &str)],
    ) -> crate::model::ScenarioStep {
        crate::model::ScenarioStep {
            id: id.to_owned(),
            prompt: id.to_owned(),
            stage,
            choices: choices.iter().map(|id| choice(id)).collect(),
            next_step_by_choice: transitions
                .iter()
                .map(|(choice_id, next)| ((*choice_id).to_owned(), (*next).to_owned()))
                .collect(),
        }
    }

    fn branching_question(interaction: Interaction, canonical: CanonicalAnswer) -> Question {
        question(interaction, canonical)
    }

    #[test]
    fn troubleshooting_scores_the_decision_path() {
        use crate::model::ScenarioStage;

        let steps = vec![
            scenario_step(
                "step-1",
                ScenarioStage::Diagnosis,
                &["diagnose_right", "diagnose_wrong"],
                &[("diagnose_right", "step-2"), ("diagnose_wrong", "step-2")],
            ),
            scenario_step(
                "step-2",
                ScenarioStage::Remediation,
                &["remediate_right", "remediate_wrong"],
                &[],
            ),
        ];

        let q = branching_question(
            Interaction::Troubleshooting {
                start_step_id: "step-1".to_owned(),
                steps,
            },
            CanonicalAnswer::Troubleshooting {
                correct_choice_ids: BTreeMap::from([
                    ("step-1".to_owned(), vec!["diagnose_right".to_owned()]),
                    ("step-2".to_owned(), vec!["remediate_right".to_owned()]),
                ]),
                expected_path: vec!["diagnose_right".to_owned(), "remediate_right".to_owned()],
            },
        );

        let perfect = score(
            &q,
            &SubmittedAnswer::Branching(vec![
                "diagnose_right".to_owned(),
                "remediate_right".to_owned(),
            ]),
        )
        .expect("score");
        assert!(perfect.correct);
        assert_eq!(perfect.score, 1.0);

        let partial = score(
            &q,
            &SubmittedAnswer::Branching(vec!["diagnose_right".to_owned()]),
        )
        .expect("score");
        assert_eq!(partial.score, 0.5);
        assert_eq!(partial.error_codes, vec!["troubleshooting_incomplete_path"]);

        let wrong = score(
            &q,
            &SubmittedAnswer::Branching(vec!["diagnose_wrong".to_owned()]),
        )
        .expect("score");
        assert_eq!(wrong.score, 0.0);
        assert!(
            wrong
                .error_codes
                .contains(&"troubleshooting_wrong_diagnosis".to_owned())
        );
        assert!(
            wrong
                .error_codes
                .contains(&"troubleshooting_incomplete_path".to_owned())
        );

        // A choice that is not in the start step cannot be scored.
        assert_eq!(
            score(
                &q,
                &SubmittedAnswer::Branching(vec!["remediate_right".to_owned()])
            ),
            Err(ScoringError::InvalidScenarioPath)
        );
    }

    #[test]
    fn scenario_choice_chain_uses_its_own_error_prefix() {
        use crate::model::ScenarioStage;

        let q = branching_question(
            Interaction::ScenarioChoiceChain {
                start_step_id: "s1".to_owned(),
                steps: vec![scenario_step(
                    "s1",
                    ScenarioStage::Action,
                    &["right", "wrong"],
                    &[],
                )],
            },
            CanonicalAnswer::ScenarioChoiceChain {
                correct_choice_ids: BTreeMap::from([("s1".to_owned(), vec!["right".to_owned()])]),
                expected_path: vec!["right".to_owned()],
            },
        );

        let scored =
            score(&q, &SubmittedAnswer::Branching(vec!["wrong".to_owned()])).expect("score");
        assert_eq!(
            scored.error_codes,
            vec!["scenario_choice_wrong_next_action"]
        );
    }

    fn configuration_question() -> Question {
        question(
            Interaction::ConfigurationBuilder {
                slots: vec![
                    crate::model::ConfigSlot {
                        id: "route_target".to_owned(),
                        label: "IPv4 default route target".to_owned(),
                    },
                    crate::model::ConfigSlot {
                        id: "subnet".to_owned(),
                        label: "Associated subnet".to_owned(),
                    },
                ],
                pieces: vec![choice("nat"), choice("igw"), choice("private")],
            },
            CanonicalAnswer::ConfigurationBuilder {
                assignments: BTreeMap::from([
                    ("route_target".to_owned(), "nat".to_owned()),
                    ("subnet".to_owned(), "private".to_owned()),
                ]),
            },
        )
    }

    #[test]
    fn configuration_builder_scores_assignments() {
        let q = configuration_question();

        let perfect = score(
            &q,
            &SubmittedAnswer::ConfigurationBuilder(BTreeMap::from([
                ("route_target".to_owned(), "nat".to_owned()),
                ("subnet".to_owned(), "private".to_owned()),
            ])),
        )
        .expect("score");
        assert!(perfect.correct);

        // Both required pieces are swapped into the wrong roles.
        let swapped = score(
            &q,
            &SubmittedAnswer::ConfigurationBuilder(BTreeMap::from([
                ("route_target".to_owned(), "private".to_owned()),
                ("subnet".to_owned(), "nat".to_owned()),
            ])),
        )
        .expect("score");
        assert_eq!(swapped.score, 0.0);
        assert!(
            swapped
                .error_codes
                .contains(&"config_wrong_assignment".to_owned())
        );

        // `igw` is not required anywhere: an unnecessary component.
        let unnecessary = score(
            &q,
            &SubmittedAnswer::ConfigurationBuilder(BTreeMap::from([
                ("route_target".to_owned(), "nat".to_owned()),
                ("subnet".to_owned(), "igw".to_owned()),
            ])),
        )
        .expect("score");
        assert_eq!(unnecessary.score, 0.0);
        assert!(
            unnecessary
                .error_codes
                .contains(&"config_unnecessary_component".to_owned())
        );

        let missing = score(
            &q,
            &SubmittedAnswer::ConfigurationBuilder(BTreeMap::from([(
                "route_target".to_owned(),
                "nat".to_owned(),
            )])),
        )
        .expect("score");
        assert_eq!(missing.score, 0.5);
        assert!(
            missing
                .error_codes
                .contains(&"config_missing_required".to_owned())
        );

        assert_eq!(
            score(
                &q,
                &SubmittedAnswer::ConfigurationBuilder(BTreeMap::from([(
                    "route_target".to_owned(),
                    "ghost".to_owned(),
                )])),
            ),
            Err(ScoringError::UnknownPiece("ghost".to_owned()))
        );
    }

    fn placement_question() -> Question {
        question(
            Interaction::TwoDimensionalPlacement {
                x_axis: crate::model::PlacementAxis {
                    id: "cost".to_owned(),
                    label: "Cost".to_owned(),
                    low_label: "Lower cost".to_owned(),
                    high_label: "Higher cost".to_owned(),
                },
                y_axis: crate::model::PlacementAxis {
                    id: "recovery".to_owned(),
                    label: "Recovery".to_owned(),
                    low_label: "Slower recovery".to_owned(),
                    high_label: "Faster recovery".to_owned(),
                },
                items: vec![choice("backup"), choice("multi_site")],
            },
            CanonicalAnswer::TwoDimensionalPlacement {
                regions: BTreeMap::from([
                    (
                        "backup".to_owned(),
                        crate::model::PlacementRegion {
                            x: vec![0.0, 0.3],
                            y: vec![0.0, 0.3],
                        },
                    ),
                    (
                        "multi_site".to_owned(),
                        crate::model::PlacementRegion {
                            x: vec![0.7, 1.0],
                            y: vec![0.7, 1.0],
                        },
                    ),
                ]),
            },
        )
    }

    #[test]
    fn two_dimensional_placement_scores_axes_tolerantly() {
        let point = |x: f64, y: f64| crate::model::PlacementPoint { x, y };
        let q = placement_question();

        let perfect = score(
            &q,
            &SubmittedAnswer::TwoDimensionalPlacement(BTreeMap::from([
                ("backup".to_owned(), point(0.1, 0.2)),
                ("multi_site".to_owned(), point(0.9, 0.85)),
            ])),
        )
        .expect("score");
        assert!(perfect.correct);
        assert_eq!(perfect.score, 1.0);

        // `backup` is right on cost but wrong on recovery: 3 of 4 axes.
        let partial = score(
            &q,
            &SubmittedAnswer::TwoDimensionalPlacement(BTreeMap::from([
                ("backup".to_owned(), point(0.1, 0.9)),
                ("multi_site".to_owned(), point(0.9, 0.85)),
            ])),
        )
        .expect("score");
        assert_eq!(partial.score, 0.75);
        assert!(
            partial
                .error_codes
                .contains(&"placement_wrong_y".to_owned())
        );

        let missing = score(
            &q,
            &SubmittedAnswer::TwoDimensionalPlacement(BTreeMap::from([(
                "backup".to_owned(),
                point(0.1, 0.2),
            )])),
        )
        .expect("score");
        assert_eq!(missing.score, 0.5);
        assert!(
            missing
                .error_codes
                .contains(&"placement_missing".to_owned())
        );

        assert_eq!(
            score(
                &q,
                &SubmittedAnswer::TwoDimensionalPlacement(BTreeMap::from([(
                    "backup".to_owned(),
                    point(1.5, 0.2),
                )])),
            ),
            Err(ScoringError::InvalidPlacement)
        );
    }

    fn command_question() -> Question {
        question(
            Interaction::CommandAssembly {
                slots: vec![
                    crate::model::FillSlot {
                        id: "command".to_owned(),
                        label: "Command".to_owned(),
                    },
                    crate::model::FillSlot {
                        id: "flag".to_owned(),
                        label: "Expiry flag".to_owned(),
                    },
                ],
                tokens: vec![choice("presign"), choice("--expires-in"), choice("delete")],
            },
            CanonicalAnswer::CommandAssembly {
                values: BTreeMap::from([
                    ("command".to_owned(), "presign".to_owned()),
                    ("flag".to_owned(), "--expires-in".to_owned()),
                ]),
            },
        )
    }

    #[test]
    fn command_assembly_scores_tokens_and_order() {
        let q = command_question();

        let perfect = score(
            &q,
            &SubmittedAnswer::CommandAssembly(BTreeMap::from([
                ("command".to_owned(), "presign".to_owned()),
                ("flag".to_owned(), "--expires-in".to_owned()),
            ])),
        )
        .expect("score");
        assert!(perfect.correct);

        let swapped = score(
            &q,
            &SubmittedAnswer::CommandAssembly(BTreeMap::from([
                ("command".to_owned(), "--expires-in".to_owned()),
                ("flag".to_owned(), "presign".to_owned()),
            ])),
        )
        .expect("score");
        assert_eq!(swapped.score, 0.0);
        assert!(
            swapped
                .error_codes
                .contains(&"command_order_wrong".to_owned())
        );

        let wrong_token = score(
            &q,
            &SubmittedAnswer::CommandAssembly(BTreeMap::from([
                ("command".to_owned(), "presign".to_owned()),
                ("flag".to_owned(), "delete".to_owned()),
            ])),
        )
        .expect("score");
        assert_eq!(wrong_token.score, 0.5);
        assert!(
            wrong_token
                .error_codes
                .contains(&"command_token_wrong".to_owned())
        );

        let missing = score(
            &q,
            &SubmittedAnswer::CommandAssembly(BTreeMap::from([(
                "command".to_owned(),
                "presign".to_owned(),
            )])),
        )
        .expect("score");
        assert!(
            missing
                .error_codes
                .contains(&"command_token_missing".to_owned())
        );

        assert_eq!(
            score(
                &q,
                &SubmittedAnswer::CommandAssembly(BTreeMap::from([(
                    "command".to_owned(),
                    "ghost".to_owned(),
                )])),
            ),
            Err(ScoringError::UnknownToken("ghost".to_owned()))
        );
    }

    fn typed_question() -> Question {
        question(
            Interaction::TypedFillBlank {
                content: crate::model::TypedFillContent::Text {
                    template: "Security groups are {{sg}} and NACLs are {{nacl}}.".to_owned(),
                },
                slots: vec![
                    crate::model::TypedBlankSlot {
                        id: "sg".to_owned(),
                        label: "Security group behavior".to_owned(),
                        placeholder: "Type...".to_owned(),
                        width_chars: None,
                        multiline: false,
                        rows: None,
                    },
                    crate::model::TypedBlankSlot {
                        id: "nacl".to_owned(),
                        label: "NACL behavior".to_owned(),
                        placeholder: String::new(),
                        width_chars: None,
                        multiline: false,
                        rows: None,
                    },
                ],
            },
            CanonicalAnswer::TypedFillBlank {
                answers: BTreeMap::from([
                    (
                        "sg".to_owned(),
                        crate::model::TypedBlankAnswer {
                            accepted_answers: vec!["stateful".to_owned()],
                        },
                    ),
                    (
                        "nacl".to_owned(),
                        crate::model::TypedBlankAnswer {
                            accepted_answers: vec!["stateless".to_owned()],
                        },
                    ),
                ]),
            },
        )
    }

    #[test]
    fn typed_normalization_is_whitespace_and_case_insensitive() {
        assert_eq!(normalize_typed_answer("  Deny "), "deny");
        assert_eq!(normalize_typed_answer("DENY"), "deny");
        assert_eq!(normalize_typed_answer("deny."), "deny");
        assert_eq!(normalize_typed_answer("deny?!"), "deny");
        assert_eq!(normalize_typed_answer("deny  ."), "deny");
        assert_eq!(
            normalize_typed_answer("amazon   simple queue service"),
            "amazon simple queue service"
        );
        assert_eq!(normalize_typed_answer("   "), "");
    }

    #[test]
    fn typed_normalization_keeps_similar_service_names_distinct() {
        assert_ne!(normalize_typed_answer("SQS"), normalize_typed_answer("SNS"));
        assert_ne!(normalize_typed_answer("ALB"), normalize_typed_answer("NLB"));
    }

    #[test]
    fn typed_fill_blank_grades_every_slot() {
        let q = typed_question();

        let perfect = score(
            &q,
            &SubmittedAnswer::TypedFillBlank(BTreeMap::from([
                ("sg".to_owned(), " Stateful ".to_owned()),
                ("nacl".to_owned(), "stateless.".to_owned()),
            ])),
        )
        .expect("score");
        assert!(perfect.correct);
        assert_eq!(perfect.score, 1.0);
        assert!(perfect.error_codes.is_empty());

        // One correct, one incorrect means the whole question is incorrect.
        let partial = score(
            &q,
            &SubmittedAnswer::TypedFillBlank(BTreeMap::from([
                ("sg".to_owned(), "stateful".to_owned()),
                ("nacl".to_owned(), "statefull".to_owned()),
            ])),
        )
        .expect("score");
        assert!(!partial.correct);
        assert_eq!(partial.score, 0.5);
        assert_eq!(partial.error_codes, vec!["typed_fill_blank_incorrect"]);

        // A missing blank is incomplete, not incorrect.
        let incomplete = score(
            &q,
            &SubmittedAnswer::TypedFillBlank(BTreeMap::from([(
                "sg".to_owned(),
                "stateful".to_owned(),
            )])),
        )
        .expect("score");
        assert_eq!(incomplete.score, 0.5);
        assert_eq!(incomplete.error_codes, vec!["typed_fill_blank_incomplete"]);

        // An empty string is treated as incomplete.
        let blank = score(
            &q,
            &SubmittedAnswer::TypedFillBlank(BTreeMap::from([
                ("sg".to_owned(), "stateful".to_owned()),
                ("nacl".to_owned(), "   ".to_owned()),
            ])),
        )
        .expect("score");
        assert_eq!(blank.error_codes, vec!["typed_fill_blank_incomplete"]);
    }

    #[test]
    fn typed_fill_blank_accepts_authored_aliases_only() {
        let q = question(
            Interaction::TypedFillBlank {
                content: crate::model::TypedFillContent::Text {
                    template: "Amazon {{service}} is a queue.".to_owned(),
                },
                slots: vec![crate::model::TypedBlankSlot {
                    id: "service".to_owned(),
                    label: "Service".to_owned(),
                    placeholder: String::new(),
                    width_chars: None,
                    multiline: false,
                    rows: None,
                }],
            },
            CanonicalAnswer::TypedFillBlank {
                answers: BTreeMap::from([(
                    "service".to_owned(),
                    crate::model::TypedBlankAnswer {
                        accepted_answers: vec![
                            "SQS".to_owned(),
                            "Amazon SQS".to_owned(),
                            "Amazon Simple Queue Service".to_owned(),
                        ],
                    },
                )]),
            },
        );

        for accepted in ["sqs", "Amazon SQS", "amazon   simple queue service"] {
            let scored = score(
                &q,
                &SubmittedAnswer::TypedFillBlank(BTreeMap::from([(
                    "service".to_owned(),
                    accepted.to_owned(),
                )])),
            )
            .expect("score");
            assert!(scored.correct, "expected {accepted:?} to be accepted");
        }

        // A textually similar service is not an authored alias.
        let wrong = score(
            &q,
            &SubmittedAnswer::TypedFillBlank(BTreeMap::from([(
                "service".to_owned(),
                "SNS".to_owned(),
            )])),
        )
        .expect("score");
        assert!(!wrong.correct);
        assert_eq!(wrong.score, 0.0);
    }

    #[test]
    fn typed_fill_blank_rejects_unknown_slots() {
        let q = typed_question();
        assert_eq!(
            score(
                &q,
                &SubmittedAnswer::TypedFillBlank(BTreeMap::from([(
                    "ghost".to_owned(),
                    "value".to_owned(),
                )])),
            ),
            Err(ScoringError::UnknownSlot("ghost".to_owned()))
        );
    }

    fn choices(ids: &[&str]) -> Vec<Choice> {
        ids.iter()
            .map(|id| Choice {
                id: (*id).to_owned(),
                label: id.to_uppercase(),
            })
            .collect()
    }

    fn multiple_choice_question() -> Question {
        let mut q = question(
            Interaction::MultipleChoice {
                choices: choices(&["A", "B", "C", "D"]),
            },
            CanonicalAnswer::MultipleChoice {
                choice_id: "C".to_owned(),
            },
        );
        q.interaction_type = adaptive_learn_domain::InteractionType::MultipleChoice;
        q
    }

    fn multiple_response_question() -> Question {
        let mut q = question(
            Interaction::MultipleResponse {
                choices: choices(&["A", "B", "C", "D", "E"]),
                required_selections: 2,
            },
            CanonicalAnswer::MultipleResponse {
                choice_ids: vec!["B".to_owned(), "C".to_owned()],
            },
        );
        q.interaction_type = adaptive_learn_domain::InteractionType::MultipleResponse;
        q
    }

    #[test]
    fn multiple_choice_scores_correct_and_incorrect() {
        let q = multiple_choice_question();

        let correct = score(&q, &SubmittedAnswer::MultipleChoice("C".to_owned())).expect("score");
        assert!(correct.correct);
        assert_eq!(correct.score, 1.0);
        assert!(correct.error_codes.is_empty());

        let wrong = score(&q, &SubmittedAnswer::MultipleChoice("A".to_owned())).expect("score");
        assert!(!wrong.correct);
        assert_eq!(wrong.score, 0.0);
        assert_eq!(wrong.error_codes, vec!["multiple_choice_incorrect"]);
    }

    #[test]
    fn multiple_choice_rejects_unknown_choice() {
        let q = multiple_choice_question();
        assert_eq!(
            score(&q, &SubmittedAnswer::MultipleChoice("Z".to_owned())),
            Err(ScoringError::UnknownChoice("Z".to_owned()))
        );
    }

    #[test]
    fn multiple_response_requires_the_exact_set() {
        let q = multiple_response_question();

        let correct = score(
            &q,
            &SubmittedAnswer::MultipleResponse(vec!["B".to_owned(), "C".to_owned()]),
        )
        .expect("score");
        assert!(correct.correct);
        assert_eq!(correct.score, 1.0);
    }

    #[test]
    fn multiple_response_ignores_answer_order() {
        let q = multiple_response_question();
        let reversed = score(
            &q,
            &SubmittedAnswer::MultipleResponse(vec!["C".to_owned(), "B".to_owned()]),
        )
        .expect("score");
        assert!(reversed.correct);
        assert_eq!(reversed.score, 1.0);
    }

    #[test]
    fn multiple_response_missing_a_response_is_incorrect() {
        let q = multiple_response_question();
        let missing =
            score(&q, &SubmittedAnswer::MultipleResponse(vec!["B".to_owned()])).expect("score");
        assert!(!missing.correct);
        assert_eq!(missing.score, 0.0);
        assert_eq!(missing.error_codes, vec!["multiple_response_incomplete"]);

        let empty = score(&q, &SubmittedAnswer::MultipleResponse(Vec::new())).expect("score");
        assert!(!empty.correct);
        assert_eq!(empty.score, 0.0);
    }

    #[test]
    fn multiple_response_extra_response_is_incorrect() {
        let q = multiple_response_question();
        let extra = score(
            &q,
            &SubmittedAnswer::MultipleResponse(vec![
                "B".to_owned(),
                "C".to_owned(),
                "D".to_owned(),
            ]),
        )
        .expect("score");
        assert!(!extra.correct);
        assert_eq!(extra.score, 0.0);
        assert_eq!(extra.error_codes, vec!["multiple_response_extra"]);
    }

    #[test]
    fn multiple_response_substituting_a_response_is_incorrect() {
        let q = multiple_response_question();
        let swapped = score(
            &q,
            &SubmittedAnswer::MultipleResponse(vec!["B".to_owned(), "D".to_owned()]),
        )
        .expect("score");
        assert!(!swapped.correct);
        assert_eq!(swapped.score, 0.0);
        assert_eq!(swapped.error_codes, vec!["multiple_response_incorrect"]);
    }

    #[test]
    fn multiple_response_rejects_duplicates_and_unknown_choices() {
        let q = multiple_response_question();
        assert_eq!(
            score(
                &q,
                &SubmittedAnswer::MultipleResponse(vec!["B".to_owned(), "B".to_owned()]),
            ),
            Err(ScoringError::DuplicateChoice("B".to_owned()))
        );

        assert_eq!(
            score(
                &q,
                &SubmittedAnswer::MultipleResponse(vec!["B".to_owned(), "Z".to_owned()]),
            ),
            Err(ScoringError::UnknownChoice("Z".to_owned()))
        );
    }

    #[test]
    fn multiple_choice_rejects_a_mismatched_answer_shape() {
        let q = multiple_choice_question();
        assert_eq!(
            score(&q, &SubmittedAnswer::MultipleResponse(vec!["C".to_owned()])),
            Err(ScoringError::InteractionMismatch)
        );
    }
}
