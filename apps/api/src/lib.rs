//! HTTP layer for the adaptive learning game.
//!
//! Handlers are intentionally thin: they validate input, call lower layers, and
//! map results to transport types. Business rules belong in domain/application
//! services as later phases add them.

pub mod auth;
pub mod config;
pub mod dto;
pub mod error;
pub mod openapi;
pub mod pedagogy;
pub mod planner;
pub mod remediation;
pub mod routes;
pub mod selection;
pub mod services;
pub mod signals;
pub mod state;
pub mod structure;

use std::time::Duration;

use axum::Router;
use axum::extract::Extension;
use axum::http::{Method, StatusCode, header};
use axum::routing::{get, post, put};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

pub use config::Config;
pub use error::ApiError;
pub use state::AppState;

/// Builds the application router with its middleware stack.
///
/// Kept as a pure function so tests and the binary share exactly one wiring.
pub fn build_router(state: AppState, config: &Config) -> Router {
    let cors = build_cors(config);
    let timeout = Duration::from_secs(config.request_timeout_seconds);

    let mut router = Router::new()
        .route("/health", get(routes::health::health))
        .route("/openapi.json", get(routes::openapi::openapi_json))
        .route(
            "/v1/certifications",
            get(routes::certifications::list_certifications),
        )
        .route(
            "/v1/certifications/{certification_id}/domains/{domain_id}/learning",
            get(routes::learning::get_learning_domain),
        )
        .route(
            "/v1/certifications/{certification_id}/practice-tests",
            get(routes::practice_tests::list_practice_tests),
        )
        .route(
            "/v1/certifications/{certification_id}/practice-tests/{practice_test_id}",
            get(routes::practice_tests::get_practice_test),
        )
        .route(
            "/v1/certifications/{certification_id}/practice-tests/{practice_test_id}/submit",
            post(routes::practice_tests::submit_practice_test),
        )
        .route(
            "/v1/tracks/{track_id}/discovery",
            get(routes::discovery::get_track_discovery),
        )
        .route(
            "/v1/tracks/{track_id}/map",
            get(routes::progress::get_track_map),
        )
        .route(
            "/v1/tracks/{track_id}/progress",
            get(routes::progress::get_track_progress),
        )
        .route(
            "/v1/tracks/{track_id}/family-insights",
            get(routes::progress::get_track_family_insights),
        )
        .route(
            "/v1/tracks/{track_id}/recommendation",
            post(routes::recommendations::create_recommendation),
        )
        .route(
            "/v1/tracks/{track_id}/recommendations/{recommendation_id}/events",
            post(routes::recommendations::record_recommendation_event),
        )
        .route(
            "/v1/tracks/{track_id}/session",
            post(routes::sessions::create_study_session),
        )
        .route(
            "/v1/tracks/{track_id}/challenges/{challenge_id}/start",
            post(routes::challenges::start_challenge),
        )
        .route(
            "/v1/tracks/{track_id}/daily-mission",
            post(routes::daily_missions::get_today_daily_mission),
        )
        .route(
            "/v1/daily-missions/{mission_id}/items/{position}/start",
            post(routes::daily_missions::start_daily_item),
        )
        .route(
            "/v1/daily-missions/{mission_id}/items/{position}/complete",
            post(routes::daily_missions::complete_daily_item),
        )
        .route(
            "/v1/daily-missions/{mission_id}/items/{position}/review",
            get(routes::daily_missions::review_daily_item),
        )
        .route("/v1/missions/issue", post(routes::missions::issue_mission))
        .route(
            "/v1/missions/{mission_id}/answers",
            post(routes::missions::answer_mission),
        )
        .route(
            "/v1/missions/{mission_id}/complete",
            post(routes::missions::complete_mission),
        )
        .route(
            "/v1/missions/{mission_id}/review",
            get(routes::missions::review_mission),
        )
        .route("/v1/sync", post(routes::sync::sync))
        .route("/v1/wallet", get(routes::wallet::get_wallet))
        .route(
            "/v1/cyber-defense/profile",
            get(routes::cyber_defense::get_profile),
        )
        .route(
            "/v1/cyber-defense/cosmetics/{cosmetic_id}/purchase",
            post(routes::cyber_defense::purchase_cosmetic),
        )
        .route(
            "/v1/cyber-defense/cosmetics/equipped",
            put(routes::cyber_defense::equip_cosmetic),
        )
        .route(
            "/v1/cyber-defense/campaign/{mission_id}/complete",
            post(routes::cyber_defense::complete_campaign),
        )
        .route(
            "/v1/cyber-defense/tower/upgrades/{upgrade_id}",
            post(routes::cyber_defense::purchase_tower_upgrade),
        )
        .route(
            "/v1/cyber-defense/heroes/{hero_id}/talents",
            put(routes::cyber_defense::set_hero_talents),
        )
        .route(
            "/v1/cyber-defense/operations/offers",
            post(routes::cyber_defense::operation_offers),
        )
        .route(
            "/v1/cyber-defense/operations",
            post(routes::cyber_defense::start_operation),
        )
        .route(
            "/v1/cyber-defense/operations/{run_id}",
            get(routes::cyber_defense::get_operation),
        )
        .route(
            "/v1/cyber-defense/operations/{run_id}/loadout",
            put(routes::cyber_defense::set_operation_loadout),
        )
        .route(
            "/v1/cyber-defense/operations/{run_id}/deploy",
            post(routes::cyber_defense::deploy_operation),
        )
        .route(
            "/v1/cyber-defense/operations/{run_id}/abandon",
            post(routes::cyber_defense::abandon_operation),
        )
        .route(
            "/v1/cyber-defense/operations/{run_id}/complete",
            post(routes::cyber_defense::complete_operation),
        )
        .route(
            "/v1/cyber-defense/legacy-progress",
            post(routes::cyber_defense::import_legacy_progress),
        )
        .route(
            "/v1/cyber-defense/telemetry",
            post(routes::cyber_defense::submit_telemetry),
        )
        .route("/v1/me", get(routes::me::get_me))
        .route("/v1/me/settings", put(routes::me::update_settings));

    // The internal evaluation endpoint is only mounted when explicitly enabled,
    // so a normal deployment returns 404 for it to every caller (including
    // unauthenticated ones) rather than revealing that it exists via a 401.
    if config.internal_evaluation_enabled {
        router = router.route(
            "/internal/model-evaluation",
            get(routes::internal::get_model_evaluation),
        );
    }

    router
        .layer(Extension(config.internal_access()))
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            timeout,
        ))
        .layer(RequestBodyLimitLayer::new(config.request_body_limit_bytes))
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(cors)
        .with_state(state)
}

fn build_cors(config: &Config) -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(config.cors_allowed_origins.clone()))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            axum::http::HeaderName::from_static(crate::auth::DEVICE_HEADER),
        ])
        .max_age(Duration::from_secs(600))
}
