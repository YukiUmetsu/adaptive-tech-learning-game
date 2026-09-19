//! Deserialization, validation, and scoring coverage for the Phase A
//! interaction families, exercised against the embedded demo bundle.
//!
//! The demo bundle is discovered at build time like every other bundle, so these
//! tests also prove that dynamic content loading works for the new types.

use adaptive_learn_content::{
    CanonicalAnswer, ContentBundle, ContentError, ContentRegistry, Interaction, PlacementPoint,
    ScoringError, SubmittedAnswer, score, validate,
};
use serde_json::Value;

fn interaction_kind(interaction: &Interaction) -> &'static str {
    match interaction {
        Interaction::Classification { .. } => "classification",
        Interaction::Ordering { .. } => "ordering",
        Interaction::NodeConnection { .. } => "node_connection",
        Interaction::Reconstruction { .. } => "reconstruction",
        Interaction::EvidenceSelection { .. } => "evidence_selection",
        Interaction::SpotTheFault { .. } => "spot_the_fault",
        Interaction::FillSlots { .. } => "fill_slots",
        Interaction::Troubleshooting { .. } => "troubleshooting",
        Interaction::ScenarioChoiceChain { .. } => "scenario_choice_chain",
        Interaction::ConfigurationBuilder { .. } => "configuration_builder",
        Interaction::TwoDimensionalPlacement { .. } => "two_dimensional_placement",
        Interaction::CommandAssembly { .. } => "command_assembly",
        Interaction::TypedFillBlank { .. } => "typed_fill_blank",
    }
}

fn canonical_kind(answer: &CanonicalAnswer) -> &'static str {
    match answer {
        CanonicalAnswer::Classification { .. } => "classification",
        CanonicalAnswer::Ordering { .. } => "ordering",
        CanonicalAnswer::NodeConnection { .. } => "node_connection",
        CanonicalAnswer::Reconstruction { .. } => "reconstruction",
        CanonicalAnswer::EvidenceSelection { .. } => "evidence_selection",
        CanonicalAnswer::SpotTheFault { .. } => "spot_the_fault",
        CanonicalAnswer::FillSlots { .. } => "fill_slots",
        CanonicalAnswer::Troubleshooting { .. } => "troubleshooting",
        CanonicalAnswer::ScenarioChoiceChain { .. } => "scenario_choice_chain",
        CanonicalAnswer::ConfigurationBuilder { .. } => "configuration_builder",
        CanonicalAnswer::TwoDimensionalPlacement { .. } => "two_dimensional_placement",
        CanonicalAnswer::CommandAssembly { .. } => "command_assembly",
        CanonicalAnswer::TypedFillBlank { .. } => "typed_fill_blank",
    }
}

fn demo_source() -> &'static str {
    adaptive_learn_content::EMBEDDED_SOURCES
        .iter()
        .copied()
        .find(|source| source.contains("\"aws-soa-c03-demo\""))
        .expect("demo bundle is embedded")
}

fn demo_value() -> Value {
    serde_json::from_str(demo_source()).expect("demo bundle is valid json")
}

fn demo_registry() -> ContentRegistry {
    ContentRegistry::embedded().expect("embedded content is valid")
}

fn demo_question(id: &str) -> adaptive_learn_content::Question {
    demo_registry()
        .question("soa-c03-demo", id)
        .expect("demo question exists")
        .clone()
}

fn validate_value(value: &Value) -> Result<(), Vec<ContentError>> {
    let bundle: ContentBundle =
        serde_json::from_value(value.clone()).expect("mutation remains deserializable");
    validate(&bundle)
}

fn expect_error(value: &Value, code: &str) {
    let errors = validate_value(value).expect_err("mutation must be rejected");
    assert!(
        errors.iter().any(|error| error.code == code),
        "expected error {code}, got {errors:?}"
    );
}

fn question_index(value: &Value, id: &str) -> usize {
    value["questions"]
        .as_array()
        .expect("questions array")
        .iter()
        .position(|question| question["id"] == id)
        .expect("question is present")
}

