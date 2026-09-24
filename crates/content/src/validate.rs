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
    /// Repository-relative source file, when the error came from a discovered
    /// file. `None` for errors that only make sense across sources or that come
    /// from in-memory validation.
    pub source: Option<String>,
}

impl ContentError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    /// Attaches the source file this error came from.
    pub(crate) fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }
}

const WEIGHT_TOLERANCE: f64 = 1e-6;

/// Inclusive bounds for an authored typed-blank `width_chars` hint.
///
/// The lower bound keeps a blank wide enough to type into; the upper bound
/// keeps one blank from dominating the layout on a normal viewport.
pub const TYPED_BLANK_MIN_WIDTH_CHARS: u16 = 6;
/// See [`TYPED_BLANK_MIN_WIDTH_CHARS`].
pub const TYPED_BLANK_MAX_WIDTH_CHARS: u16 = 80;

/// Inclusive bounds for an authored multi-line typed-blank `rows` hint.
pub const TYPED_BLANK_MIN_ROWS: u8 = 2;
/// See [`TYPED_BLANK_MIN_ROWS`].
pub const TYPED_BLANK_MAX_ROWS: u8 = 12;

/// Maximum authored learner source length, in bytes.
///
/// Keeps a malformed or hostile bundle from shipping an unbounded program to
/// the browser runtime.
pub const PYTHON_MAX_SOURCE_BYTES: usize = 20_000;
/// Maximum authored starter-code length, in bytes.
pub const PYTHON_MAX_STARTER_BYTES: usize = 20_000;
/// Maximum number of authored tests per Python question.
///
/// The browser refuses to run more than this many tests for one execution, so
/// validation keeps authored content and runtime limits consistent.
pub const PYTHON_MAX_TESTS: usize = 50;
/// Maximum number of positional arguments one authored call may pass.
pub const PYTHON_MAX_TEST_ARGS: usize = 16;
/// Maximum serialized size of one authored expected value, in bytes.
pub const PYTHON_MAX_VALUE_BYTES: usize = 8_000;
/// Maximum expected standard output length, in bytes.
pub const PYTHON_MAX_EXPECTED_STDOUT_BYTES: usize = 8_000;

/// Maximum number of packages one question may declare.
pub const PYTHON_MAX_PACKAGES: usize = 4;

/// Runtime packages content may explicitly load into the Python sandbox.
///
/// These are the scientific packages shipped by the pinned Pyodide
/// distribution; the browser loads them from the self-hosted runtime with
/// Pyodide's own package loader. Learner code can never request a package that
/// is not on this list, and `micropip`/PyPI are never used.
///
/// `seaborn` is intentionally absent: the pinned Pyodide build does not ship
/// it, and enabling it would require installing a wheel from PyPI.
pub const PYTHON_ALLOWED_PACKAGES: &[&str] = &["numpy", "pandas", "matplotlib"];

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

