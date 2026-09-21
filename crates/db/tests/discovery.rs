//! Integration tests for server-persisted, monotonic discovery progress.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

use std::collections::BTreeMap;

use adaptive_learn_content::DomainDiscoveryInput;
use adaptive_learn_db as db;
use adaptive_learn_domain::NewUser;
use db::PgPool;
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
    let new_user = NewUser::workos(format!("discovery_{}", Uuid::new_v4()), None);
    db::users::insert(pool, &new_user)
        .await
        .expect("insert user")
        .id
}

async fn cleanup(pool: &PgPool, user_id: Uuid) {
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .expect("delete user");
}

fn input(
    domain_id: &str,
    prompts: &[(&str, &[&str])],
    elements: &[(&str, &str, &[&str])],
) -> DomainDiscoveryInput {
    let mut revealed_prompt_ids: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (node_id, ids) in prompts {
        revealed_prompt_ids.insert(
            (*node_id).to_owned(),
            ids.iter().map(|id| (*id).to_owned()).collect(),
        );
    }
    let mut revealed_element_ids: BTreeMap<String, BTreeMap<String, Vec<String>>> = BTreeMap::new();
    for (node_id, prompt_id, ids) in elements {
        revealed_element_ids
            .entry((*node_id).to_owned())
            .or_default()
            .insert(
                (*prompt_id).to_owned(),
                ids.iter().map(|id| (*id).to_owned()).collect(),
            );
    }
    DomainDiscoveryInput {
        domain_id: domain_id.to_owned(),
        revealed_prompt_ids,
        revealed_element_ids,
    }
}

#[tokio::test]
async fn two_devices_merge_with_set_union_and_never_lose_reveals() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;

    // Device A reveals p1 on n1 and one annotation.
    db::discovery::merge(
        &pool,
        user_id,
        "v1",
        "c1",
        &[input(
            "d1",
            &[("n1", &["p1"])],
            &[("n1", "p1", &["annotation:a1"])],
        )],
    )
    .await
    .expect("device a merge");

    // Device B reveals p2 on n1 and a different element on n2.
    db::discovery::merge(
        &pool,
        user_id,
        "v1",
        "c1",
        &[input(
            "d1",
            &[("n1", &["p2"]), ("n2", &["p1"])],
            &[("n2", "p1", &["cell:r1:c1"])],
        )],
    )
    .await
    .expect("device b merge");

    let rows = db::discovery::list_for_user_track(&pool, user_id, "v1")
        .await
        .expect("list");
    assert_eq!(rows.len(), 1);
    let merged = rows[0].to_input();
    assert_eq!(merged.revealed_prompt_ids["n1"], vec!["p1", "p2"]);
    assert_eq!(merged.revealed_prompt_ids["n2"], vec!["p1"]);
    assert_eq!(
        merged.revealed_element_ids["n1"]["p1"],
        vec!["annotation:a1"]
    );
    assert_eq!(merged.revealed_element_ids["n2"]["p1"], vec!["cell:r1:c1"]);

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn older_device_state_cannot_remove_newer_reveals() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;

    let newer = input(
        "d1",
        &[("n1", &["p1", "p2"])],
        &[("n1", "p1", &["annotation:a1", "annotation:a2"])],
    );
    let older = input("d1", &[("n1", &["p1"])], &[]);

    db::discovery::merge(&pool, user_id, "v1", "c1", &[newer])
        .await
        .expect("newer merge");
    db::discovery::merge(&pool, user_id, "v1", "c1", &[older])
        .await
        .expect("older merge");

    let rows = db::discovery::list_for_user_track(&pool, user_id, "v1")
        .await
        .expect("list");
    let merged = rows[0].to_input();
    assert_eq!(merged.revealed_prompt_ids["n1"], vec!["p1", "p2"]);
    assert_eq!(
        merged.revealed_element_ids["n1"]["p1"],
        vec!["annotation:a1", "annotation:a2"]
    );

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn duplicate_discovery_batches_are_idempotent() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;

    let batch = input(
        "d1",
        &[("n1", &["p1", "p1"])],
        &[("n1", "p1", &["annotation:a1", "annotation:a1"])],
    );
    for _ in 0..3 {
        db::discovery::merge(&pool, user_id, "v1", "c1", std::slice::from_ref(&batch))
            .await
            .expect("merge");
    }

    let rows = db::discovery::list_for_user_track(&pool, user_id, "v1")
        .await
        .expect("list");
    assert_eq!(rows.len(), 1, "one row per (user, track, domain)");
    let merged = rows[0].to_input();
    assert_eq!(merged.revealed_prompt_ids["n1"], vec!["p1"]);
    assert_eq!(
        merged.revealed_element_ids["n1"]["p1"],
        vec!["annotation:a1"]
    );

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn progressive_table_and_code_annotation_elements_merge_independently() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;

    db::discovery::merge(
        &pool,
        user_id,
        "v1",
        "c1",
        &[input(
            "d1",
            &[("n1", &["table"])],
            &[("n1", "table", &["cell:r1:c1"])],
        )],
    )
    .await
    .expect("first merge");
    db::discovery::merge(
        &pool,
        user_id,
        "v1",
        "c1",
        &[input(
            "d1",
            &[],
            &[
                ("n1", "table", &["cell:r1:c2", "column:c1"]),
                ("n1", "code", &["annotation:a1"]),
            ],
        )],
    )
    .await
    .expect("second merge");

    let rows = db::discovery::list_for_user_track(&pool, user_id, "v1")
        .await
        .expect("list");
    let merged = rows[0].to_input();
    assert_eq!(
        merged.revealed_element_ids["n1"]["table"],
        vec!["cell:r1:c1", "cell:r1:c2", "column:c1"]
    );
    assert_eq!(
        merged.revealed_element_ids["n1"]["code"],
        vec!["annotation:a1"]
    );

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn discovery_never_creates_concept_evidence_or_learning_events() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;

    db::discovery::merge(
        &pool,
        user_id,
        "v1",
        "c1",
        &[input(
            "d1",
            &[("n1", &["p1", "p2"])],
            &[("n1", "p1", &["annotation:a1"])],
        )],
    )
    .await
    .expect("merge");

    let concept_states: i64 =
        sqlx::query_scalar("SELECT count(*) FROM user_concept_state WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("count concept state");
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM learning_events WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("count events");
    let wallet: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(amount), 0) FROM bit_transactions WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("wallet sum");

    assert_eq!(concept_states, 0, "discovery is not concept evidence");
    assert_eq!(events, 0, "discovery is not a learning event");
    assert_eq!(wallet, 0, "discovery never settles Bits");

    cleanup(&pool, user_id).await;
}