#[test]
fn demo_bundle_deserializes_into_typed_interactions() {
    let value = demo_value();
    let bundle: ContentBundle = serde_json::from_value(value.clone()).expect("deserializes");

    let expected = [
        ("demo-reconstruction-cloudwatch-001", "reconstruction"),
        ("demo-reconstruction-nat-001", "reconstruction"),
        ("demo-reconstruction-alarm-graph-001", "reconstruction"),
        ("demo-evidence-cloudtrail-001", "evidence_selection"),
        ("demo-evidence-vpc-001", "evidence_selection"),
        ("demo-fault-route-001", "spot_the_fault"),
        ("demo-fault-alb-001", "spot_the_fault"),
        ("demo-fill-route-001", "fill_slots"),
        ("demo-fill-cloudwatch-001", "fill_slots"),
        ("demo-troubleshooting-alb-001", "troubleshooting"),
        ("demo-scenario-alarm-001", "scenario_choice_chain"),
        ("demo-config-nat-001", "configuration_builder"),
        ("demo-command-presign-001", "command_assembly"),
        ("demo-placement-dr-001", "two_dimensional_placement"),
        ("demo-typed-deny-001", "typed_fill_blank"),
        ("demo-typed-sg-nacl-001", "typed_fill_blank"),
        ("demo-typed-sqs-001", "typed_fill_blank"),
    ];

    for (id, kind) in expected {
        let question = bundle
            .questions
            .iter()
            .find(|question| question.id == id)
            .expect("question exists");

        assert_eq!(
            interaction_kind(&question.interaction),
            kind,
            "question {id} interaction variant"
        );
        assert_eq!(
            canonical_kind(&question.canonical_answer),
            kind,
            "question {id} canonical variant"
        );

        // The typed enums must round-trip through JSON without loss.
        let encoded = serde_json::to_value(&question.interaction).expect("serialize interaction");
        let decoded: Interaction =
            serde_json::from_value(encoded).expect("deserialize interaction");
        assert_eq!(decoded, question.interaction);

        let encoded = serde_json::to_value(&question.canonical_answer).expect("serialize answer");
        let decoded: CanonicalAnswer = serde_json::from_value(encoded).expect("deserialize answer");
        assert_eq!(decoded, question.canonical_answer);
    }
}

#[test]
fn reconstruction_scores_slot_placements() {
    let question = demo_question("demo-reconstruction-nat-001");

    let correct = score(
        &question,
        &SubmittedAnswer::Reconstruction {
            placements: [
                ("slot_1".to_owned(), "route_table".to_owned()),
                ("slot_2".to_owned(), "nat_gateway".to_owned()),
                ("slot_3".to_owned(), "public_subnet".to_owned()),
                ("slot_4".to_owned(), "internet_gateway".to_owned()),
            ]
            .into_iter()
            .collect(),
            edges: Vec::new(),
        },
    )
    .expect("score");
    assert!(correct.correct);
    assert_eq!(correct.score, 1.0);

    // `egress_only_igw` is a plausible distractor and is never used. Placing it
    // instead of the required `public_subnet` is a wrong component, and the
    // final slot is left unfilled.
    let partial = score(
        &question,
        &SubmittedAnswer::Reconstruction {
            placements: [
                ("slot_1".to_owned(), "route_table".to_owned()),
                ("slot_2".to_owned(), "nat_gateway".to_owned()),
                ("slot_3".to_owned(), "egress_only_igw".to_owned()),
            ]
            .into_iter()
            .collect(),
            edges: Vec::new(),
        },
    )
    .expect("score");
    assert!((partial.score - 2.0 / 4.0).abs() < 1e-9);
    assert!(
        partial
            .error_codes
            .contains(&"reconstruction_wrong_component".to_owned())
    );
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
}

#[test]
fn graph_reconstruction_scores_placements_and_edges() {
    let question = demo_question("demo-reconstruction-alarm-graph-001");

    let placements: std::collections::BTreeMap<String, String> = [
        ("sns_slot".to_owned(), "sns_topic".to_owned()),
        ("operator_slot".to_owned(), "operator".to_owned()),
        ("eventbridge_slot".to_owned(), "eventbridge".to_owned()),
    ]
    .into_iter()
    .collect();

    let perfect = score(
        &question,
        &SubmittedAnswer::Reconstruction {
            placements: placements.clone(),
            edges: vec![
                ("alarm".to_owned(), "sns_topic".to_owned()),
                ("sns_topic".to_owned(), "operator".to_owned()),
                ("alarm".to_owned(), "eventbridge".to_owned()),
            ],
        },
    )
    .expect("score");
    assert!(perfect.correct);
    assert!((perfect.score - 1.0).abs() < 1e-9);

    // Correct placements without topology lose only the edge weight.
    let placements_only = score(
        &question,
        &SubmittedAnswer::Reconstruction {
            placements,
            edges: Vec::new(),
        },
    )
    .expect("score");
    assert!((placements_only.score - 0.7).abs() < 1e-9);
    assert!(
        placements_only
            .error_codes
            .contains(&"reconstruction_missing_relationship".to_owned())
    );
}

