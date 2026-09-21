//! Integration tests for prediction measurement persistence.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

use adaptive_learn_db as db;
use adaptive_learn_domain::{ConceptWeight, NewUser};
use chrono::Utc;
use db::PgPool;
use serde_json::json;
use uuid::Uuid;

fn database_url() -> Option<String> {
    match std::env::var("DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => Some(url),
        _ => {
            assert_ne!(
                std::env::var("REQUIRE_DB_TESTS").as_deref(),
                Ok("1"),
                "DATABASE_URL must be set when REQUIRE_DB_TESTS=1"
            );
            eprintln!("skipping database test: DATABASE_URL is not set");
            None
        }
    }
}

async fn pool() -> Option<PgPool> {
    let url = database_url()?;
    let pool = db::connect(&url, 2).await.expect("connect to database");
    db::MIGRATOR.run(&pool).await.expect("apply migrations");
    Some(pool)
}

async fn insert_user(pool: &PgPool) -> Uuid {
    let new_user = NewUser::workos(format!("prediction_{}", Uuid::new_v4()), None);
    db::users::insert(pool, &new_user)
        .await
        .expect("insert user")
        .id
}

#[tokio::test]
async fn retries_are_stored_but_only_the_first_attempt_is_evaluated() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let mission_id = Uuid::new_v4();
    // A unique model version isolates this test from other rows in the shared
    // test database.
    let model_version = format!("test-model-{}", Uuid::new_v4());
    let concepts = vec![ConceptWeight {
        concept_id: "c1".to_owned(),
        weight: 1.0,
    }];
    let now = Utc::now();

    let snapshot = db::predictions::NewPredictionSnapshot {
        user_id,
        mission_instance_id: mission_id,
        question_id: "q1",
        track_id: "track",
        track_version: "v1",
        content_version: "c1",
        domain_id: "d1",
        assessment_mode: "recall",
        interaction_type: "ordering",
        difficulty_prior: 0.5,
        concepts: &concepts,
        concept_detail: json!([]),
        predicted_score: 0.7,
        model_version: &model_version,
        practice_source: "task_practice",
        delayed_retrieval: false,
        seconds_since_previous_practice: None,
    };
    db::predictions::insert_snapshots(&pool, &[snapshot])
        .await
        .expect("insert snapshot");

    for (attempt_number, observed_score) in [(1, 0.0), (2, 1.0)] {
        db::predictions::record_outcome(
            &pool,
            &db::predictions::OutcomeEntry {
                mission_instance_id: mission_id,
                question_id: "q1".to_owned(),
                model_version: model_version.clone(),
                event_id: Uuid::new_v4(),
                attempt_number,
                observed_score,
                observed_at: now,
            },
        )
        .await
        .expect("record outcome");
    }

    // Both attempts remain available as operational data.
    let stored: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM prediction_outcomes o
         JOIN prediction_snapshots p ON p.id = o.prediction_id
         WHERE p.model_version = $1",
    )
    .bind(&model_version)
    .fetch_one(&pool)
    .await
    .expect("count outcomes");
    assert_eq!(stored, 2);

    // Evaluation sees exactly one sample: the first accepted attempt.
    let resolved = db::predictions::list_resolved(&pool, &model_version, 100)
        .await
        .expect("list resolved");
    assert_eq!(resolved.len(), 1, "retries must not inflate samples");
    assert_eq!(resolved[0].attempt_number, 1);
    assert_eq!(resolved[0].observed_score, 0.0);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("delete user");
}