pub(crate) fn validate_interaction(question: &Question, errors: &mut Vec<ContentError>) {
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
        Interaction::Reconstruction {
            layout,
            fixed_nodes,
            pieces,
            slots,
        } => {
            if pieces.len() < 2 {
                errors.push(ContentError::new(
                    "reconstruction_pieces_incomplete",
                    format!(
                        "question {} needs at least two candidate pieces",
                        question.id
                    ),
                ));
            }
            if slots.is_empty() {
                errors.push(ContentError::new(
                    "reconstruction_slots_missing",
                    format!("question {} needs at least one slot", question.id),
                ));
            }
            ensure_unique_choice_ids(question, pieces, "reconstruction piece", errors);

            let mut slot_ids = HashSet::new();
            for slot in slots {
                if slot.id.trim().is_empty() {
                    errors.push(ContentError::new(
                        "slot_field_missing",
                        format!("question {} has a slot with an empty id", question.id),
                    ));
                }
                if !slot_ids.insert(slot.id.as_str()) {
                    errors.push(ContentError::new(
                        "duplicate_slot_id",
                        format!("question {} has duplicate slot id {}", question.id, slot.id),
                    ));
                }
                if *layout == crate::model::ReconstructionLayout::Graph {
                    let positioned = matches!(
                        (slot.x, slot.y),
                        (Some(x), Some(y))
                            if (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y)
                    );
                    if !positioned {
                        errors.push(ContentError::new(
                            "invalid_slot_position",
                            format!(
                                "question {} graph slot {} needs an x and y within [0, 1]",
                                question.id, slot.id
                            ),
                        ));
                    }
                }
            }

            let mut fixed_ids = HashSet::new();
            for node in fixed_nodes {
                if node.id.trim().is_empty() || node.label.trim().is_empty() {
                    errors.push(ContentError::new(
                        "fixed_node_field_missing",
                        format!(
                            "question {} has a fixed node with an empty id or label",
                            question.id
                        ),
                    ));
                }
                if !fixed_ids.insert(node.id.as_str()) {
                    errors.push(ContentError::new(
                        "duplicate_fixed_node_id",
                        format!(
                            "question {} has duplicate fixed node id {}",
                            question.id, node.id
                        ),
                    ));
                }
                if *layout == crate::model::ReconstructionLayout::Graph {
                    let positioned = matches!(
                        (node.x, node.y),
                        (Some(x), Some(y))
                            if (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y)
                    );
                    if !positioned {
                        errors.push(ContentError::new(
                            "invalid_fixed_node_position",
                            format!(
                                "question {} graph fixed node {} needs an x and y within [0, 1]",
                                question.id, node.id
                            ),
                        ));
                    }
                }
            }

            for piece in pieces {
                if fixed_ids.contains(piece.id.as_str()) {
                    errors.push(ContentError::new(
                        "fixed_node_piece_id_collision",
                        format!(
                            "question {} uses id {} for both a fixed node and a piece",
                            question.id, piece.id
                        ),
                    ));
                }
            }
        }
        Interaction::EvidenceSelection { evidence } => {
            if evidence.len() < 2 {
                errors.push(ContentError::new(
                    "evidence_selection_incomplete",
                    format!(
                        "question {} needs at least two evidence options",
                        question.id
                    ),
                ));
            }
            ensure_unique_choice_ids(question, evidence, "evidence", errors);
        }
        Interaction::SpotTheFault { elements } => {
            if elements.is_empty() {
                errors.push(ContentError::new(
                    "spot_the_fault_incomplete",
                    format!("question {} needs at least one element", question.id),
                ));
            }
            ensure_unique_choice_ids(question, elements, "fault element", errors);
        }
        Interaction::FillSlots { slots, options } => {
            if slots.is_empty() {
                errors.push(ContentError::new(
                    "fill_slots_incomplete",
                    format!("question {} needs at least one slot", question.id),
                ));
            }
            if options.len() < 2 {
                errors.push(ContentError::new(
                    "fill_slots_options_incomplete",
                    format!("question {} needs at least two fill options", question.id),
                ));
            }
            ensure_unique_slot_ids(question, slots, errors);
            ensure_unique_choice_ids(question, options, "fill option", errors);
        }
        Interaction::Troubleshooting {
            start_step_id,
            steps,
        }
        | Interaction::ScenarioChoiceChain {
            start_step_id,
            steps,
        } => {
            validate_scenario_steps(question, start_step_id, steps, errors);
        }
        Interaction::ConfigurationBuilder { slots, pieces } => {
            if slots.is_empty() {
                errors.push(ContentError::new(
                    "configuration_builder_incomplete",
                    format!("question {} needs at least one slot", question.id),
                ));
            }
            if pieces.is_empty() {
                errors.push(ContentError::new(
                    "configuration_builder_pieces_missing",
                    format!("question {} needs at least one piece", question.id),
                ));
            }
            ensure_unique_config_slots(question, slots, errors);
            ensure_unique_choice_ids(question, pieces, "configuration piece", errors);
        }
        Interaction::TwoDimensionalPlacement {
            x_axis,
            y_axis,
            items,
        } => {
            validate_placement_axis(question, x_axis, errors);
            validate_placement_axis(question, y_axis, errors);
            if items.is_empty() {
                errors.push(ContentError::new(
                    "placement_items_missing",
                    format!("question {} needs at least one item", question.id),
                ));
            }
            ensure_unique_choice_ids(question, items, "placement item", errors);
        }
        Interaction::CommandAssembly { slots, tokens } => {
            if slots.is_empty() {
                errors.push(ContentError::new(
                    "command_assembly_incomplete",
                    format!("question {} needs at least one slot", question.id),
                ));
            }
            if tokens.len() < 2 {
                errors.push(ContentError::new(
                    "command_tokens_incomplete",
                    format!("question {} needs at least two tokens", question.id),
                ));
            }
            ensure_unique_slot_ids(question, slots, errors);
            ensure_unique_choice_ids(question, tokens, "command token", errors);
        }
        Interaction::TypedFillBlank { content, slots } => {
            validate_typed_fill_blank(question, content, slots, errors);
        }
        Interaction::MultipleChoice { choices } => {
            if choices.len() < 2 {
                errors.push(ContentError::new(
                    "multiple_choice_incomplete",
                    format!(
                        "question {} needs at least two choices for multiple choice",
                        question.id
                    ),
                ));
            }
            ensure_unique_choice_ids(question, choices, "multiple-choice", errors);
        }
        Interaction::MultipleResponse {
            choices,
            required_selections,
        } => {
            if choices.len() < 2 {
                errors.push(ContentError::new(
                    "multiple_response_incomplete",
                    format!(
                        "question {} needs at least two choices for multiple response",
                        question.id
                    ),
                ));
            }
            if *required_selections < 2 {
                errors.push(ContentError::new(
                    "multiple_response_required_invalid",
                    format!(
                        "question {} required_selections must be at least 2",
                        question.id
                    ),
                ));
            } else if *required_selections > choices.len() {
                errors.push(ContentError::new(
                    "multiple_response_required_invalid",
                    format!(
                        "question {} required_selections {} exceeds its {} choices",
                        question.id,
                        required_selections,
                        choices.len()
                    ),
                ));
            }
            ensure_unique_choice_ids(question, choices, "multiple-response", errors);
        }
        Interaction::PythonCode {
            language,
            entrypoint,
            starter_code,
            packages,
        } => {
            validate_python_code(
                question,
                language,
                entrypoint,
                starter_code,
                packages,
                errors,
            );
        }
    }
}

/// A Python identifier: ASCII letter or underscore, then letters/digits/underscores.
fn is_python_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

/// Validates a browser-executed Python interaction.
fn validate_python_code(
    question: &Question,
    language: &str,
    entrypoint: &str,
    starter_code: &str,
    packages: &[String],
    errors: &mut Vec<ContentError>,
) {
    if language != "python" {
        errors.push(ContentError::new(
            "python_code_language_unsupported",
            format!(
                "question {} python_code language must be \"python\", got {language:?}",
                question.id
            ),
        ));
    }

    if !entrypoint.is_empty() && !is_python_identifier(entrypoint) {
        errors.push(ContentError::new(
            "python_code_entrypoint_invalid",
            format!(
                "question {} entrypoint {entrypoint:?} is not a valid Python identifier",
                question.id
            ),
        ));
    }

    if starter_code.trim().is_empty() {
        errors.push(ContentError::new(
            "python_code_starter_missing",
            format!("question {} needs learner starter code", question.id),
        ));
    } else if starter_code.len() > PYTHON_MAX_STARTER_BYTES {
        errors.push(ContentError::new(
            "python_code_starter_too_large",
            format!(
                "question {} starter code exceeds {PYTHON_MAX_STARTER_BYTES} bytes",
                question.id
            ),
        ));
    }

    if packages.len() > PYTHON_MAX_PACKAGES {
        errors.push(ContentError::new(
            "python_code_packages_too_many",
            format!(
                "question {} declares {} packages; the cap is {PYTHON_MAX_PACKAGES}",
                question.id,
                packages.len()
            ),
        ));
    }

    for package in packages {
        if !PYTHON_ALLOWED_PACKAGES.contains(&package.as_str()) {
            errors.push(ContentError::new(
                "python_code_package_not_allowed",
                format!(
                    "question {} requests package {package:?}, which is not on the runtime allowlist",
                    question.id
                ),
            ));
        }
    }
}