#[test]
fn evidence_selection_rewards_relevance_and_penalizes_noise() {
    let question = demo_question("demo-evidence-vpc-001");

    let perfect = score(
        &question,
        &SubmittedAnswer::EvidenceSelection(vec![
            "vpc_flow_logs".to_owned(),
            "security_group_rules".to_owned(),
            "route_tables".to_owned(),
        ]),
    )
    .expect("score");
    assert!(perfect.correct);
    assert_eq!(perfect.score, 1.0);

    let noisy = score(
        &question,
        &SubmittedAnswer::EvidenceSelection(vec![
            "vpc_flow_logs".to_owned(),
            "cpu_utilization".to_owned(),
        ]),
    )
    .expect("score");
    // (1 hit - 1 false positive) / 3 relevant = 0.
    assert_eq!(noisy.score, 0.0);
    assert!(
        noisy
            .error_codes
            .contains(&"evidence_selected_irrelevant".to_owned())
    );
    assert!(
        noisy
            .error_codes
            .contains(&"evidence_missing_relevant".to_owned())
    );
}

#[test]
fn spot_the_fault_penalizes_false_positives() {
    let question = demo_question("demo-fault-alb-001");

    let correct = score(
        &question,
        &SubmittedAnswer::SpotTheFault(vec!["health_check_path".to_owned()]),
    )
    .expect("score");
    assert!(correct.correct);

    let overreach = score(
        &question,
        &SubmittedAnswer::SpotTheFault(vec!["health_check_path".to_owned(), "listener".to_owned()]),
    )
    .expect("score");
    assert_eq!(overreach.score, 0.0);
    assert_eq!(overreach.error_codes, vec!["fault_false_positive"]);
}

#[test]
fn fill_slots_gives_slot_by_slot_credit() {
    let question = demo_question("demo-fill-route-001");

    let partial = score(
        &question,
        &SubmittedAnswer::FillSlots(
            [
                ("destination".to_owned(), "all_ipv4".to_owned()),
                ("target".to_owned(), "internet_gateway".to_owned()),
            ]
            .into_iter()
            .collect(),
        ),
    )
    .expect("score");

    assert_eq!(partial.score, 1.0 / 3.0);
    assert!(partial.error_codes.contains(&"slot_incorrect".to_owned()));
    assert!(partial.error_codes.contains(&"slot_unfilled".to_owned()));
}

