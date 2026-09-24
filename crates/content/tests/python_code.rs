//! Schema, validation, and scoring coverage for the browser-executed
//! `python_code` interaction.
//!
//! These tests build bundles in memory so they do not depend on which authored
//! Python Fluency files happen to be embedded in a given working tree.

use adaptive_learn_content::{
    CanonicalAnswer, ContentBundle, Interaction, PythonTest, ScoringError, SubmittedAnswer, score,
    validate,
};
use serde_json::{Value, json};

/// A minimal, valid single-question bundle for a `python_code` exercise.
fn python_code_bundle(question_patch: Value) -> Value {
    let mut question = json!({
        "id": "pc-test-001",
        "content_version": "python-code-test-v1",
        "certification_version": "pc-test",
        "domain_id": "domain-1",
        "task_id": "1.1",
        "assessment_mode": "application",
        "interaction_type": "python_code",
        "difficulty_prior": 0.3,
        "prompt": "Return the square of x.",
        "interaction": {
            "type": "python_code",
            "language": "python",
            "entrypoint": "square",
            "starter_code": "def square(x):\n    pass\n",
        },
        "canonical_answer": {
            "type": "python_code",
            "tests": [
                { "type": "call", "args": [2], "expected": 4 },
                { "type": "call", "args": [0], "expected": 0 }
            ]
        },
        "concepts": [{ "concept_id": "test.functions", "weight": 1.0 }],
        "explanation": "Return x * x.",
        "hints": [],
        "error_codes": [
            { "code": "python_tests_failed", "description": "A test did not pass." }
        ],
        "source_refs": [
            { "title": "Python docs", "url": "https://docs.python.org/3/" }
        ]
    });

    if let Some(patch) = question_patch.as_object() {
        for (key, value) in patch {
            question[key] = value.clone();
        }
    }

    json!({
        "certification": {
            "id": "pc-test",
            "vendor": "Test Vendor",
            "name": "Python Code Test",
            "exam_code": "PC-TEST",
            "official_source_url": "https://docs.python.org/3/",
            "last_reviewed": "2026-09-22"
        },
        "version": {
            "id": "pc-test",
            "exam_code": "PC-TEST",
            "effective_date": "2026-09-22",
            "content_version": "python-code-test-v1",
            "domains": [
                {
                    "id": "domain-1",
                    "name": "Functions",
                    "weight": 1.0,
                    "tasks": [
                        { "id": "1.1", "name": "Write functions", "question_ids": ["pc-test-001"] }
                    ]
                }
            ]
        },
        "concepts": [
            { "id": "test.functions", "name": "Functions", "description": "Writing functions." }
        ],
        "questions": [question]
    })
}

fn validated(value: &Value) -> Result<(), Vec<adaptive_learn_content::ContentError>> {
    let bundle: ContentBundle = serde_json::from_value(value.clone()).expect("bundle deserializes");
    validate(&bundle)
}

fn bundle(value: &Value) -> ContentBundle {
    serde_json::from_value(value.clone()).expect("bundle deserializes")
}

fn question(value: &Value) -> adaptive_learn_content::Question {
    bundle(value)
        .questions
        .into_iter()
        .next()
        .expect("question")
}

#[test]
fn authored_python_code_content_is_valid_and_executable() {
    let source = adaptive_learn_content::EMBEDDED_SOURCES
        .iter()
        .find(|source| source.path.ends_with("python-fluency-python-code.json"))
        .expect("authored python_code content is embedded");
    let bundle: ContentBundle =
        serde_json::from_str(source.json).expect("authored python_code content is valid json");
    validate(&bundle).expect("authored python_code content validates");

    assert!(!bundle.questions.is_empty());
    for question in &bundle.questions {
        assert!(
            matches!(&question.interaction, Interaction::PythonCode { .. }),
            "{} must be a python_code interaction",
            question.id
        );
        let CanonicalAnswer::PythonCode { tests } = &question.canonical_answer else {
            panic!("{} must have python_code tests", question.id);
        };
        assert!(!tests.is_empty(), "{} must have tests", question.id);
    }

    let square = bundle
        .questions
        .iter()
        .find(|question| question.id == "pypc-square-exec-001")
        .expect("the square exercise is authored");
    assert!(matches!(
        &square.interaction,
        Interaction::PythonCode { entrypoint, .. } if entrypoint == "square"
    ));
}

#[test]
fn python_code_bundle_validates_and_round_trips() {
    let value = python_code_bundle(json!({}));
    validated(&value).expect("valid python_code bundle");

    let question = question(&value);
    assert!(matches!(
        &question.interaction,
        Interaction::PythonCode {
            entrypoint,
            ..
        } if entrypoint == "square"
    ));
    assert!(matches!(
        &question.canonical_answer,
        CanonicalAnswer::PythonCode { tests } if tests.len() == 2
    ));

    // Serialization keeps the tagged discriminators the web client reads.
    let serialized = serde_json::to_value(&question).expect("serializes");
    assert_eq!(serialized["interaction"]["type"], "python_code");
    assert_eq!(serialized["canonical_answer"]["type"], "python_code");
    assert_eq!(serialized["interaction"]["language"], "python");
    assert_eq!(serialized["canonical_answer"]["tests"][0]["type"], "call");
}

#[test]
fn python_code_accepts_raises_and_stdout_tests() {
    let value = python_code_bundle(json!({
        "interaction": {
            "type": "python_code",
            "language": "python",
            "entrypoint": "convert",
            "starter_code": "def convert(value):\n    pass\n",
        },
        "canonical_answer": {
            "type": "python_code",
            "tests": [
                { "type": "raises", "args": ["nope"], "exception": "ValueError" },
                { "type": "stdout", "expected": "done" }
            ]
        }
    }));
    validated(&value).expect("raises/stdout tests validate");
}