/// Validates the authored behavioral tests of a Python exercise.
fn validate_python_tests(
    question: &Question,
    entrypoint: &str,
    tests: &[crate::model::PythonTest],
    errors: &mut Vec<ContentError>,
) {
    use crate::model::PythonTest;

    if tests.is_empty() {
        errors.push(ContentError::new(
            "python_code_tests_missing",
            format!(
                "question {} needs at least one executable test",
                question.id
            ),
        ));
    }
    if tests.len() > PYTHON_MAX_TESTS {
        errors.push(ContentError::new(
            "python_code_tests_too_many",
            format!(
                "question {} has {} tests; the runtime cap is {PYTHON_MAX_TESTS}",
                question.id,
                tests.len()
            ),
        ));
    }

    let mut needs_entrypoint = false;
    for test in tests {
        match test {
            PythonTest::Call { args, expected } => {
                needs_entrypoint = true;
                check_python_args(question, args, errors);
                let size = serde_json::to_vec(expected)
                    .map(|bytes| bytes.len())
                    .unwrap_or(0);
                if size > PYTHON_MAX_VALUE_BYTES {
                    errors.push(ContentError::new(
                        "python_code_expected_too_large",
                        format!(
                            "question {} expected value exceeds {PYTHON_MAX_VALUE_BYTES} bytes",
                            question.id
                        ),
                    ));
                }
            }
            PythonTest::Raises { args, exception } => {
                needs_entrypoint = true;
                check_python_args(question, args, errors);
                if !is_python_identifier(exception) {
                    errors.push(ContentError::new(
                        "python_code_exception_invalid",
                        format!(
                            "question {} expected exception {exception:?} is not a valid Python identifier",
                            question.id
                        ),
                    ));
                }
            }
            PythonTest::Stdout { expected } => {
                if expected.len() > PYTHON_MAX_EXPECTED_STDOUT_BYTES {
                    errors.push(ContentError::new(
                        "python_code_stdout_too_large",
                        format!(
                            "question {} expected stdout exceeds {PYTHON_MAX_EXPECTED_STDOUT_BYTES} bytes",
                            question.id
                        ),
                    ));
                }
            }
        }
    }

    if needs_entrypoint && entrypoint.is_empty() {
        errors.push(ContentError::new(
            "python_code_entrypoint_missing",
            format!(
                "question {} has call/raises tests but no entrypoint to call",
                question.id
            ),
        ));
    }
}

/// Bounds the positional arguments of one authored test.
fn check_python_args(
    question: &Question,
    args: &[serde_json::Value],
    errors: &mut Vec<ContentError>,
) {
    if args.len() > PYTHON_MAX_TEST_ARGS {
        errors.push(ContentError::new(
            "python_code_args_too_many",
            format!(
                "question {} test passes {} arguments; the cap is {PYTHON_MAX_TEST_ARGS}",
                question.id,
                args.len()
            ),
        ));
    }
    for arg in args {
        let size = serde_json::to_vec(arg)
            .map(|bytes| bytes.len())
            .unwrap_or(0);
        if size > PYTHON_MAX_VALUE_BYTES {
            errors.push(ContentError::new(
                "python_code_args_too_large",
                format!(
                    "question {} test argument exceeds {PYTHON_MAX_VALUE_BYTES} bytes",
                    question.id
                ),
            ));
        }
    }
}

/// Validates the templates, table structure, and slot definitions of a typed
/// fill-in-the-blank interaction.
fn validate_typed_fill_blank(
    question: &Question,
    content: &crate::model::TypedFillContent,
    slots: &[crate::model::TypedBlankSlot],
    errors: &mut Vec<ContentError>,
) {
    if slots.is_empty() {
        errors.push(ContentError::new(
            "typed_fill_blank_incomplete",
            format!("question {} needs at least one blank slot", question.id),
        ));
    }

    ensure_unique_typed_slots(question, slots, errors);

    // Collect every authored template so placeholder consistency can be checked
    // across the whole interaction, including all table cells.
    let mut templates: Vec<String> = Vec::new();
    match content {
        crate::model::TypedFillContent::Text { template } => {
            push_typed_text_template(question, template, &mut templates, errors);
        }
        crate::model::TypedFillContent::Code { language, template } => {
            push_typed_code_template(question, language, template, &mut templates, errors);
        }
        crate::model::TypedFillContent::Table { columns, rows } => {
            validate_typed_table(question, columns, rows, &mut templates, errors);
        }
    }

    let mut placeholders = Vec::new();
    let mut malformed = false;
    for template in &templates {
        match extract_typed_placeholders(template) {
            Ok(ids) => placeholders.extend(ids),
            Err(()) => malformed = true,
        }
    }
    if malformed {
        errors.push(ContentError::new(
            "typed_placeholder_malformed",
            format!(
                "question {} has a malformed placeholder; expected {{{{slot_id}}}}",
                question.id
            ),
        ));
    }

    let mut seen = HashSet::new();
    for placeholder in &placeholders {
        if !seen.insert(placeholder.as_str()) {
            errors.push(ContentError::new(
                "typed_duplicate_placeholder",
                format!(
                    "question {} references {{{{{placeholder}}}}} more than once",
                    question.id
                ),
            ));
        }
    }

    let slot_ids: HashSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
    let placeholder_ids: HashSet<&str> = placeholders.iter().map(String::as_str).collect();

    for placeholder in &placeholder_ids {
        if !slot_ids.contains(placeholder) {
            errors.push(ContentError::new(
                "typed_placeholder_unknown_slot",
                format!(
                    "question {} text references {{{{{placeholder}}}}} but no such slot is defined",
                    question.id
                ),
            ));
        }
    }
    for slot_id in &slot_ids {
        if !placeholder_ids.contains(slot_id) {
            errors.push(ContentError::new(
                "typed_slot_not_referenced",
                format!(
                    "question {} defines slot {slot_id} but no template references {{{{{slot_id}}}}}",
                    question.id
                ),
            ));
        }
    }
}