#[test]
fn troubleshooting_scores_path_quality() {
    let question = demo_question("demo-troubleshooting-alb-001");

    let perfect = score(
        &question,
        &SubmittedAnswer::Branching(vec![
            "check_target_health".to_owned(),
            "fix_health_path".to_owned(),
        ]),
    )
    .expect("score");
    assert!(perfect.correct);
    assert_eq!(perfect.score, 1.0);

    let wrong = score(
        &question,
        &SubmittedAnswer::Branching(vec!["check_rds_metrics".to_owned()]),
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

    // A choice that is not available at the start step is a malformed path.
    assert_eq!(
        score(
            &question,
            &SubmittedAnswer::Branching(vec!["fix_health_path".to_owned()])
        ),
        Err(ScoringError::InvalidScenarioPath)
    );
}

#[test]
fn scenario_choice_chain_scores_path_quality() {
    let question = demo_question("demo-scenario-alarm-001");

    let perfect = score(
        &question,
        &SubmittedAnswer::Branching(vec!["inspect_metric".to_owned(), "scale_out".to_owned()]),
    )
    .expect("score");
    assert!(perfect.correct);

    let wrong = score(
        &question,
        &SubmittedAnswer::Branching(vec![
            "inspect_metric".to_owned(),
            "disable_alarm".to_owned(),
        ]),
    )
    .expect("score");
    assert_eq!(wrong.score, 0.0);
    assert!(
        wrong
            .error_codes
            .contains(&"scenario_choice_wrong_next_action".to_owned())
    );
}

#[test]
fn configuration_builder_scores_roles() {
    let question = demo_question("demo-config-nat-001");

    let perfect = score(
        &question,
        &SubmittedAnswer::ConfigurationBuilder(
            [
                ("private_route_target".to_owned(), "nat_gateway".to_owned()),
                ("nat_host_subnet".to_owned(), "public_subnet".to_owned()),
                (
                    "public_route_target".to_owned(),
                    "internet_gateway".to_owned(),
                ),
            ]
            .into_iter()
            .collect(),
        ),
    )
    .expect("score");
    assert!(perfect.correct);
    assert_eq!(perfect.score, 1.0);

    let unnecessary = score(
        &question,
        &SubmittedAnswer::ConfigurationBuilder(
            [
                ("private_route_target".to_owned(), "nat_gateway".to_owned()),
                ("nat_host_subnet".to_owned(), "public_subnet".to_owned()),
                (
                    "public_route_target".to_owned(),
                    "egress_only_igw".to_owned(),
                ),
            ]
            .into_iter()
            .collect(),
        ),
    )
    .expect("score");
    assert_eq!(unnecessary.score, 1.0 / 3.0);
    assert!(
        unnecessary
            .error_codes
            .contains(&"config_unnecessary_component".to_owned())
    );
}

#[test]
fn two_dimensional_placement_scores_tolerantly() {
    let question = demo_question("demo-placement-dr-001");
    let point = |x: f64, y: f64| PlacementPoint { x, y };

    let perfect = score(
        &question,
        &SubmittedAnswer::TwoDimensionalPlacement(
            [
                ("backup_restore".to_owned(), point(0.1, 0.1)),
                ("pilot_light".to_owned(), point(0.35, 0.35)),
                ("warm_standby".to_owned(), point(0.6, 0.6)),
                ("multi_site".to_owned(), point(0.9, 0.9)),
            ]
            .into_iter()
            .collect(),
        ),
    )
    .expect("score");
    assert!(perfect.correct);
    assert_eq!(perfect.score, 1.0);

    let wrong_axis = score(
        &question,
        &SubmittedAnswer::TwoDimensionalPlacement(
            [
                ("backup_restore".to_owned(), point(0.9, 0.1)),
                ("pilot_light".to_owned(), point(0.35, 0.35)),
                ("warm_standby".to_owned(), point(0.6, 0.6)),
                ("multi_site".to_owned(), point(0.9, 0.9)),
            ]
            .into_iter()
            .collect(),
        ),
    )
    .expect("score");
    assert_eq!(wrong_axis.score, 7.0 / 8.0);
    assert!(
        wrong_axis
            .error_codes
            .contains(&"placement_wrong_x".to_owned())
    );

    assert_eq!(
        score(
            &question,
            &SubmittedAnswer::TwoDimensionalPlacement(
                [("backup_restore".to_owned(), point(1.4, 0.1))]
                    .into_iter()
                    .collect()
            ),
        ),
        Err(ScoringError::InvalidPlacement)
    );
}

#[test]
fn command_assembly_scores_tokens_and_order() {
    let question = demo_question("demo-command-presign-001");

    let perfect = score(
        &question,
        &SubmittedAnswer::CommandAssembly(
            [
                ("service_action".to_owned(), "s3_presign".to_owned()),
                ("target".to_owned(), "object_uri".to_owned()),
                ("expiry_flag".to_owned(), "expires_in".to_owned()),
                ("expiry_value".to_owned(), "seconds".to_owned()),
            ]
            .into_iter()
            .collect(),
        ),
    )
    .expect("score");
    assert!(perfect.correct);

    let wrong_token = score(
        &question,
        &SubmittedAnswer::CommandAssembly(
            [
                ("service_action".to_owned(), "s3_presign".to_owned()),
                ("target".to_owned(), "object_uri".to_owned()),
                ("expiry_flag".to_owned(), "expires_in".to_owned()),
                ("expiry_value".to_owned(), "recursive".to_owned()),
            ]
            .into_iter()
            .collect(),
        ),
    )
    .expect("score");
    assert_eq!(wrong_token.score, 0.75);
    assert!(
        wrong_token
            .error_codes
            .contains(&"command_token_wrong".to_owned())
    );
}

#[test]
fn typed_fill_blank_scores_all_slots_and_normalizes() {
    let deny = demo_question("demo-typed-deny-001");
    let mut answers = std::collections::BTreeMap::new();
    answers.insert("policy_result".to_owned(), "  DENY. ".to_owned());
    let scored = score(&deny, &SubmittedAnswer::TypedFillBlank(answers)).expect("score");
    assert!(scored.correct);
    assert_eq!(scored.score, 1.0);

    let multi = demo_question("demo-typed-sg-nacl-001");
    let partial = score(
        &multi,
        &SubmittedAnswer::TypedFillBlank(
            [
                ("sg_behavior".to_owned(), "stateful".to_owned()),
                ("nacl_behavior".to_owned(), "statefull".to_owned()),
            ]
            .into_iter()
            .collect(),
        ),
    )
    .expect("score");
    assert!(!partial.correct);
    assert_eq!(partial.score, 0.5);
    assert!(
        partial
            .error_codes
            .contains(&"typed_fill_blank_incorrect".to_owned())
    );

    // SQS must not accept SNS through fuzzy matching.
    let sqs = demo_question("demo-typed-sqs-001");
    let wrong = score(
        &sqs,
        &SubmittedAnswer::TypedFillBlank(
            [("service".to_owned(), "SNS".to_owned())]
                .into_iter()
                .collect(),
        ),
    )
    .expect("score");
    assert_eq!(wrong.score, 0.0);
    assert!(
        wrong
            .error_codes
            .contains(&"typed_fill_blank_incorrect".to_owned())
    );
}

#[test]
fn typed_fill_blank_serializes_with_expected_discriminator() {
    let question = demo_question("demo-typed-sg-nacl-001");
    let interaction = serde_json::to_value(&question.interaction).expect("serialize");
    assert_eq!(interaction["type"], serde_json::json!("typed_fill_blank"));
    assert!(interaction["text"].as_str().is_some());
    assert_eq!(interaction["slots"].as_array().map(Vec::len), Some(2));

    let canonical = serde_json::to_value(&question.canonical_answer).expect("serialize");
    assert_eq!(canonical["type"], serde_json::json!("typed_fill_blank"));

    let decoded: Interaction = serde_json::from_value(interaction).expect("deserialize");
    assert_eq!(decoded, question.interaction);
}

#[test]
fn typed_fill_blank_rejects_unknown_slot_in_submission() {
    let question = demo_question("demo-typed-deny-001");
    assert_eq!(
        score(
            &question,
            &SubmittedAnswer::TypedFillBlank(
                [("ghost".to_owned(), "deny".to_owned())]
                    .into_iter()
                    .collect(),
            ),
        ),
        Err(ScoringError::UnknownSlot("ghost".to_owned()))
    );
}

#[test]
fn malformed_submissions_are_rejected() {
    let reconstruction = demo_question("demo-reconstruction-cloudwatch-001");
    assert_eq!(
        score(
            &reconstruction,
            &SubmittedAnswer::Reconstruction {
                placements: [("slot_1".to_owned(), "ghost".to_owned())]
                    .into_iter()
                    .collect(),
                edges: Vec::new(),
            },
        ),
        Err(ScoringError::UnknownPiece("ghost".to_owned()))
    );
    assert_eq!(
        score(
            &reconstruction,
            &SubmittedAnswer::Reconstruction {
                placements: [("ghost_slot".to_owned(), "cloudwatch_alarm".to_owned())]
                    .into_iter()
                    .collect(),
                edges: Vec::new(),
            },
        ),
        Err(ScoringError::UnknownSlot("ghost_slot".to_owned()))
    );

    let evidence = demo_question("demo-evidence-cloudtrail-001");
    assert_eq!(
        score(
            &evidence,
            &SubmittedAnswer::EvidenceSelection(vec!["ghost".to_owned()]),
        ),
        Err(ScoringError::UnknownEvidence("ghost".to_owned()))
    );

    let fault = demo_question("demo-fault-route-001");
    assert_eq!(
        score(
            &fault,
            &SubmittedAnswer::SpotTheFault(vec!["ghost".to_owned()]),
        ),
        Err(ScoringError::UnknownElement("ghost".to_owned()))
    );

    let fill = demo_question("demo-fill-cloudwatch-001");
    assert_eq!(
        score(
            &fill,
            &SubmittedAnswer::FillSlots(
                [("metric".to_owned(), "ghost".to_owned())]
                    .into_iter()
                    .collect()
            ),
        ),
        Err(ScoringError::UnknownOption("ghost".to_owned()))
    );

    // An answer shape that does not match the interaction is rejected.
    assert_eq!(
        score(
            &reconstruction,
            &SubmittedAnswer::FillSlots(Default::default())
        ),
        Err(ScoringError::InteractionMismatch)
    );
}

#[test]
fn rejects_reconstruction_edge_to_an_unknown_component() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-reconstruction-alarm-graph-001");
    value["questions"][index]["canonical_answer"]["edges"]
        .as_array_mut()
        .expect("edges")
        .push(Value::from(vec!["sns_topic", "cloudtrail"]));

    expect_error(&value, "canonical_edge_unknown_component");
}

