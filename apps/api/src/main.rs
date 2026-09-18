use std::sync::Arc;

use adaptive_learn_api::config::{Config, LogFormat};
use adaptive_learn_api::{AppState, build_router};
use adaptive_learn_content::ContentRegistry;
use adaptive_learn_db as db;
use anyhow::Context;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Local convenience only; real environments inject variables directly.
    let _ = dotenvy::dotenv();

    let config = Config::from_env().context("load configuration")?;
    init_tracing(&config)?;

    tracing::info!(
        environment = config.app_env.as_str(),
        version = env!("CARGO_PKG_VERSION"),
        auth_configured = config.workos.is_some(),
        "starting adaptive-learn-api"
    );

    let pool = db::connect(&config.database_url, config.database_max_connections)
        .await
        .context("connect to postgres")?;

    if config.run_migrations {
        tracing::info!("applying database migrations");
        db::MIGRATOR.run(&pool).await.context("apply migrations")?;
    }

    let content = ContentRegistry::embedded().map_err(|errors| {
        let details = errors
            .iter()
            .map(|error| format!("{}: {}", error.code, error.message))
            .collect::<Vec<_>>()
            .join("; ");
        anyhow::anyhow!("content validation failed: {details}")
    })?;
    let content = Arc::new(content);
    tracing::info!(
        bundles = content.bundles().len(),
        "loaded and validated content"
    );

    let state = AppState::new(pool.clone(), content);
    let app = build_router(state, &config);

    let listener = TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("bind {}", config.bind_addr))?;
    tracing::info!(address = %listener.local_addr()?, "listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("serve http")?;

    tracing::info!("shutdown complete; closing database pool");
    pool.close().await;

    Ok(())
}

fn init_tracing(config: &Config) -> anyhow::Result<()> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let registry = tracing_subscriber::registry().with(filter);

    let result = if config.log_format == LogFormat::Json {
        registry
            .with(tracing_subscriber::fmt::layer().json())
            .try_init()
    } else {
        registry.with(tracing_subscriber::fmt::layer()).try_init()
    };

    result.map_err(|error| anyhow::anyhow!("failed to initialise tracing: {error}"))
}

/// Resolves when the process receives Ctrl-C or SIGTERM.
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to listen for ctrl-c");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(error) => {
                tracing::error!(%error, "failed to listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }

    tracing::info!("shutdown signal received");
}