/// Validates a non-empty text template and records it for placeholder checking.
fn push_typed_text_template(
    question: &Question,
    template: &str,
    templates: &mut Vec<String>,
    errors: &mut Vec<ContentError>,
) {
    if template.trim().is_empty() {
        errors.push(ContentError::new(
            "typed_template_empty",
            format!("question {} has an empty typed-fill template", question.id),
        ));
        return;
    }
    templates.push(template.to_owned());
}

/// Validates a code template's language and records the template.
fn push_typed_code_template(
    question: &Question,
    language: &str,
    template: &str,
    templates: &mut Vec<String>,
    errors: &mut Vec<ContentError>,
) {
    if language.trim().is_empty() {
        errors.push(ContentError::new(
            "typed_code_language_missing",
            format!(
                "question {} has a code template with an empty language",
                question.id
            ),
        ));
    }
    push_typed_text_template(question, template, templates, errors);
}

/// Validates a typed fill-in-the-blank table's columns, rows, and cell templates.
fn validate_typed_table(
    question: &Question,
    columns: &[crate::model::TypedFillTableColumn],
    rows: &[crate::model::TypedFillTableRow],
    templates: &mut Vec<String>,
    errors: &mut Vec<ContentError>,
) {
    if columns.is_empty() {
        errors.push(ContentError::new(
            "typed_table_columns_missing",
            format!("question {} table needs at least one column", question.id),
        ));
    }
    if rows.is_empty() {
        errors.push(ContentError::new(
            "typed_table_rows_missing",
            format!("question {} table needs at least one row", question.id),
        ));
    }

    let mut column_ids = HashSet::new();
    for column in columns {
        if column.id.trim().is_empty() || column.label.trim().is_empty() {
            errors.push(ContentError::new(
                "typed_table_column_field_missing",
                format!(
                    "question {} has a table column with an empty id or label",
                    question.id
                ),
            ));
        }
        if !column_ids.insert(column.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_typed_table_column_id",
                format!(
                    "question {} has duplicate table column id {}",
                    question.id, column.id
                ),
            ));
        }
    }

    let mut row_ids = HashSet::new();
    for row in rows {
        if row.id.trim().is_empty() {
            errors.push(ContentError::new(
                "typed_table_row_field_missing",
                format!("question {} has a table row with an empty id", question.id),
            ));
        }
        if !row_ids.insert(row.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_typed_table_row_id",
                format!(
                    "question {} has duplicate table row id {}",
                    question.id, row.id
                ),
            ));
        }

        for column_id in &column_ids {
            if !row.cells.contains_key(*column_id) {
                errors.push(ContentError::new(
                    "typed_table_row_column_missing",
                    format!(
                        "question {} table row {} is missing a cell for column {column_id}",
                        question.id, row.id
                    ),
                ));
            }
        }
        for cell_column_id in row.cells.keys() {
            if !column_ids.contains(cell_column_id.as_str()) {
                errors.push(ContentError::new(
                    "typed_table_unknown_cell",
                    format!(
                        "question {} table row {} has a cell for unknown column {cell_column_id}",
                        question.id, row.id
                    ),
                ));
            }
        }

        for cell in row.cells.values() {
            match cell {
                crate::model::TypedFillTableCell::Text { template } => {
                    push_typed_text_template(question, template, templates, errors);
                }
                crate::model::TypedFillTableCell::Code { language, template } => {
                    push_typed_code_template(question, language, template, templates, errors);
                }
            }
        }
    }
}

/// Extracts `{{slot_id}}` placeholders in order of appearance.
///
/// Returns `Err(())` when the text contains an unterminated or malformed
/// placeholder, for example `{{` without a closing `}}`, an empty id, or an id
/// containing whitespace or braces.
///
/// A bare `}}` that is not part of a placeholder is treated as literal text.
/// Code templates legitimately contain closing braces (for example nested
/// dictionaries or blocks), so flagging them would reject valid content.
fn extract_typed_placeholders(text: &str) -> Result<Vec<String>, ()> {
    let mut placeholders = Vec::new();
    let mut rest = text;

    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            return Err(());
        };
        let id = &after[..end];
        if id.is_empty()
            || id != id.trim()
            || id.chars().any(|c| c.is_whitespace())
            || id.contains('{')
            || id.contains('}')
        {
            return Err(());
        }
        placeholders.push(id.to_owned());
        rest = &after[end + 2..];
    }

    Ok(placeholders)
}

