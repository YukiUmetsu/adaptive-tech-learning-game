//! Integration tests for Cyber Defense Stage 2 persistence.
//!
//! These tests require PostgreSQL and are skipped when `DATABASE_URL` is unset.

use adaptive_learn_db as db;
use adaptive_learn_domain::NewUser;
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
    let pool = db::connect(&url, 4).await.expect("connect to database");
    db::MIGRATOR.run(&pool).await.expect("apply migrations");
    Some(pool)
}

async fn insert_user(pool: &PgPool) -> Uuid {
    let new_user = NewUser::workos(format!("cyber_{}", Uuid::new_v4()), None);
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

#[tokio::test]
async fn profile_is_created_once_with_defaults() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;

    let mut conn = pool.acquire().await.expect("acquire");
    let first = db::cyber_defense::get_or_create_profile(&mut conn, user_id)
        .await
        .expect("create profile");
    assert_eq!(first.career_xp, 0);
    assert_eq!(first.recommended_threat_level, 1);
    assert_eq!(first.active_story_chapter, "chapter-1");
    assert!(!first.legacy_progress_imported);

    let second = db::cyber_defense::get_or_create_profile(&mut conn, user_id)
        .await
        .expect("re-read profile");
    assert_eq!(first.created_at, second.created_at, "no duplicate profile");

    drop(conn);
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn career_and_hero_xp_increment() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let mut conn = pool.acquire().await.expect("acquire");
    db::cyber_defense::get_or_create_profile(&mut conn, user_id)
        .await
        .expect("create profile");

    let xp = db::cyber_defense::increment_career_xp(&mut conn, user_id, 150)
        .await
        .expect("career xp");
    assert_eq!(xp, 150);

    let hero_xp = db::cyber_defense::increment_hero_xp(&mut conn, user_id, "sre", 40)
        .await
        .expect("hero xp");
    assert_eq!(hero_xp, 40);
    let hero_xp = db::cyber_defense::increment_hero_xp(&mut conn, user_id, "sre", 25)
        .await
        .expect("hero xp again");
    assert_eq!(hero_xp, 65, "hero XP upserts rather than duplicating");

    drop(conn);
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn tower_upgrade_increments_per_room() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let mut conn = pool.acquire().await.expect("acquire");

    assert_eq!(
        db::cyber_defense::get_tower_upgrade_level(&mut conn, user_id, "soc")
            .await
            .expect("default level"),
        0
    );
    let level = db::cyber_defense::increment_tower_upgrade(&mut conn, user_id, "soc")
        .await
        .expect("increment");
    assert_eq!(level, 1);
    let level = db::cyber_defense::increment_tower_upgrade(&mut conn, user_id, "soc")
        .await
        .expect("increment again");
    assert_eq!(level, 2);
    let upgrades = db::cyber_defense::list_tower_upgrades(&mut conn, user_id)
        .await
        .expect("list");
    assert_eq!(upgrades.len(), 1);
    assert_eq!(upgrades[0].upgrade_id, "soc");
    assert_eq!(upgrades[0].level, 2);

    drop(conn);
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn story_progress_is_idempotent() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let mut conn = pool.acquire().await.expect("acquire");

    assert!(
        db::cyber_defense::record_story_progress(&mut conn, user_id, "chapter-1-complete")
            .await
            .expect("record")
    );
    assert!(
        !db::cyber_defense::record_story_progress(&mut conn, user_id, "chapter-1-complete")
            .await
            .expect("record again"),
        "second record is a no-op"
    );
    let nodes = db::cyber_defense::list_story_progress(&mut conn, user_id)
        .await
        .expect("list");
    assert_eq!(nodes.len(), 1);

    drop(conn);
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn campaign_result_keeps_best_stars_and_health() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let mut conn = pool.acquire().await.expect("acquire");

    db::cyber_defense::upsert_campaign_result(&mut conn, user_id, "ddos-basics", true, 1, 20, true)
        .await
        .expect("first clear");
    let merged = db::cyber_defense::upsert_campaign_result(
        &mut conn,
        user_id,
        "ddos-basics",
        true,
        3,
        80,
        false,
    )
    .await
    .expect("better replay");

    assert_eq!(merged.best_stars, 3);
    assert_eq!(merged.best_health, 80);
    assert_eq!(merged.attempts, 2);
    assert!(merged.first_clear_reward_settled);
    assert!(merged.completed);

    drop(conn);
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn operation_run_ownership_is_enforced() {
    let Some(pool) = pool().await else {
        return;
    };
    let owner = insert_user(&pool).await;
    let other = insert_user(&pool).await;
    let run_id = Uuid::new_v4();
    let config = json!({ "seed": 7 });

    let mut conn = pool.acquire().await.expect("acquire");
    db::cyber_defense::create_operation_run(
        &mut conn,
        &db::cyber_defense::NewOperationRun {
            id: run_id,
            user_id: owner,
            seed: 7,
            template_id: "identity-breach",
            adversary_id: "ghost-7",
            hero_id: Some("security_engineer"),
            threat_level: 3,
            generated_config: &config,
        },
    )
    .await
    .expect("create run");

    assert!(
        db::cyber_defense::get_operation_run_for_user(&mut conn, owner, run_id)
            .await
            .expect("owner read")
            .is_some()
    );
    assert!(
        db::cyber_defense::get_operation_run_for_user(&mut conn, other, run_id)
            .await
            .expect("other read")
            .is_none(),
        "another user cannot read the run"
    );

    drop(conn);
    cleanup(&pool, owner).await;
    cleanup(&pool, other).await;
}

#[tokio::test]
async fn duplicate_reward_event_settles_once() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let event_id = Uuid::new_v4();
    let transaction = db::wallets::BitTransaction {
        user_id,
        device_id: None,
        event_id,
        mission_instance_id: Uuid::new_v4(),
        question_id: "cyber_operation_reward".to_owned(),
        amount: 60,
        reason: "cyber_operation_reward".to_owned(),
    };

    let mut tx = pool.begin().await.expect("begin");
    assert!(
        db::wallets::settle(&mut tx, &transaction)
            .await
            .expect("settle")
    );
    tx.commit().await.expect("commit");

    let mut tx = pool.begin().await.expect("begin again");
    assert!(
        !db::wallets::settle(&mut tx, &transaction)
            .await
            .expect("settle duplicate"),
        "duplicate reward event settles nothing"
    );
    tx.commit().await.expect("commit");
    assert_eq!(db::wallets::balance(&pool, user_id).await.unwrap(), 60);

    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn completion_transaction_rolls_back_on_failure() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let run_id = Uuid::new_v4();
    let config = json!({ "seed": 11 });

    let mut conn = pool.acquire().await.expect("acquire");
    db::cyber_defense::create_operation_run(
        &mut conn,
        &db::cyber_defense::NewOperationRun {
            id: run_id,
            user_id,
            seed: 11,
            template_id: "web-assault",
            adversary_id: "null",
            hero_id: None,
            threat_level: 4,
            generated_config: &config,
        },
    )
    .await
    .expect("create run");
    drop(conn);

    let mut tx = pool.begin().await.expect("begin");
    let update = db::cyber_defense::OperationResultUpdate {
        completed: true,
        stars: 3,
        health: 90,
        duration_ms: 300_000,
        bits: 70,
        career_xp: 100,
        hero_xp: 50,
        reward_event_id: Uuid::new_v4(),
    };
    db::cyber_defense::complete_operation_run(&mut tx, user_id, run_id, &update)
        .await
        .expect("complete")
        .expect("active run settles");
    tx.rollback().await.expect("rollback");

    let mut conn = pool.acquire().await.expect("acquire");
    let run = db::cyber_defense::get_operation_run_for_user(&mut conn, user_id, run_id)
        .await
        .expect("read")
        .expect("run exists");
    assert_eq!(run.status, "active", "rollback left the run active");

    drop(conn);
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn dossier_flags_union_without_duplicates() {
    let Some(pool) = pool().await else {
        return;
    };
    let user_id = insert_user(&pool).await;
    let mut conn = pool.acquire().await.expect("acquire");

    let flags = db::cyber_defense::add_dossier_flags(
        &mut conn,
        user_id,
        "ghost-7",
        &["identity_specialist".to_owned()],
    )
    .await
    .expect("add flags");
    assert_eq!(flags, vec!["identity_specialist".to_owned()]);

    let flags = db::cyber_defense::add_dossier_flags(
        &mut conn,
        user_id,
        "ghost-7",
        &[
            "identity_specialist".to_owned(),
            "uses_hidden_traffic".to_owned(),
        ],
    )
    .await
    .expect("add more flags");
    assert_eq!(
        flags,
        vec![
            "identity_specialist".to_owned(),
            "uses_hidden_traffic".to_owned()
        ]
    );

    drop(conn);
    cleanup(&pool, user_id).await;
}