#[test]
fn python_code_rejects_non_python_language() {
    let value = python_code_bundle(json!({
        "interaction": {
            "type": "python_code",
            "language": "javascript",
            "entrypoint": "square",
            "starter_code": "function square() {}\n",
        }
    }));
    let errors = validated(&value).expect_err("language rejected");
    assert!(
        errors
            .iter()
            .any(|e| e.code == "python_code_language_unsupported")
    );
}

#[test]
fn python_code_rejects_invalid_entrypoint() {
    let value = python_code_bundle(json!({
        "interaction": {
            "type": "python_code",
            "language": "python",
            "entrypoint": "not valid!",
            "starter_code": "x = 1\n",
        }
    }));
    let errors = validated(&value).expect_err("entrypoint rejected");
    assert!(
        errors
            .iter()
            .any(|e| e.code == "python_code_entrypoint_invalid")
    );
}

#[test]
fn python_code_rejects_call_tests_without_an_entrypoint() {
    let value = python_code_bundle(json!({
        "interaction": {
            "type": "python_code",
            "language": "python",
            "entrypoint": "",
            "starter_code": "x = 1\n",
        }
    }));
    let errors = validated(&value).expect_err("entrypoint required");
    assert!(
        errors
            .iter()
            .any(|e| e.code == "python_code_entrypoint_missing")
    );
}

#[test]
fn python_code_rejects_empty_tests() {
    let value = python_code_bundle(json!({
        "canonical_answer": { "type": "python_code", "tests": [] }
    }));
    let errors = validated(&value).expect_err("tests required");
    assert!(errors.iter().any(|e| e.code == "python_code_tests_missing"));
}

#[test]
fn python_code_accepts_allowlisted_packages() {
    let value = python_code_bundle(json!({
        "interaction": {
            "type": "python_code",
            "language": "python",
            "entrypoint": "square",
            "starter_code": "def square(x):\n    pass\n",
            "packages": ["numpy", "pandas", "matplotlib"],
        }
    }));
    validated(&value).expect("allowlisted packages are accepted");
}

#[test]
fn python_code_rejects_unknown_packages() {
    // `seaborn` is not shipped by the pinned Pyodide build, so it is not
    // allowed; enabling it would require fetching a wheel from PyPI.
    let value = python_code_bundle(json!({
        "interaction": {
            "type": "python_code",
            "language": "python",
            "entrypoint": "square",
            "starter_code": "def square(x):\n    pass\n",
            "packages": ["seaborn"],
        }
    }));
    let errors = validated(&value).expect_err("package rejected");
    assert!(
        errors
            .iter()
            .any(|e| e.code == "python_code_package_not_allowed")
    );
}

#[test]
fn python_code_rejects_too_many_packages() {
    let value = python_code_bundle(json!({
        "interaction": {
            "type": "python_code",
            "language": "python",
            "entrypoint": "square",
            "starter_code": "def square(x):\n    pass\n",
            "packages": ["numpy", "pandas", "matplotlib", "numpy", "pandas"],
        }
    }));
    let errors = validated(&value).expect_err("too many packages");
    assert!(
        errors
            .iter()
            .any(|e| e.code == "python_code_packages_too_many")
    );
}

#[test]
fn python_code_scoring_uses_reported_test_counts() {
    let value = python_code_bundle(json!({}));
    let question = question(&value);

    let perfect = score(
        &question,
        &SubmittedAnswer::PythonCode {
            passed: 2,
            total: 2,
        },
    )
    .expect("perfect score");
    assert!(perfect.correct);
    assert_eq!(perfect.score, 1.0);
    assert!(perfect.error_codes.is_empty());

    let partial = score(
        &question,
        &SubmittedAnswer::PythonCode {
            passed: 1,
            total: 2,
        },
    )
    .expect("partial score");
    assert!(!partial.correct);
    assert_eq!(partial.score, 0.5);
    assert_eq!(partial.error_codes, vec!["python_tests_failed".to_owned()]);
}

#[test]
fn python_code_scoring_rejects_inconsistent_counts() {
    let value = python_code_bundle(json!({}));
    let question = question(&value);

    let mismatch = score(
        &question,
        &SubmittedAnswer::PythonCode {
            passed: 5,
            total: 5,
        },
    )
    .expect_err("total must match authored test count");
    assert_eq!(mismatch.code(), "python_test_count_mismatch");

    let impossible = score(
        &question,
        &SubmittedAnswer::PythonCode {
            passed: 3,
            total: 2,
        },
    )
    .expect_err("passed cannot exceed total");
    assert_eq!(impossible.code(), "python_result_invalid");
}

#[test]
fn python_code_rejects_a_non_python_submission() {
    let value = python_code_bundle(json!({}));
    let question = question(&value);

    let error = score(&question, &SubmittedAnswer::Ordering(vec![])).expect_err("mismatch");
    assert_eq!(error, ScoringError::InteractionMismatch);
}

#[test]
fn python_test_enum_carries_structured_values() {
    let test: PythonTest = serde_json::from_value(json!({
        "type": "call",
        "args": [1, [2, 3], { "k": "v" }],
        "expected": [true, null]
    }))
    .expect("deserializes structured test");
    match test {
        PythonTest::Call { args, expected } => {
            assert_eq!(args.len(), 3);
            assert_eq!(expected, json!([true, null]));
        }
        other => panic!("expected call test, got {other:?}"),
    }
}