/// Validates typed blank slot ids, labels, and presentation hints, and rejects
/// duplicate ids.
///
/// Presentation hints are optional and never influence scoring; they are only
/// checked so authored content cannot request an unusable input size.
fn ensure_unique_typed_slots(
    question: &Question,
    slots: &[crate::model::TypedBlankSlot],
    errors: &mut Vec<ContentError>,
) {
    let mut seen = HashSet::new();
    for slot in slots {
        if slot.id.trim().is_empty() || slot.label.trim().is_empty() {
            errors.push(ContentError::new(
                "slot_field_missing",
                format!("question {} has an empty slot id or label", question.id),
            ));
        }
        if !seen.insert(slot.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_slot_id",
                format!("question {} has duplicate slot id {}", question.id, slot.id),
            ));
        }

        if let Some(width_chars) = slot.width_chars {
            if !(TYPED_BLANK_MIN_WIDTH_CHARS..=TYPED_BLANK_MAX_WIDTH_CHARS).contains(&width_chars) {
                errors.push(ContentError::new(
                    "typed_blank_width_invalid",
                    format!(
                        "question {} slot {} has width_chars {} outside {}..={}",
                        question.id,
                        slot.id,
                        width_chars,
                        TYPED_BLANK_MIN_WIDTH_CHARS,
                        TYPED_BLANK_MAX_WIDTH_CHARS
                    ),
                ));
            }
        }

        if let Some(rows) = slot.rows {
            if !slot.multiline {
                errors.push(ContentError::new(
                    "typed_blank_rows_without_multiline",
                    format!(
                        "question {} slot {} sets rows but multiline is not true",
                        question.id, slot.id
                    ),
                ));
            } else if !(TYPED_BLANK_MIN_ROWS..=TYPED_BLANK_MAX_ROWS).contains(&rows) {
                errors.push(ContentError::new(
                    "typed_blank_rows_invalid",
                    format!(
                        "question {} slot {} has rows {} outside {}..={}",
                        question.id, slot.id, rows, TYPED_BLANK_MIN_ROWS, TYPED_BLANK_MAX_ROWS
                    ),
                ));
            }
        }
    }
}

fn validate_placement_axis(
    question: &Question,
    axis: &crate::model::PlacementAxis,
    errors: &mut Vec<ContentError>,
) {
    if axis.id.trim().is_empty()
        || axis.label.trim().is_empty()
        || axis.low_label.trim().is_empty()
        || axis.high_label.trim().is_empty()
    {
        errors.push(ContentError::new(
            "placement_axis_field_missing",
            format!(
                "question {} has an axis with an empty id, label, or endpoint label",
                question.id
            ),
        ));
    }
}

fn ensure_unique_config_slots(
    question: &Question,
    slots: &[crate::model::ConfigSlot],
    errors: &mut Vec<ContentError>,
) {
    let mut seen = HashSet::new();
    for slot in slots {
        if slot.id.trim().is_empty() || slot.label.trim().is_empty() {
            errors.push(ContentError::new(
                "slot_field_missing",
                format!(
                    "question {} has an empty configuration slot id or label",
                    question.id
                ),
            ));
        }
        if !seen.insert(slot.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_slot_id",
                format!(
                    "question {} has duplicate configuration slot id {}",
                    question.id, slot.id
                ),
            ));
        }
    }
}

fn validate_scenario_steps(
    question: &Question,
    start_step_id: &str,
    steps: &[crate::model::ScenarioStep],
    errors: &mut Vec<ContentError>,
) {
    if steps.is_empty() {
        errors.push(ContentError::new(
            "scenario_steps_missing",
            format!("question {} needs at least one step", question.id),
        ));
        return;
    }

    let mut step_ids = HashSet::new();
    let mut choice_ids = HashSet::new();

    for step in steps {
        if step.id.trim().is_empty() || step.prompt.trim().is_empty() {
            errors.push(ContentError::new(
                "scenario_step_field_missing",
                format!(
                    "question {} has a step with an empty id or prompt",
                    question.id
                ),
            ));
        }
        if !step_ids.insert(step.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_step_id",
                format!(
                    "question {} has duplicate scenario step id {}",
                    question.id, step.id
                ),
            ));
        }
        if step.choices.is_empty() {
            errors.push(ContentError::new(
                "scenario_step_choices_missing",
                format!("question {} step {} has no choices", question.id, step.id),
            ));
        }
        for choice in &step.choices {
            if choice.id.trim().is_empty() || choice.label.trim().is_empty() {
                errors.push(ContentError::new(
                    "choice_field_missing",
                    format!(
                        "question {} has a scenario choice with an empty id or label",
                        question.id
                    ),
                ));
            }
            if !choice_ids.insert(choice.id.as_str()) {
                errors.push(ContentError::new(
                    "duplicate_scenario_choice_id",
                    format!(
                        "question {} uses scenario choice id {} more than once",
                        question.id, choice.id
                    ),
                ));
            }
        }
    }

    if start_step_id.trim().is_empty() || !step_ids.contains(start_step_id) {
        errors.push(ContentError::new(
            "scenario_start_missing",
            format!(
                "question {} start step {} does not exist",
                question.id, start_step_id
            ),
        ));
    }

    let mut has_terminal = false;
    for step in steps {
        let local_choices: HashSet<&str> = step
            .choices
            .iter()
            .map(|choice| choice.id.as_str())
            .collect();
        for (choice_id, next_step_id) in &step.next_step_by_choice {
            if !local_choices.contains(choice_id.as_str()) {
                errors.push(ContentError::new(
                    "scenario_transition_unknown_choice",
                    format!(
                        "question {} step {} transition references unknown choice {}",
                        question.id, step.id, choice_id
                    ),
                ));
            }
            if !step_ids.contains(next_step_id.as_str()) {
                errors.push(ContentError::new(
                    "scenario_transition_unknown_step",
                    format!(
                        "question {} step {} transition targets unknown step {}",
                        question.id, step.id, next_step_id
                    ),
                ));
            }
        }
        if step.next_step_by_choice.is_empty() {
            has_terminal = true;
        }
    }

    if !has_terminal {
        errors.push(ContentError::new(
            "scenario_terminal_missing",
            format!(
                "question {} has no terminal step to end the scenario",
                question.id
            ),
        ));
    }

    if step_ids.contains(start_step_id) {
        let mut reachable: HashSet<&str> = HashSet::new();
        let mut stack = vec![start_step_id];
        while let Some(id) = stack.pop() {
            if !reachable.insert(id) {
                continue;
            }
            if let Some(step) = steps.iter().find(|step| step.id == id) {
                for next in step.next_step_by_choice.values() {
                    stack.push(next.as_str());
                }
            }
        }
        for step in steps {
            if !reachable.contains(step.id.as_str()) {
                errors.push(ContentError::new(
                    "scenario_step_unreachable",
                    format!(
                        "question {} step {} is not reachable from the start",
                        question.id, step.id
                    ),
                ));
            }
        }
    }
}

