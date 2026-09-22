//! Practice-test (exam simulation) API coverage.
//!
//! These endpoints are read-only content plus a pure server-side scorer, so
//! they run without a database.

mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

use adaptive_learn_content::{CanonicalAnswer, Question};

const CERTIFICATION: &str = "aws-soa-c03";
const PRACTICE_TEST: &str = "aws-soa-c03-practice-test-1";

fn practice_test() -> adaptive_learn_content::PracticeTest {
    common::content()
        .practice_test(PRACTICE_TEST)
        .expect("practice test is embedded")
        .clone()
}

/// Builds the correctly-shaped answer payload for a question.
fn correct_answer(question: &Question) -> Value {
    match &question.canonical_answer {
        CanonicalAnswer::MultipleChoice { choice_id } => json!({ "choice_id": choice_id }),
        CanonicalAnswer::MultipleResponse { choice_ids } => json!({ "choice_ids": choice_ids }),
        CanonicalAnswer::PythonCode { tests } => json!({
            "python_results": { "passed": tests.len(), "total": tests.len() }
        }),
        other => panic!("unexpected practice-test interaction: {other:?}"),
    }
}

#[tokio::test]
async fn list_returns_the_authored_practice_test() {
    let app = common::app_without_database();
    let (status, body) = common::send_anonymous(
        app,
        "GET",
        &format!("/v1/certifications/{CERTIFICATION}/practice-tests"),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let tests = body["practice_tests"]
        .as_array()
        .expect("practice_tests array");
    assert_eq!(tests.len(), 1);
    assert_eq!(tests[0]["id"], PRACTICE_TEST);
    assert_eq!(tests[0]["question_count"], 65);
    assert_eq!(tests[0]["scored_question_count"], 50);
    assert_eq!(tests[0]["time_limit_minutes"], 130);
}

#[tokio::test]
async fn get_returns_learner_safe_content_without_answers() {
    let app = common::app_without_database();
    let (status, body) = common::send_anonymous(
        app,
        "GET",
        &format!("/v1/certifications/{CERTIFICATION}/practice-tests/{PRACTICE_TEST}"),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["items"].as_array().expect("items").len(), 65);

    // The response must not leak the answer key, per-choice feedback, or which
    // items are unscored.
    let serialized = body.to_string();
    for forbidden in [
        "\"canonical_answer\"",
        "\"choice_feedback\"",
        "\"is_scored\"",
        "\"explanation\"",
    ] {
        assert!(
            !serialized.contains(forbidden),
            "learner-safe payload leaked {forbidden}"
        );
    }

    // The instruction is learner-safe and is present on the first item.
    assert_eq!(body["items"][0]["question"]["instruction"], "Choose ONE.");

    // Hints are withheld before submission, even though the general adaptive
    // question view exposes them.
    assert_eq!(
        body["items"][0]["question"]["hints"]
            .as_array()
            .expect("hints array")
            .len(),
        0
    );
}

#[tokio::test]
async fn unknown_practice_test_is_not_found() {
    let app = common::app_without_database();
    let (status, _) = common::send_anonymous(
        app,
        "GET",
        &format!("/v1/certifications/{CERTIFICATION}/practice-tests/does-not-exist"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_perfect_submission_scores_only_scored_items() {
    let test = practice_test();
    let answers: Vec<Value> = test
        .items
        .iter()
        .map(|item| {
            json!({
                "question_id": item.question.id,
                "answer": correct_answer(&item.question),
            })
        })
        .collect();

    let app = common::app_without_database();
    let (status, body) = common::send_anonymous(
        app,
        "POST",
        &format!("/v1/certifications/{CERTIFICATION}/practice-tests/{PRACTICE_TEST}/submit"),
        Some(json!({ "answers": answers })),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total_questions"], 65);
    assert_eq!(body["scored_question_count"], 50);
    assert_eq!(body["correct_count"], 50);
    assert_eq!(body["answered_count"], 65);
    assert_eq!(body["unanswered_count"], 0);
    assert!((body["raw_accuracy"].as_f64().unwrap() - 1.0).abs() < 1e-9);
    assert!(body["score_note"].as_str().unwrap().contains("not"));

    // Review information is available after submission.
    let first = &body["questions"][0];
    assert!(first["canonical_answer"].is_object());
    assert!(first["choice_feedback"].is_object());
    assert!(first["is_scored"].is_boolean());

    // Domain statistics cover scored items only and sum to the scored count.
    let domains = body["domain_breakdown"].as_array().expect("domains");
    let scored_total: i64 = domains
        .iter()
        .map(|domain| domain["scored_count"].as_i64().unwrap())
        .sum();
    assert_eq!(scored_total, 50);
    assert_eq!(domains.len(), 5);
}

#[tokio::test]
async fn unanswered_items_are_reported_and_do_not_hurt_the_score() {
    let test = practice_test();
    // Submit only the first item correctly; the rest are left unanswered.
    let first = &test.items[0];
    let body = json!({
        "answers": [{
            "question_id": first.question.id,
            "answer": correct_answer(&first.question),
        }]
    });

    let app = common::app_without_database();
    let (status, body) = common::send_anonymous(
        app,
        "POST",
        &format!("/v1/certifications/{CERTIFICATION}/practice-tests/{PRACTICE_TEST}/submit"),
        Some(body),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["answered_count"], 1);
    assert_eq!(body["unanswered_count"], 64);
    assert_eq!(body["correct_count"], 1);
    assert_eq!(body["scored_question_count"], 50);
    assert!(!body["questions"][1]["answered"].as_bool().unwrap());
}

#[tokio::test]
async fn unknown_and_duplicate_question_ids_are_rejected() {
    let test = practice_test();
    let first = &test.items[0];

    let app = common::app_without_database();
    let (unknown_status, _) = common::send_anonymous(
        app.clone(),
        "POST",
        &format!("/v1/certifications/{CERTIFICATION}/practice-tests/{PRACTICE_TEST}/submit"),
        Some(json!({
            "answers": [{
                "question_id": "not-a-question",
                "answer": { "choice_id": "A" },
            }]
        })),
    )
    .await;
    assert_eq!(unknown_status, StatusCode::BAD_REQUEST);

    let answer = correct_answer(&first.question);
    let (duplicate_status, _) = common::send_anonymous(
        app,
        "POST",
        &format!("/v1/certifications/{CERTIFICATION}/practice-tests/{PRACTICE_TEST}/submit"),
        Some(json!({
            "answers": [
                { "question_id": first.question.id, "answer": answer.clone() },
                { "question_id": first.question.id, "answer": answer.clone() },
            ]
        })),
    )
    .await;
    assert_eq!(duplicate_status, StatusCode::BAD_REQUEST);
}