#[test]
fn rejects_canonical_reconstruction_missing_slot() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-reconstruction-cloudwatch-001");
    value["questions"][index]["canonical_answer"]["placements"]
        .as_object_mut()
        .expect("placements")
        .remove("slot_2");

    expect_error(&value, "canonical_reconstruction_slots_incomplete");
}

#[test]
fn rejects_canonical_reconstruction_unknown_piece() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-reconstruction-cloudwatch-001");
    value["questions"][index]["canonical_answer"]["placements"]["slot_1"] =
        Value::from("ghost_piece");

    expect_error(&value, "canonical_unknown_piece");
}

#[test]
fn rejects_linear_reconstruction_with_edges() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-reconstruction-cloudwatch-001");
    value["questions"][index]["canonical_answer"]["edges"] =
        Value::from(vec![vec!["cloudwatch_alarm", "sns_topic"]]);

    expect_error(&value, "canonical_edges_not_allowed_for_linear");
}

#[test]
fn rejects_graph_slot_without_a_position() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-reconstruction-alarm-graph-001");
    value["questions"][index]["interaction"]["slots"][0]
        .as_object_mut()
        .expect("slot")
        .remove("x");

    expect_error(&value, "invalid_slot_position");
}

#[test]
fn rejects_graph_fixed_node_without_a_position() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-reconstruction-alarm-graph-001");
    value["questions"][index]["interaction"]["fixed_nodes"][0]
        .as_object_mut()
        .expect("fixed node")
        .remove("y");

    expect_error(&value, "invalid_fixed_node_position");
}