fn validate_scenario_answer(
    question: &Question,
    start_step_id: &str,
    steps: &[crate::model::ScenarioStep],
    correct_choice_ids: &std::collections::BTreeMap<String, Vec<String>>,
    expected_path: &[String],
    errors: &mut Vec<ContentError>,
) {
    for (step_id, ids) in correct_choice_ids {
        let Some(step) = steps.iter().find(|step| step.id == *step_id) else {
            errors.push(ContentError::new(
                "canonical_scenario_unknown_step",
                format!(
                    "question {} canonical answer references unknown step {}",
                    question.id, step_id
                ),
            ));
            continue;
        };
        if ids.is_empty() {
            errors.push(ContentError::new(
                "canonical_scenario_step_empty",
                format!(
                    "question {} lists no correct choices for step {}",
                    question.id, step_id
                ),
            ));
        }
        let mut seen = HashSet::new();
        for id in ids {
            if !step.choices.iter().any(|choice| &choice.id == id) {
                errors.push(ContentError::new(
                    "canonical_scenario_unknown_choice",
                    format!(
                        "question {} step {} canonical choice {} does not exist",
                        question.id, step_id, id
                    ),
                ));
            }
            if !seen.insert(id.as_str()) {
                errors.push(ContentError::new(
                    "canonical_scenario_duplicate_choice",
                    format!(
                        "question {} step {} lists canonical choice {} twice",
                        question.id, step_id, id
                    ),
                ));
            }
        }
    }

    if expected_path.is_empty() {
        errors.push(ContentError::new(
            "canonical_scenario_path_missing",
            format!(
                "question {} needs a non-empty expected scenario path",
                question.id
            ),
        ));
        return;
    }

    let mut current = start_step_id;
    for (index, choice_id) in expected_path.iter().enumerate() {
        let Some(step) = steps.iter().find(|step| step.id == current) else {
            errors.push(ContentError::new(
                "canonical_scenario_path_invalid",
                format!(
                    "question {} expected path reaches unknown step {}",
                    question.id, current
                ),
            ));
            return;
        };
        if !step.choices.iter().any(|choice| &choice.id == choice_id) {
            errors.push(ContentError::new(
                "canonical_scenario_unknown_choice",
                format!(
                    "question {} expected path choice {} is not in step {}",
                    question.id, choice_id, step.id
                ),
            ));
            return;
        }
        let is_correct = correct_choice_ids
            .get(step.id.as_str())
            .is_some_and(|ids| ids.iter().any(|id| id == choice_id));
        if !is_correct {
            errors.push(ContentError::new(
                "canonical_scenario_incorrect_path",
                format!(
                    "question {} expected path choice {} is not marked correct at step {}",
                    question.id, choice_id, step.id
                ),
            ));
        }
        match step.next_step_by_choice.get(choice_id) {
            Some(next) => current = next.as_str(),
            None if index + 1 == expected_path.len() => {}
            None => {
                errors.push(ContentError::new(
                    "canonical_scenario_path_invalid",
                    format!(
                        "question {} expected path continues past terminal choice {}",
                        question.id, choice_id
                    ),
                ));
                return;
            }
        }
    }
}

