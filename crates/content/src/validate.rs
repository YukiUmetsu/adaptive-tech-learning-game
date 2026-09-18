//! Structural and referential validation for content bundles.
//!
//! Validation is intentionally strict. Content errors are a build/test failure,
//! not a runtime surprise.

use std::collections::{BTreeSet, HashSet};

use adaptive_learn_domain::InteractionType;

use crate::model::{CanonicalAnswer, ContentBundle, Interaction, Question, QuestionConcept};

/// A single content validation failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentError {
    /// Stable machine-readable code.
    pub code: &'static str,
    /// Human-readable explanation.
    pub message: String,
}

impl ContentError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

const WEIGHT_TOLERANCE: f64 = 1e-6;

/// Validates a bundle, returning every problem found.
pub fn validate(bundle: &ContentBundle) -> Result<(), Vec<ContentError>> {
    let mut errors = Vec::new();

    validate_certification(bundle, &mut errors);
    validate_version(bundle, &mut errors);
    validate_domains(bundle, &mut errors);
    validate_concepts(bundle, &mut errors);
    validate_questions(bundle, &mut errors);

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn validate_certification(bundle: &ContentBundle, errors: &mut Vec<ContentError>) {
    let certification = &bundle.certification;

    for (field, value) in [
        ("id", &certification.id),
        ("vendor", &certification.vendor),
        ("name", &certification.name),
        ("exam_code", &certification.exam_code),
        ("official_source_url", &certification.official_source_url),
        ("last_reviewed", &certification.last_reviewed),
    ] {
        if value.trim().is_empty() {
            errors.push(ContentError::new(
                "certification_field_missing",
                format!("certification.{field} must not be empty"),
            ));
        }
    }
}

fn validate_version(bundle: &ContentBundle, errors: &mut Vec<ContentError>) {
    let version = &bundle.version;

    if version.id.trim().is_empty() {
        errors.push(ContentError::new(
            "certification_version_missing",
            "version.id must not be empty",
        ));
    }
    if version.exam_code.trim().is_empty() {
        errors.push(ContentError::new(
            "exam_code_missing",
            "version.exam_code must not be empty",
        ));
    } else if version.exam_code != bundle.certification.exam_code {
        errors.push(ContentError::new(
            "exam_code_mismatch",
            "version.exam_code must match certification.exam_code",
        ));
    }
    if version.content_version.trim().is_empty() {
        errors.push(ContentError::new(
            "content_version_missing",
            "version.content_version must not be empty",
        ));
    }
    if version.effective_date.trim().is_empty() {
        errors.push(ContentError::new(
            "effective_date_missing",
            "version.effective_date must not be empty",
        ));
    }
    if version.domains.is_empty() {
        errors.push(ContentError::new(
            "domains_missing",
            "version must define at least one domain",
        ));
    }
}

fn validate_domains(bundle: &ContentBundle, errors: &mut Vec<ContentError>) {
    let mut seen = HashSet::new();
    let mut weight_sum = 0.0;

    for domain in &bundle.version.domains {
        if domain.id.trim().is_empty() || domain.name.trim().is_empty() {
            errors.push(ContentError::new(
                "domain_field_missing",
                "domain id and name must not be empty",
            ));
        }
        if !seen.insert(domain.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_domain_id",
                format!("duplicate domain id {}", domain.id),
            ));
        }
        if !is_valid_weight(domain.weight) {
            errors.push(ContentError::new(
                "invalid_domain_weight",
                format!("domain {} weight must be within (0, 1]", domain.id),
            ));
        }
        weight_sum += domain.weight;
    }

    if !seen.is_empty() && (weight_sum - 1.0).abs() > WEIGHT_TOLERANCE {
        errors.push(ContentError::new(
            "domain_weights_do_not_sum",
            format!("domain weights must sum to 1.0, got {weight_sum}"),
        ));
    }
}

