//! Progressive `table` reveal schema, validation, and initial visibility.
//!
//! The tests mutate a real embedded learning domain's first prompt so the
//! surrounding domain (and its coverage counts) stays valid, then assert the
//! validator accepts or rejects the authored table.

use adaptive_learn_content::{
    ContentError, EMBEDDED_LEARNING_SOURCES, LearningDomain, TableRevealMode,
    validate_learning_domain,
};
use serde_json::{Value, json};

fn learning_source(certification_id: &str, domain_id: &str) -> &'static str {
    EMBEDDED_LEARNING_SOURCES
        .iter()
        .map(|source| source.json)
        .find(|json| {
            serde_json::from_str::<Value>(json)
                .ok()
                .is_some_and(|value| {
                    value["certification_id"].as_str() == Some(certification_id)
                        && value["domain"]["id"].as_str() == Some(domain_id)
                })
        })
        .expect("learning source is embedded")
}

fn learning_value() -> Value {
    serde_json::from_str(learning_source("aws-soa-c03", "domain-1")).expect("valid json")
}

fn validate_value(value: &Value) -> Result<(), Vec<ContentError>> {
    let domain: LearningDomain =
        serde_json::from_value(value.clone()).expect("mutation remains deserializable");
    validate_learning_domain(&domain)
}

fn expect_error(value: &Value, code: &str) {
    let errors = validate_value(value).expect_err("mutation must be rejected");
    assert!(
        errors.iter().any(|error| error.code == code),
        "expected error {code}, got {errors:?}"
    );
}

fn set_reveal(value: &mut Value, reveal: Value) {
    value["modules"][0]["nodes"][0]["prompts"][0]["reveal"] = reveal;
}

fn service_rows() -> Value {
    json!([
        {
            "id": "cloudwatch",
            "cells": {
                "service": "CloudWatch",
                "purpose": "Operational monitoring",
                "evidence": "Metrics, logs, alarms"
            }
        },
        {
            "id": "cloudtrail",
            "cells": {
                "service": "CloudTrail",
                "purpose": "API auditing",
                "evidence": "Who performed which AWS API action"
            }
        }
    ])
}

fn service_columns() -> Value {
    json!([
        { "id": "service", "label": "Service" },
        { "id": "purpose", "label": "Best for" },
        { "id": "evidence", "label": "What it tells you" }
    ])
}

fn row_reveal() -> Value {
    json!({
        "type": "table",
        "columns": service_columns(),
        "rows": service_rows(),
        "progressive_reveal": {
            "mode": "row",
            "initially_visible": {
                "column_ids": ["service"],
                "row_ids": [],
                "cell_ids": []
            }
        }
    })
}

fn column_reveal() -> Value {
    json!({
        "type": "table",
        "columns": [
            { "id": "control", "label": "Control" },
            { "id": "stateful", "label": "Stateful?" },
            { "id": "rules", "label": "Rules" },
            { "id": "scope", "label": "Scope" }
        ],
        "rows": [
            {
                "id": "sg",
                "cells": {
                    "control": "Security group",
                    "stateful": "Yes",
                    "rules": "Allow rules only",
                    "scope": "ENI / resource"
                }
            },
            {
                "id": "nacl",
                "cells": {
                    "control": "Network ACL",
                    "stateful": "No",
                    "rules": "Allow and deny rules",
                    "scope": "Subnet"
                }
            }
        ],
        "progressive_reveal": {
            "mode": "column",
            "initially_visible": {
                "column_ids": ["control", "scope"],
                "row_ids": [],
                "cell_ids": []
            }
        }
    })
}

fn cell_reveal() -> Value {
    json!({
        "type": "table",
        "columns": [
            { "id": "policy", "label": "Routing policy" },
            { "id": "basis", "label": "Selection basis" },
            { "id": "health", "label": "Health checks" },
            { "id": "use", "label": "Typical use" }
        ],
        "rows": [
            {
                "id": "weighted",
                "cells": {
                    "policy": "Weighted",
                    "basis": "Configured weights",
                    "health": "Supported",
                    "use": "Traffic splitting"
                }
            },
            {
                "id": "latency",
                "cells": {
                    "policy": "Latency",
                    "basis": "Lowest AWS network latency",
                    "health": "Supported",
                    "use": "Multi-Region performance"
                }
            }
        ],
        "progressive_reveal": {
            "mode": "cell",
            "initially_visible": {
                "column_ids": ["policy"],
                "row_ids": [],
                "cell_ids": ["weighted:use"]
            }
        }
    })
}

#[test]
fn static_table_without_progressive_reveal_still_validates() {
    let mut value = learning_value();
    set_reveal(
        &mut value,
        json!({
            "type": "table",
            "columns": service_columns(),
            "rows": [
                {
                    "cells": {
                        "service": "CloudWatch",
                        "purpose": "Operational monitoring",
                        "evidence": "Metrics, logs, alarms"
                    }
                }
            ]
        }),
    );

    assert!(validate_value(&value).is_ok());
}

#[test]
fn static_table_serializes_without_progressive_or_row_ids() {
    let reveal = row_reveal();
    let mut static_reveal = reveal.clone();
    static_reveal
        .as_object_mut()
        .expect("object")
        .remove("progressive_reveal");
    static_reveal["rows"][0]
        .as_object_mut()
        .expect("row")
        .remove("id");

    let domain: LearningDomain = serde_json::from_value({
        let mut value = learning_value();
        set_reveal(&mut value, static_reveal.clone());
        value
    })
    .expect("deserializes");

    let prompt = &domain.modules[0].nodes[0].prompts[0];
    let adaptive_learn_content::LearningReveal::Table {
        progressive_reveal,
        rows,
        ..
    } = &prompt.reveal
    else {
        panic!("expected table reveal");
    };
    assert!(progressive_reveal.is_none());
    assert!(rows[0].id.is_none());

    let serialized = serde_json::to_value(&prompt.reveal).expect("serialize");
    assert!(serialized.get("progressive_reveal").is_none());
    assert!(serialized["rows"][0].get("id").is_none());
}