pub(crate) fn validate_canonical_answer(question: &Question, errors: &mut Vec<ContentError>) {
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
        (
            Interaction::Reconstruction {
                layout,
                fixed_nodes,
                pieces,
                slots,
            },
            CanonicalAnswer::Reconstruction { placements, edges },
        ) => {
            let slot_ids: BTreeSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
            let piece_ids: BTreeSet<&str> = pieces.iter().map(|piece| piece.id.as_str()).collect();
            let placed_slots: BTreeSet<&str> = placements.keys().map(String::as_str).collect();

            if placed_slots != slot_ids {
                errors.push(ContentError::new(
                    "canonical_reconstruction_slots_incomplete",
                    format!(
                        "question {} canonical placements must cover every slot exactly once",
                        question.id
                    ),
                ));
            }

            let mut seen_pieces = HashSet::new();
            for piece in placements.values() {
                if !piece_ids.contains(piece.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_unknown_piece",
                        format!(
                            "question {} canonical placement {piece} is not a candidate piece",
                            question.id
                        ),
                    ));
                }
                if !seen_pieces.insert(piece.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_reconstruction_duplicate_piece",
                        format!(
                            "question {} places piece {} in more than one slot",
                            question.id, piece
                        ),
                    ));
                }
            }

            if *layout == crate::model::ReconstructionLayout::Linear && !edges.is_empty() {
                errors.push(ContentError::new(
                    "canonical_edges_not_allowed_for_linear",
                    format!(
                        "question {} is linear; slot order encodes relationships so edges must be empty",
                        question.id
                    ),
                ));
            }

            let fixed_ids: HashSet<&str> =
                fixed_nodes.iter().map(|node| node.id.as_str()).collect();
            let allowed_nodes: HashSet<&str> = fixed_ids
                .iter()
                .copied()
                .chain(placements.values().map(String::as_str))
                .collect();

            let mut seen_edges = HashSet::new();
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
                if !allowed_nodes.contains(from.as_str()) || !allowed_nodes.contains(to.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_edge_unknown_component",
                        format!(
                            "question {} canonical edge {from}->{to} references a node that is not provided or placed",
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
                if !seen_edges.insert((from.clone(), to.clone())) {
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
        (
            Interaction::EvidenceSelection { evidence },
            CanonicalAnswer::EvidenceSelection { relevant_ids },
        ) => {
            let evidence_ids: BTreeSet<&str> =
                evidence.iter().map(|choice| choice.id.as_str()).collect();
            let relevant: BTreeSet<&str> = relevant_ids.iter().map(String::as_str).collect();

            if relevant_ids.is_empty() {
                errors.push(ContentError::new(
                    "canonical_evidence_missing",
                    format!(
                        "question {} evidence selection needs at least one relevant id",
                        question.id
                    ),
                ));
            }
            if relevant.len() != relevant_ids.len() {
                errors.push(ContentError::new(
                    "canonical_evidence_duplicate",
                    format!(
                        "question {} lists an evidence id more than once",
                        question.id
                    ),
                ));
            }
            for id in &relevant {
                if !evidence_ids.contains(id) {
                    errors.push(ContentError::new(
                        "canonical_unknown_evidence",
                        format!(
                            "question {} canonical evidence {id} is not an option",
                            question.id
                        ),
                    ));
                }
            }
        }
        (Interaction::SpotTheFault { elements }, CanonicalAnswer::SpotTheFault { faulty_ids }) => {
            let element_ids: BTreeSet<&str> =
                elements.iter().map(|choice| choice.id.as_str()).collect();
            let faulty: BTreeSet<&str> = faulty_ids.iter().map(String::as_str).collect();

            if faulty_ids.is_empty() {
                errors.push(ContentError::new(
                    "canonical_faults_missing",
                    format!(
                        "question {} spot-the-fault needs at least one faulty id",
                        question.id
                    ),
                ));
            }
            if faulty.len() != faulty_ids.len() {
                errors.push(ContentError::new(
                    "canonical_fault_duplicate",
                    format!(
                        "question {} lists a faulty element id more than once",
                        question.id
                    ),
                ));
            }
            for id in &faulty {
                if !element_ids.contains(id) {
                    errors.push(ContentError::new(
                        "canonical_unknown_element",
                        format!(
                            "question {} canonical faulty element {id} does not exist",
                            question.id
                        ),
                    ));
                }
            }
        }
        (Interaction::FillSlots { slots, options }, CanonicalAnswer::FillSlots { values }) => {
            let slot_ids: BTreeSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
            let option_ids: BTreeSet<&str> =
                options.iter().map(|choice| choice.id.as_str()).collect();
            let filled: BTreeSet<&str> = values.keys().map(String::as_str).collect();

            if filled != slot_ids {
                errors.push(ContentError::new(
                    "canonical_slots_incomplete",
                    format!(
                        "question {} canonical values must cover every slot exactly once",
                        question.id
                    ),
                ));
            }
            for option in values.values() {
                if !option_ids.contains(option.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_unknown_option",
                        format!(
                            "question {} canonical slot value {option} is not an option",
                            question.id
                        ),
                    ));
                }
            }
        }
        (
            Interaction::Troubleshooting {
                start_step_id,
                steps,
            }
            | Interaction::ScenarioChoiceChain {
                start_step_id,
                steps,
            },
            CanonicalAnswer::Troubleshooting {
                correct_choice_ids,
                expected_path,
            }
            | CanonicalAnswer::ScenarioChoiceChain {
                correct_choice_ids,
                expected_path,
            },
        ) => {
            validate_scenario_answer(
                question,
                start_step_id,
                steps,
                correct_choice_ids,
                expected_path,
                errors,
            );
        }
        (
            Interaction::ConfigurationBuilder { slots, pieces },
            CanonicalAnswer::ConfigurationBuilder { assignments },
        ) => {
            let slot_ids: BTreeSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
            let piece_ids: BTreeSet<&str> = pieces.iter().map(|piece| piece.id.as_str()).collect();
            let assigned: BTreeSet<&str> = assignments.keys().map(String::as_str).collect();

            if assigned != slot_ids {
                errors.push(ContentError::new(
                    "canonical_config_slots_incomplete",
                    format!(
                        "question {} canonical assignments must cover every slot exactly once",
                        question.id
                    ),
                ));
            }

            let mut seen = HashSet::new();
            for piece in assignments.values() {
                if !piece_ids.contains(piece.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_unknown_piece",
                        format!(
                            "question {} canonical assignment references unknown piece {}",
                            question.id, piece
                        ),
                    ));
                }
                if !seen.insert(piece.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_config_duplicate_piece",
                        format!(
                            "question {} assigns piece {} to more than one slot",
                            question.id, piece
                        ),
                    ));
                }
            }
        }
        (
            Interaction::TwoDimensionalPlacement { items, .. },
            CanonicalAnswer::TwoDimensionalPlacement { regions },
        ) => {
            let item_ids: BTreeSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
            let region_ids: BTreeSet<&str> = regions.keys().map(String::as_str).collect();

            if region_ids != item_ids {
                errors.push(ContentError::new(
                    "canonical_regions_incomplete",
                    format!(
                        "question {} canonical regions must cover every item exactly once",
                        question.id
                    ),
                ));
            }

            for (item_id, region) in regions {
                if region.x.len() != 2 || region.y.len() != 2 {
                    errors.push(ContentError::new(
                        "canonical_region_invalid",
                        format!(
                            "question {} region {item_id} must define an x and y range of two values",
                            question.id
                        ),
                    ));
                    continue;
                }
                for (axis, range) in [("x", &region.x), ("y", &region.y)] {
                    let in_range = range
                        .iter()
                        .all(|value| value.is_finite() && (0.0..=1.0).contains(value));
                    if !in_range || range[0] > range[1] {
                        errors.push(ContentError::new(
                            "canonical_region_invalid_range",
                            format!(
                                "question {} region {item_id} {axis} range must be within [0, 1] with min <= max",
                                question.id
                            ),
                        ));
                    }
                }
            }
        }
        (
            Interaction::CommandAssembly { slots, tokens },
            CanonicalAnswer::CommandAssembly { values },
        ) => {
            let slot_ids: BTreeSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
            let token_ids: BTreeSet<&str> = tokens.iter().map(|token| token.id.as_str()).collect();
            let filled: BTreeSet<&str> = values.keys().map(String::as_str).collect();

            if filled != slot_ids {
                errors.push(ContentError::new(
                    "canonical_command_slots_incomplete",
                    format!(
                        "question {} canonical values must cover every slot exactly once",
                        question.id
                    ),
                ));
            }

            let mut seen = HashSet::new();
            for token in values.values() {
                if !token_ids.contains(token.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_unknown_token",
                        format!(
                            "question {} canonical token {token} is not available",
                            question.id
                        ),
                    ));
                }
                if !seen.insert(token.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_command_duplicate_token",
                        format!(
                            "question {} uses token {} in more than one slot",
                            question.id, token
                        ),
                    ));
                }
            }
        }
        (
            Interaction::TypedFillBlank { slots, .. },
            CanonicalAnswer::TypedFillBlank { answers },
        ) => {
            let slot_ids: BTreeSet<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
            let answer_ids: BTreeSet<&str> = answers.keys().map(String::as_str).collect();

            for slot_id in &slot_ids {
                if !answer_ids.contains(slot_id) {
                    errors.push(ContentError::new(
                        "canonical_typed_answer_missing",
                        format!(
                            "question {} canonical answer is missing a value for slot {slot_id}",
                            question.id
                        ),
                    ));
                }
            }
            for slot_id in &answer_ids {
                if !slot_ids.contains(slot_id) {
                    errors.push(ContentError::new(
                        "canonical_typed_unknown_slot",
                        format!(
                            "question {} canonical answer references unknown slot {slot_id}",
                            question.id
                        ),
                    ));
                }
            }

            for (slot_id, answer) in answers {
                if answer.accepted_answers.is_empty() {
                    errors.push(ContentError::new(
                        "canonical_typed_answer_empty",
                        format!(
                            "question {} slot {slot_id} must declare at least one accepted answer",
                            question.id
                        ),
                    ));
                }
                for accepted in &answer.accepted_answers {
                    if accepted.trim().is_empty() {
                        errors.push(ContentError::new(
                            "canonical_typed_answer_blank",
                            format!(
                                "question {} slot {slot_id} has an empty accepted answer",
                                question.id
                            ),
                        ));
                    }
                }
            }
        }
        (
            Interaction::MultipleChoice { choices },
            CanonicalAnswer::MultipleChoice { choice_id },
        ) => {
            let choice_ids: BTreeSet<&str> =
                choices.iter().map(|choice| choice.id.as_str()).collect();
            if choice_id.trim().is_empty() || !choice_ids.contains(choice_id.as_str()) {
                errors.push(ContentError::new(
                    "canonical_unknown_choice",
                    format!(
                        "question {} canonical answer references unknown choice {}",
                        question.id, choice_id
                    ),
                ));
            }
        }
        (
            Interaction::MultipleResponse {
                choices,
                required_selections,
            },
            CanonicalAnswer::MultipleResponse { choice_ids },
        ) => {
            let available: BTreeSet<&str> =
                choices.iter().map(|choice| choice.id.as_str()).collect();
            let mut seen = HashSet::new();
            for choice_id in choice_ids {
                if !available.contains(choice_id.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_unknown_choice",
                        format!(
                            "question {} canonical answer references unknown choice {}",
                            question.id, choice_id
                        ),
                    ));
                }
                if !seen.insert(choice_id.as_str()) {
                    errors.push(ContentError::new(
                        "canonical_duplicate_choice",
                        format!(
                            "question {} canonical answer repeats choice {}",
                            question.id, choice_id
                        ),
                    ));
                }
            }
            if choice_ids.len() != *required_selections {
                errors.push(ContentError::new(
                    "canonical_response_count_mismatch",
                    format!(
                        "question {} canonical answer has {} choices but required_selections is {}",
                        question.id,
                        choice_ids.len(),
                        required_selections
                    ),
                ));
            }
        }
        (Interaction::PythonCode { entrypoint, .. }, CanonicalAnswer::PythonCode { tests }) => {
            validate_python_tests(question, entrypoint, tests, errors);
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

fn ensure_unique_slot_ids(
    question: &Question,
    slots: &[crate::model::FillSlot],
    errors: &mut Vec<ContentError>,
) {
    let mut seen = HashSet::new();
    for slot in slots {
        if slot.id.trim().is_empty() || slot.label.trim().is_empty() {
            errors.push(ContentError::new(
                "slot_field_missing",
                format!("question {} has an empty slot id or label", question.id),
            ));
        }
        if !seen.insert(slot.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_slot_id",
                format!("question {} has duplicate slot id {}", question.id, slot.id),
            ));
        }
    }
}