#[test]
fn rejects_evidence_id_that_is_not_an_option() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-evidence-cloudtrail-001");
    value["questions"][index]["canonical_answer"]["relevant_ids"] =
        Value::from(vec!["not_an_option"]);

    expect_error(&value, "canonical_unknown_evidence");
}

#[test]
fn rejects_faulty_id_that_is_not_an_element() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-fault-route-001");
    value["questions"][index]["canonical_answer"]["faulty_ids"] =
        Value::from(vec!["not_an_element"]);

    expect_error(&value, "canonical_unknown_element");
}

#[test]
fn rejects_fill_value_that_is_not_an_option() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-fill-route-001");
    value["questions"][index]["canonical_answer"]["values"]["target"] =
        Value::from("not_an_option");

    expect_error(&value, "canonical_unknown_option");
}

#[test]
fn rejects_missing_fill_slot_value() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-fill-route-001");
    value["questions"][index]["canonical_answer"]["values"]
        .as_object_mut()
        .expect("values")
        .remove("association");

    expect_error(&value, "canonical_slots_incomplete");
}

#[test]
fn rejects_reconstruction_self_loop() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-reconstruction-alarm-graph-001");
    value["questions"][index]["canonical_answer"]["edges"]
        .as_array_mut()
        .expect("edges")
        .push(Value::from(vec!["sns_topic", "sns_topic"]));

    expect_error(&value, "canonical_edge_self_loop");
}