fn validate_concepts(bundle: &ContentBundle, errors: &mut Vec<ContentError>) {
    let mut seen = HashSet::new();

    for concept in &bundle.concepts {
        if concept.id.trim().is_empty()
            || concept.name.trim().is_empty()
            || concept.description.trim().is_empty()
        {
            errors.push(ContentError::new(
                "concept_field_missing",
                "concept id, name, and description must not be empty",
            ));
        }
        if !seen.insert(concept.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_concept_id",
                format!("duplicate concept id {}", concept.id),
            ));
        }
    }
}

fn validate_questions(bundle: &ContentBundle, errors: &mut Vec<ContentError>) {
    let concept_ids: HashSet<&str> = bundle.concepts.iter().map(|c| c.id.as_str()).collect();
    let question_ids: HashSet<&str> = bundle.questions.iter().map(|q| q.id.as_str()).collect();

    let mut seen_questions = HashSet::new();
    let mut seen_task_ids = HashSet::new();
    let mut tasks_by_question: HashSet<(String, String)> = HashSet::new();

    for domain in &bundle.version.domains {
        for task in &domain.tasks {
            if task.id.trim().is_empty() || task.name.trim().is_empty() {
                errors.push(ContentError::new(
                    "task_field_missing",
                    "task id and name must not be empty",
                ));
            }
            if !seen_task_ids.insert(task.id.as_str()) {
                errors.push(ContentError::new(
                    "duplicate_task_id",
                    format!("duplicate task id {}", task.id),
                ));
            }
            for question_id in &task.question_ids {
                if !question_ids.contains(question_id.as_str()) {
                    errors.push(ContentError::new(
                        "question_reference_missing",
                        format!(
                            "task {} references unknown question {}",
                            task.id, question_id
                        ),
                    ));
                }
                tasks_by_question.insert((domain.id.clone(), task.id.clone()));
            }
        }
    }

    for question in &bundle.questions {
        if !seen_questions.insert(question.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_question_id",
                format!("duplicate question id {}", question.id),
            ));
        }
        if question.id.trim().is_empty() || question.prompt.trim().is_empty() {
            errors.push(ContentError::new(
                "question_field_missing",
                "question id and prompt must not be empty",
            ));
        }
        if question.content_version != bundle.version.content_version {
            errors.push(ContentError::new(
                "content_version_mismatch",
                format!(
                    "question {} content_version {} does not match bundle {}",
                    question.id, question.content_version, bundle.version.content_version
                ),
            ));
        }
        if question.certification_version != bundle.version.id {
            errors.push(ContentError::new(
                "certification_version_mismatch",
                format!(
                    "question {} certification_version {} does not match bundle {}",
                    question.id, question.certification_version, bundle.version.id
                ),
            ));
        }
        if !tasks_by_question.contains(&(question.domain_id.clone(), question.task_id.clone())) {
            errors.push(ContentError::new(
                "question_task_mismatch",
                format!(
                    "question {} references unknown domain/task {}/{}",
                    question.id, question.domain_id, question.task_id
                ),
            ));
        }
        if !(0.0..=1.0).contains(&question.difficulty_prior) {
            errors.push(ContentError::new(
                "invalid_difficulty_prior",
                format!(
                    "question {} difficulty_prior must be within [0, 1]",
                    question.id
                ),
            ));
        }
        if !interaction_matches(question) {
            errors.push(ContentError::new(
                "interaction_type_mismatch",
                format!(
                    "question {} interaction_type does not match its interaction definition",
                    question.id
                ),
            ));
        }

        validate_question_concepts(question, &concept_ids, errors);
        validate_interaction(question, errors);
        validate_canonical_answer(question, errors);
        validate_error_codes(question, errors);
        validate_source_refs(question, errors);
    }
}