#[test]
fn row_progressive_table_validates_and_round_trips() {
    let mut value = learning_value();
    set_reveal(&mut value, row_reveal());
    assert!(
        validate_value(&value).is_ok(),
        "{:?}",
        validate_value(&value)
    );

    let domain: LearningDomain = serde_json::from_value(value).expect("deserializes");
    let adaptive_learn_content::LearningReveal::Table {
        progressive_reveal: Some(progressive),
        rows,
        ..
    } = &domain.modules[0].nodes[0].prompts[0].reveal
    else {
        panic!("expected progressive table");
    };
    assert_eq!(progressive.mode, TableRevealMode::Row);
    assert_eq!(progressive.initially_visible.column_ids, vec!["service"]);
    assert_eq!(rows[0].id.as_deref(), Some("cloudwatch"));
    assert!(progressive.is_cell_initially_visible(Some("cloudwatch"), "service"));
    assert!(!progressive.is_cell_initially_visible(Some("cloudwatch"), "purpose"));
}

#[test]
fn column_progressive_table_validates() {
    let mut value = learning_value();
    set_reveal(&mut value, column_reveal());
    assert!(validate_value(&value).is_ok());
}

#[test]
fn cell_progressive_table_validates_with_flexible_initial_visibility() {
    let mut value = learning_value();
    set_reveal(&mut value, cell_reveal());
    assert!(
        validate_value(&value).is_ok(),
        "{:?}",
        validate_value(&value)
    );

    let domain: LearningDomain = serde_json::from_value(value).expect("deserializes");
    let adaptive_learn_content::LearningReveal::Table {
        progressive_reveal: Some(progressive),
        ..
    } = &domain.modules[0].nodes[0].prompts[0].reveal
    else {
        panic!("expected progressive table");
    };
    // Column rule, row rule, and explicit cell rule all combine.
    assert!(progressive.is_cell_initially_visible(Some("weighted"), "policy"));
    assert!(progressive.is_cell_initially_visible(Some("weighted"), "use"));
    assert!(!progressive.is_cell_initially_visible(Some("latency"), "use"));
}

#[test]
fn progressive_row_table_without_row_ids_is_rejected() {
    let mut value = learning_value();
    let mut reveal = row_reveal();
    for row in reveal["rows"].as_array_mut().expect("rows") {
        row.as_object_mut().expect("row").remove("id");
    }
    set_reveal(&mut value, reveal);

    expect_error(&value, "learning_reveal_incomplete");
}

#[test]
fn progressive_cell_table_without_row_ids_is_rejected() {
    let mut value = learning_value();
    let mut reveal = cell_reveal();
    for row in reveal["rows"].as_array_mut().expect("rows") {
        row.as_object_mut().expect("row").remove("id");
    }
    set_reveal(&mut value, reveal);

    expect_error(&value, "learning_reveal_incomplete");
}

#[test]
fn duplicate_row_ids_are_rejected() {
    let mut value = learning_value();
    let mut reveal = row_reveal();
    reveal["rows"][1]["id"] = Value::from("cloudwatch");
    set_reveal(&mut value, reveal);

    expect_error(&value, "learning_reveal_incomplete");
}

#[test]
fn unknown_initially_visible_column_is_rejected() {
    let mut value = learning_value();
    let mut reveal = row_reveal();
    reveal["progressive_reveal"]["initially_visible"]["column_ids"] = json!(["ghost"]);
    set_reveal(&mut value, reveal);

    expect_error(&value, "learning_reveal_incomplete");
}

#[test]
fn unknown_initially_visible_row_is_rejected() {
    let mut value = learning_value();
    let mut reveal = cell_reveal();
    reveal["progressive_reveal"]["initially_visible"]["row_ids"] = json!(["ghost"]);
    set_reveal(&mut value, reveal);

    expect_error(&value, "learning_reveal_incomplete");
}

#[test]
fn unknown_initially_visible_cell_is_rejected() {
    let mut value = learning_value();
    let mut reveal = cell_reveal();
    reveal["progressive_reveal"]["initially_visible"]["cell_ids"] = json!(["weighted:ghost"]);
    set_reveal(&mut value, reveal);

    expect_error(&value, "learning_reveal_incomplete");
}

#[test]
fn duplicate_initial_visibility_entries_are_rejected() {
    let mut value = learning_value();
    let mut reveal = row_reveal();
    reveal["progressive_reveal"]["initially_visible"]["column_ids"] = json!(["service", "service"]);
    set_reveal(&mut value, reveal);

    expect_error(&value, "learning_reveal_incomplete");
}

#[test]
fn zero_revealable_units_is_rejected() {
    let mut value = learning_value();
    let mut reveal = column_reveal();
    reveal["progressive_reveal"]["initially_visible"]["column_ids"] =
        json!(["control", "stateful", "rules", "scope"]);
    set_reveal(&mut value, reveal);

    expect_error(&value, "learning_reveal_incomplete");
}

#[test]
fn row_completeness_is_still_validated_for_progressive_tables() {
    let mut value = learning_value();
    let mut reveal = row_reveal();
    reveal["rows"][1]["cells"]
        .as_object_mut()
        .expect("cells")
        .remove("evidence");
    set_reveal(&mut value, reveal);

    expect_error(&value, "learning_reveal_incomplete");
}