#[test]
fn demo_piece_labels_do_not_reveal_the_answer() {
    let value = demo_value();
    let questions = value["questions"].as_array().expect("questions array");

    for question in questions {
        if question["interaction_type"] != "reconstruction" {
            continue;
        }
        let pieces = question["interaction"]["pieces"]
            .as_array()
            .expect("reconstruction pieces");
        for piece in pieces {
            let label = piece["label"].as_str().expect("piece label").to_lowercase();
            for forbidden in ["distractor", "correct", "incorrect", "wrong", "answer"] {
                assert!(
                    !label.contains(forbidden),
                    "piece label {label:?} reveals {forbidden:?}"
                );
            }
        }
    }
}

#[test]
fn rejects_scenario_transition_to_an_unknown_step() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-scenario-alarm-001");
    value["questions"][index]["interaction"]["steps"][0]["next_step_by_choice"]["inspect_metric"] =
        Value::from("ghost_step");

    expect_error(&value, "scenario_transition_unknown_step");
}

#[test]
fn rejects_unreachable_scenario_step() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-scenario-alarm-001");
    value["questions"][index]["interaction"]["steps"]
        .as_array_mut()
        .expect("steps")
        .push(serde_json::json!({
            "id": "orphan",
            "prompt": "Orphan step",
            "stage": "action",
            "choices": [{ "id": "orphan_choice", "label": "Orphan" }],
            "next_step_by_choice": {}
        }));

    expect_error(&value, "scenario_step_unreachable");
}

#[test]
fn rejects_duplicate_scenario_choice_id() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-scenario-alarm-001");
    value["questions"][index]["interaction"]["steps"][1]["choices"][0]["id"] =
        Value::from("inspect_metric");

    expect_error(&value, "duplicate_scenario_choice_id");
}

#[test]
fn rejects_canonical_config_unknown_piece() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-config-nat-001");
    value["questions"][index]["canonical_answer"]["assignments"]["private_route_target"] =
        Value::from("ghost_piece");

    expect_error(&value, "canonical_unknown_piece");
}

#[test]
fn rejects_canonical_config_missing_slot() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-config-nat-001");
    value["questions"][index]["canonical_answer"]["assignments"]
        .as_object_mut()
        .expect("assignments")
        .remove("public_route_target");

    expect_error(&value, "canonical_config_slots_incomplete");
}

#[test]
fn rejects_canonical_scenario_path_that_is_not_correct() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-troubleshooting-alb-001");
    value["questions"][index]["canonical_answer"]["expected_path"] =
        Value::from(vec!["check_rds_metrics"]);

    expect_error(&value, "canonical_scenario_incorrect_path");
}

#[test]
fn rejects_canonical_region_out_of_range() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-placement-dr-001");
    value["questions"][index]["canonical_answer"]["regions"]["multi_site"]["x"] =
        Value::from(vec![0.9, 1.4]);

    expect_error(&value, "canonical_region_invalid_range");
}

#[test]
fn rejects_canonical_regions_that_do_not_cover_every_item() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-placement-dr-001");
    value["questions"][index]["canonical_answer"]["regions"]
        .as_object_mut()
        .expect("regions")
        .remove("multi_site");

    expect_error(&value, "canonical_regions_incomplete");
}

#[test]
fn rejects_canonical_command_unknown_token() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-command-presign-001");
    value["questions"][index]["canonical_answer"]["values"]["target"] = Value::from("ghost_token");

    expect_error(&value, "canonical_unknown_token");
}

#[test]
fn rejects_canonical_command_missing_slot() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-command-presign-001");
    value["questions"][index]["canonical_answer"]["values"]
        .as_object_mut()
        .expect("values")
        .remove("expiry_value");

    expect_error(&value, "canonical_command_slots_incomplete");
}

#[test]
fn rejects_typed_placeholder_for_unknown_slot() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-sg-nacl-001");
    value["questions"][index]["interaction"]["text"] =
        Value::from("Security groups are {{sg_behavior}} and {{ghost}}.");

    expect_error(&value, "typed_placeholder_unknown_slot");
}

#[test]
fn rejects_typed_slot_never_referenced_in_text() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-sg-nacl-001");
    value["questions"][index]["interaction"]["text"] =
        Value::from("Security groups are {{sg_behavior}}.");

    expect_error(&value, "typed_slot_not_referenced");
}

