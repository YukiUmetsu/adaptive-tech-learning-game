//! Integration tests for the derived `user_concept_state` cache.
//!
//! These tests require PostgreSQL. They run when `DATABASE_URL` is set and are
//! skipped otherwise. CI sets `REQUIRE_DB_TESTS=1` so a missing database fails
//! the build instead of silently skipping coverage.

use adaptive_learn_db as db;
use adaptive_learn_domain::{
    AssessmentMode, ConceptObservation, ConceptWeight, MODEL_VERSION, PRIOR_ESTIMATE,
    retrievability, uncertainty,
};
use chrono::{Duration, Utc};
use db::PgPool;
use uuid::Uuid;

/// Returns the configured database URL, or `None` when tests should be skipped.
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
    let new_user = adaptive_learn_domain::NewUser::workos(
        format!("user_{}", Uuid::new_v4()),
        Some(format!("{}@example.test", Uuid::new_v4())),
    );

    db::users::insert(pool, &new_user)
        .await
        .expect("insert user")
        .id
}

async fn delete_user(pool: &PgPool, id: Uuid) {
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .expect("delete user");
}

fn observation<'a>(
    user_id: Uuid,
    concept: &'a ConceptWeight,
    mode: AssessmentMode,
    score: f64,
) -> ConceptObservation<'a> {
    ConceptObservation {
        user_id,
        certification_version: "soa-c03",
        concept,
        assessment_mode: mode,
        score,
        attempt_number: 1,
        hint_count: 0,
        occurred_at: Utc::now(),
    }
}

async fn apply(pool: &PgPool, observation: &ConceptObservation<'_>) {
    let mut tx = pool.begin().await.expect("begin");
    db::concept_state::apply(&mut tx, observation)
        .await
        .expect("apply observation");
    tx.commit().await.expect("commit");
}

#[tokio::test]
async fn concept_state_round_trips_and_separates_assessment_modes() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let concept = ConceptWeight {
        concept_id: "aws.route_tables".to_owned(),
        weight: 1.0,
    };

    apply(
        &pool,
        &observation(user_id, &concept, AssessmentMode::Recognition, 1.0),
    )
    .await;
    apply(
        &pool,
        &observation(user_id, &concept, AssessmentMode::Recall, 0.0),
    )
    .await;

    let states = db::concept_state::list_for_user(&pool, user_id, "soa-c03")
        .await
        .expect("list state");
    assert_eq!(states.len(), 2, "one row per assessment mode");

    let recognition = db::concept_state::find_one(
        &pool,
        user_id,
        "soa-c03",
        "aws.route_tables",
        AssessmentMode::Recognition,
    )
    .await
    .expect("find recognition")
    .expect("recognition row");
    let recall = db::concept_state::find_one(
        &pool,
        user_id,
        "soa-c03",
        "aws.route_tables",
        AssessmentMode::Recall,
    )
    .await
    .expect("find recall")
    .expect("recall row");

    assert_eq!(recognition.model_version, MODEL_VERSION);
    assert!(recognition.estimate > PRIOR_ESTIMATE);
    assert_eq!(recognition.success_count, 1);
    assert_eq!(recognition.exposure_count, 1);
    assert!(recall.estimate < PRIOR_ESTIMATE);
    assert_eq!(recall.failure_count, 1);
    // Applying recall evidence did not disturb the recognition estimate.
    assert!(recognition.estimate > recall.estimate);

    delete_user(&pool, user_id).await;
}

#[tokio::test]
async fn repeated_applications_advance_state_version_and_evidence() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let concept = ConceptWeight {
        concept_id: "aws.route_tables".to_owned(),
        weight: 1.0,
    };

    apply(
        &pool,
        &observation(user_id, &concept, AssessmentMode::Recall, 1.0),
    )
    .await;
    apply(
        &pool,
        &observation(user_id, &concept, AssessmentMode::Recall, 1.0),
    )
    .await;

    let state = db::concept_state::find_one(
        &pool,
        user_id,
        "soa-c03",
        "aws.route_tables",
        AssessmentMode::Recall,
    )
    .await
    .expect("find")
    .expect("row");

    assert_eq!(state.exposure_count, 2);
    assert_eq!(state.state_version, 2);
    assert!(state.evidence_mass > 1.0);
    assert!(state.estimate > 0.5);

    delete_user(&pool, user_id).await;
}

#[tokio::test]
async fn more_evidence_decays_more_slowly_in_storage() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let thin = ConceptWeight {
        concept_id: "aws.thin".to_owned(),
        weight: 1.0,
    };
    let fat = ConceptWeight {
        concept_id: "aws.fat".to_owned(),
        weight: 1.0,
    };

    apply(
        &pool,
        &observation(user_id, &thin, AssessmentMode::Recall, 1.0),
    )
    .await;
    for _ in 0..6 {
        apply(
            &pool,
            &observation(user_id, &fat, AssessmentMode::Recall, 1.0),
        )
        .await;
    }

    let thin = db::concept_state::find_one(
        &pool,
        user_id,
        "soa-c03",
        "aws.thin",
        AssessmentMode::Recall,
    )
    .await
    .expect("find thin")
    .expect("thin row");
    let fat =
        db::concept_state::find_one(&pool, user_id, "soa-c03", "aws.fat", AssessmentMode::Recall)
            .await
            .expect("find fat")
            .expect("fat row");

    let now = Utc::now() + Duration::days(30);
    assert!(
        retrievability(fat.evidence_mass, fat.last_practiced_at, now)
            > retrievability(thin.evidence_mass, thin.last_practiced_at, now),
        "more stored evidence must decay more slowly"
    );
    assert!(uncertainty(fat.evidence_mass) < uncertainty(thin.evidence_mass));

    delete_user(&pool, user_id).await;
}