fn validate_question_concepts(
    question: &Question,
    concept_ids: &HashSet<&str>,
    errors: &mut Vec<ContentError>,
) {
    if question.concepts.is_empty() {
        errors.push(ContentError::new(
            "question_concepts_missing",
            format!("question {} must map at least one concept", question.id),
        ));
        return;
    }

    let mut seen = HashSet::new();
    let mut sum = 0.0;
    for QuestionConcept { concept_id, weight } in &question.concepts {
        if !concept_ids.contains(concept_id.as_str()) {
            errors.push(ContentError::new(
                "unknown_concept_id",
                format!(
                    "question {} references unknown concept {}",
                    question.id, concept_id
                ),
            ));
        }
        if !seen.insert(concept_id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_question_concept",
                format!(
                    "question {} maps concept {} more than once",
                    question.id, concept_id
                ),
            ));
        }
        if !is_valid_weight(*weight) {
            errors.push(ContentError::new(
                "invalid_concept_weight",
                format!(
                    "question {} concept {} weight must be within (0, 1]",
                    question.id, concept_id
                ),
            ));
        }
        sum += weight;
    }

    if (sum - 1.0).abs() > WEIGHT_TOLERANCE {
        errors.push(ContentError::new(
            "concept_weights_do_not_sum",
            format!(
                "question {} concept weights must sum to 1.0, got {sum}",
                question.id
            ),
        ));
    }
}

fn validate_interaction(question: &Question, errors: &mut Vec<ContentError>) {
    match &question.interaction {
        Interaction::Classification { items, categories } => {
            if items.is_empty() || categories.is_empty() {
                errors.push(ContentError::new(
                    "classification_incomplete",
                    format!("question {} needs items and categories", question.id),
                ));
            }
            ensure_unique_choice_ids(question, items, "classification item", errors);
            ensure_unique_choice_ids(question, categories, "classification category", errors);
        }
        Interaction::Ordering { items } => {
            if items.len() < 2 {
                errors.push(ContentError::new(
                    "ordering_incomplete",
                    format!("question {} needs at least two items", question.id),
                ));
            }
            ensure_unique_choice_ids(question, items, "ordering item", errors);
        }
        Interaction::NodeConnection { nodes } => {
            if nodes.len() < 2 {
                errors.push(ContentError::new(
                    "connection_incomplete",
                    format!("question {} needs at least two nodes", question.id),
                ));
            }
            let mut seen = HashSet::new();
            for node in nodes {
                if node.id.trim().is_empty() || node.label.trim().is_empty() {
                    errors.push(ContentError::new(
                        "node_field_missing",
                        format!(
                            "question {} has a node with an empty id or label",
                            question.id
                        ),
                    ));
                }
                if !(0.0..=1.0).contains(&node.x) || !(0.0..=1.0).contains(&node.y) {
                    errors.push(ContentError::new(
                        "invalid_node_position",
                        format!(
                            "question {} node {} position must be within [0, 1]",
                            question.id, node.id
                        ),
                    ));
                }
                if !seen.insert(node.id.as_str()) {
                    errors.push(ContentError::new(
                        "duplicate_node_id",
                        format!("question {} has duplicate node id {}", question.id, node.id),
                    ));
                }
            }
        }
    }
}