#[test]
fn rejects_typed_duplicate_placeholder() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-sg-nacl-001");
    value["questions"][index]["interaction"]["text"] =
        Value::from("{{sg_behavior}} and {{sg_behavior}}.");

    expect_error(&value, "typed_duplicate_placeholder");
}

#[test]
fn rejects_malformed_typed_placeholder() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-deny-001");
    value["questions"][index]["interaction"]["text"] =
        Value::from("An explicit {{policy_result overrides an Allow.");

    expect_error(&value, "typed_placeholder_malformed");
}

#[test]
fn rejects_duplicate_typed_slot_id() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-deny-001");
    let slot = value["questions"][index]["interaction"]["slots"][0].clone();
    value["questions"][index]["interaction"]["slots"]
        .as_array_mut()
        .expect("slots")
        .push(slot);

    expect_error(&value, "duplicate_slot_id");
}

#[test]
fn rejects_typed_canonical_answer_missing_slot() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-sg-nacl-001");
    value["questions"][index]["canonical_answer"]["answers"]
        .as_object_mut()
        .expect("answers")
        .remove("nacl_behavior");

    expect_error(&value, "canonical_typed_answer_missing");
}

#[test]
fn rejects_typed_canonical_answer_unknown_slot() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-deny-001");
    value["questions"][index]["canonical_answer"]["answers"]["ghost"] =
        serde_json::json!({ "accepted_answers": ["nope"] });

    expect_error(&value, "canonical_typed_unknown_slot");
}

#[test]
fn rejects_typed_canonical_answer_empty_alias_list() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-deny-001");
    value["questions"][index]["canonical_answer"]["answers"]["policy_result"]["accepted_answers"] =
        serde_json::json!([]);

    expect_error(&value, "canonical_typed_answer_empty");
}

#[test]
fn rejects_typed_canonical_answer_blank_alias() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-deny-001");
    value["questions"][index]["canonical_answer"]["answers"]["policy_result"]["accepted_answers"] =
        serde_json::json!(["deny", "   "]);

    expect_error(&value, "canonical_typed_answer_blank");
}

#[test]
fn rejects_typed_canonical_answer_type_mismatch() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-deny-001");
    value["questions"][index]["canonical_answer"] =
        serde_json::json!({ "type": "fill_slots", "values": {} });

    expect_error(&value, "canonical_answer_mismatch");
}

#[test]
fn rejects_typed_interaction_type_mismatch() {
    let mut value = demo_value();
    let index = question_index(&value, "demo-typed-deny-001");
    value["questions"][index]["interaction_type"] = Value::from("fill_slots");

    expect_error(&value, "interaction_type_mismatch");
}

#[test]
fn backward_compatibility_existing_interactions_still_score() {
    let registry = demo_registry();

    // Existing SOA-C03 content is unchanged and still scores as before.
    let classification = registry
        .question("soa-c03", "monitoring-classification-001")
        .expect("classification question")
        .clone();
    let CanonicalAnswer::Classification { placements } = &classification.canonical_answer else {
        panic!("expected classification canonical answer");
    };
    let scored = score(
        &classification,
        &SubmittedAnswer::Classification(placements.clone()),
    )
    .expect("score");
    assert!(scored.correct);
    assert_eq!(scored.score, 1.0);

    let ordering = registry
        .question("soa-c03", "monitoring-ordering-001")
        .expect("ordering question")
        .clone();
    let CanonicalAnswer::Ordering { ordered_ids } = &ordering.canonical_answer else {
        panic!("expected ordering canonical answer");
    };
    let scored = score(&ordering, &SubmittedAnswer::Ordering(ordered_ids.clone())).expect("score");
    assert!(scored.correct);

    let connection = registry
        .question("soa-c03", "monitoring-connection-001")
        .expect("connection question")
        .clone();
    let CanonicalAnswer::NodeConnection { edges } = &connection.canonical_answer else {
        panic!("expected connection canonical answer");
    };
    let pairs = edges
        .iter()
        .map(|edge| (edge[0].clone(), edge[1].clone()))
        .collect();
    let scored = score(&connection, &SubmittedAnswer::NodeConnection(pairs)).expect("score");
    assert!(scored.correct);
}
