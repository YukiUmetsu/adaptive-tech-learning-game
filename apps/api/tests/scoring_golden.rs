//! Cross-language golden scoring fixtures.
//!
//! The same JSON fixtures are exercised by the TypeScript scorer test
//! (`apps/web/src/scoring/scorer.test.ts`). Both implementations must return the
//! same observable result for every case, so scorer drift fails a test instead
//! of silently changing what learners see.

use std::collections::BTreeMap;

use adaptive_learn_api::dto::AnswerPayload;
use adaptive_learn_api::services::to_submitted;
use adaptive_learn_content::{CanonicalAnswer, Interaction, Question, score};
use adaptive_learn_domain::{AssessmentMode, InteractionType};
use serde_json::Value;

const GOLDEN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../apps/web/src/scoring/fixtures/scoring_golden.json"
));

fn build_question(value: &Value) -> Question {
    let interaction: Interaction =
        serde_json::from_value(value["interaction"].clone()).expect("fixture interaction");
    let canonical_answer: CanonicalAnswer =
        serde_json::from_value(value["canonical_answer"].clone())
            .expect("fixture canonical answer");

    Question {
        id: value["id"].as_str().unwrap_or("fixture").to_owned(),
        content_version: "fixture-v1".to_owned(),
        certification_version: "fixture".to_owned(),
        domain_id: "domain-1".to_owned(),
        task_id: "1.1".to_owned(),
        assessment_mode: AssessmentMode::Recognition,
        // Interaction type is not read by the scorer; the interaction itself
        // drives dispatch. Any valid enum value is fine here.
        interaction_type: InteractionType::Classification,
        difficulty_prior: 0.5,
        pedagogy: None,
        prompt: "fixture".to_owned(),
        instruction: None,
        interaction,
        canonical_answer,
        concepts: Vec::new(),
        explanation: value["explanation"].as_str().unwrap_or_default().to_owned(),
        choice_feedback: BTreeMap::new(),
        blueprint_skill_ids: Vec::new(),
        difficulty_label: None,
        hints: Vec::new(),
        error_codes: Vec::new(),
        source_refs: Vec::new(),
    }
}

#[test]
fn golden_fixtures_match_rust_scorer() {
    let document: Value = serde_json::from_str(GOLDEN).expect("golden fixtures are valid json");
    let cases = document["cases"].as_array().expect("cases array");
    assert!(!cases.is_empty(), "golden fixtures must not be empty");

    let mut scored_cases = 0_usize;
    for case in cases {
        let id = case["id"].as_str().expect("case id");
        let question = build_question(&case["question"]);
        let answer: AnswerPayload =
            serde_json::from_value(case["answer"].clone()).expect("fixture answer payload");

        let outcome = to_submitted(answer)
            .map_err(|error| error.code().to_owned())
            .and_then(|submitted| {
                score(&question, &submitted).map_err(|error| error.code().to_owned())
            });

        if let Some(expected_error) = case.get("expected_error").and_then(Value::as_str) {
            match outcome {
                Ok(_) => {
                    panic!("case {id}: expected error {expected_error}, but scoring succeeded")
                }
                Err(code) => assert_eq!(code, expected_error, "case {id} error code"),
            }
            continue;
        }

        scored_cases += 1;
        let scored = outcome.unwrap_or_else(|code| panic!("case {id}: unexpected error {code}"));
        let expected = &case["expected"];
        let expected_score = expected["score"].as_f64().expect("expected score");
        let expected_correct = expected["correct"].as_bool().expect("expected correct");
        let expected_codes: Vec<String> = expected["error_codes"]
            .as_array()
            .expect("expected error codes")
            .iter()
            .map(|code| code.as_str().expect("error code").to_owned())
            .collect();

        assert_eq!(scored.correct, expected_correct, "case {id} correct");
        assert!(
            (scored.score - expected_score).abs() < 1e-9,
            "case {id} score {} != {expected_score}",
            scored.score
        );
        assert_eq!(scored.error_codes, expected_codes, "case {id} error codes");
    }

    assert!(scored_cases > 0, "fixtures must include scored cases");
}