fn validate_canonical_answer(question: &Question, errors: &mut Vec<ContentError>) {
    match (&question.interaction, &question.canonical_answer) {
        (
            Interaction::Classification { items, categories },
            CanonicalAnswer::Classification { placements },
        ) => {
            let item_ids: BTreeSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
            let category_ids: BTreeSet<&str> = categories
                .iter()
                .map(|category| category.id.as_str())
                .collect();

            if placements
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
                != item_ids
            {
                errors.push(ContentError::new(
                    "canonical_placements_incomplete",
                    format!(
                        "question {} canonical placements must cover every item exactly once",
                        question.id
                    ),
                ));
            }
            for (item, category) in placements {
                if !item_ids.contains(item.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_unknown_item",
                        format!(
                            "question {} canonical answer references unknown item {}",
                            question.id, item
                        ),
                    ));
                }
                if !category_ids.contains(category.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_unknown_category",
                        format!(
                            "question {} canonical answer references unknown category {}",
                            question.id, category
                        ),
                    ));
                }
            }
        }
        (Interaction::Ordering { items }, CanonicalAnswer::Ordering { ordered_ids }) => {
            let item_ids: BTreeSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
            let ordered: BTreeSet<&str> = ordered_ids.iter().map(String::as_str).collect();

            if ordered != item_ids || ordered_ids.len() != items.len() {
                errors.push(ContentError::new(
                    "canonical_order_invalid",
                    format!(
                        "question {} canonical order must be a permutation of its items",
                        question.id
                    ),
                ));
            }
        }
        (Interaction::NodeConnection { nodes }, CanonicalAnswer::NodeConnection { edges }) => {
            let node_ids: BTreeSet<&str> = nodes.iter().map(|node| node.id.as_str()).collect();
            let mut seen = HashSet::new();

            for edge in edges {
                if edge.len() != 2 {
                    errors.push(ContentError::new(
                        "canonical_edge_invalid",
                        format!(
                            "question {} canonical edge must have two endpoints",
                            question.id
                        ),
                    ));
                    continue;
                }
                let (from, to) = (&edge[0], &edge[1]);
                if !node_ids.contains(from.as_str()) || !node_ids.contains(to.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_edge_unknown_node",
                        format!(
                            "question {} canonical edge {from}->{to} references an unknown node",
                            question.id
                        ),
                    ));
                }
                if from == to {
                    errors.push(ContentError::new(
                        "canonical_edge_self_loop",
                        format!(
                            "question {} canonical edge {from}->{to} is a self-loop",
                            question.id
                        ),
                    ));
                }
                if !seen.insert((from.clone(), to.clone())) {
                    errors.push(ContentError::new(
                        "canonical_edge_duplicate",
                        format!(
                            "question {} canonical edge {from}->{to} is duplicated",
                            question.id
                        ),
                    ));
                }
            }
        }
        _ => errors.push(ContentError::new(
            "canonical_answer_mismatch",
            format!(
                "question {} canonical answer does not match its interaction definition",
                question.id
            ),
        )),
    }
}

fn validate_error_codes(question: &Question, errors: &mut Vec<ContentError>) {
    if question.error_codes.is_empty() {
        errors.push(ContentError::new(
            "error_codes_missing",
            format!(
                "question {} must declare structured error codes",
                question.id
            ),
        ));
    }

    let mut seen = HashSet::new();
    for error_code in &question.error_codes {
        if error_code.code.trim().is_empty() || error_code.description.trim().is_empty() {
            errors.push(ContentError::new(
                "error_code_field_missing",
                format!(
                    "question {} has an empty error code or description",
                    question.id
                ),
            ));
        }
        if !seen.insert(error_code.code.as_str()) {
            errors.push(ContentError::new(
                "duplicate_error_code",
                format!(
                    "question {} declares error code {} twice",
                    question.id, error_code.code
                ),
            ));
        }
    }
}

fn validate_source_refs(question: &Question, errors: &mut Vec<ContentError>) {
    if question.source_refs.is_empty() {
        errors.push(ContentError::new(
            "source_refs_missing",
            format!(
                "question {} must reference at least one source",
                question.id
            ),
        ));
    }

    for source in &question.source_refs {
        if source.title.trim().is_empty() || source.url.trim().is_empty() {
            errors.push(ContentError::new(
                "source_ref_field_missing",
                format!("question {} has an empty source reference", question.id),
            ));
        }
    }
}

fn ensure_unique_choice_ids(
    question: &Question,
    choices: &[crate::model::Choice],
    kind: &str,
    errors: &mut Vec<ContentError>,
) {
    let mut seen = HashSet::new();
    for choice in choices {
        if choice.id.trim().is_empty() || choice.label.trim().is_empty() {
            errors.push(ContentError::new(
                "choice_field_missing",
                format!("question {} has an empty {kind} id or label", question.id),
            ));
        }
        if !seen.insert(choice.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_choice_id",
                format!(
                    "question {} has duplicate {kind} id {}",
                    question.id, choice.id
                ),
            ));
        }
    }
}

fn interaction_matches(question: &Question) -> bool {
    matches!(
        (question.interaction_type, &question.interaction),
        (
            InteractionType::Classification,
            Interaction::Classification { .. }
        ) | (InteractionType::Ordering, Interaction::Ordering { .. })
            | (
                InteractionType::NodeConnection,
                Interaction::NodeConnection { .. }
            )
    )
}

fn is_valid_weight(weight: f64) -> bool {
    weight > 0.0 && weight <= 1.0 && weight.is_finite()
}