pub(crate) fn interaction_matches(question: &Question) -> bool {
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
            | (
                InteractionType::Reconstruction,
                Interaction::Reconstruction { .. }
            )
            | (
                InteractionType::EvidenceSelection,
                Interaction::EvidenceSelection { .. }
            )
            | (
                InteractionType::SpotTheFault,
                Interaction::SpotTheFault { .. }
            )
            | (InteractionType::FillSlots, Interaction::FillSlots { .. })
            | (
                InteractionType::Troubleshooting,
                Interaction::Troubleshooting { .. }
            )
            | (
                InteractionType::ScenarioChoiceChain,
                Interaction::ScenarioChoiceChain { .. }
            )
            | (
                InteractionType::ConfigurationBuilder,
                Interaction::ConfigurationBuilder { .. }
            )
            | (
                InteractionType::TwoDimensionalPlacement,
                Interaction::TwoDimensionalPlacement { .. }
            )
            | (
                InteractionType::CommandAssembly,
                Interaction::CommandAssembly { .. }
            )
            | (
                InteractionType::TypedFillBlank,
                Interaction::TypedFillBlank { .. }
            )
            | (
                InteractionType::MultipleChoice,
                Interaction::MultipleChoice { .. }
            )
            | (
                InteractionType::MultipleResponse,
                Interaction::MultipleResponse { .. }
            )
            | (InteractionType::PythonCode, Interaction::PythonCode { .. })
    )
}

fn is_valid_weight(weight: f64) -> bool {
    weight > 0.0 && weight <= 1.0 && weight.is_finite()
}
