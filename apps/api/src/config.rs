//! Environment-based configuration.
//!
//! Every value is read once at startup. Request paths never read the
//! environment, and secrets are never logged or returned to clients.

use std::collections::HashMap;
use std::net::SocketAddr;

use axum::http::HeaderValue;

/// Deployment environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    /// Developer machine.
    Local,
    /// Automated tests.
    Test,
    /// Pre-production.
    Staging,
    /// Production.
    Production,
}

impl AppEnv {
    fn parse(value: &str) -> Result<Self, ConfigError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "local" | "development" | "dev" => Ok(Self::Local),
            "test" => Ok(Self::Test),
            "staging" => Ok(Self::Staging),
            "production" | "prod" => Ok(Self::Production),
            _ => Err(ConfigError::invalid(
                "APP_ENV",
                "must be one of local, test, staging, production",
            )),
        }
    }

    /// Human-readable environment name.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Test => "test",
            Self::Staging => "staging",
            Self::Production => "production",
        }
    }

    /// Whether this is the production environment.
    pub const fn is_production(self) -> bool {
        matches!(self, Self::Production)
    }
}

/// Tracing output format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    /// Human-readable single-line logs for local development.
    Pretty,
    /// One JSON object per line for log collectors.
    Json,
}

impl LogFormat {
    fn parse(value: &str) -> Result<Self, ConfigError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "pretty" | "text" => Ok(Self::Pretty),
            "json" => Ok(Self::Json),
            _ => Err(ConfigError::invalid("LOG_FORMAT", "must be pretty or json")),
        }
    }
}

/// WorkOS AuthKit settings.
///
/// Phase 0 only carries these values as a configuration boundary. Token
/// verification is added with the first authenticated route; see
/// `docs/05-authentication.md`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkosConfig {
    /// Public WorkOS client id.
    pub client_id: String,
    /// Server-side WorkOS API key. Never exposed to the browser or logs.
    pub api_key: String,
    /// Optional expected token issuer.
    pub issuer: Option<String>,
}

/// Validated runtime configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// Deployment environment.
    pub app_env: AppEnv,
    /// Address the HTTP server binds to.
    pub bind_addr: SocketAddr,
    /// PostgreSQL connection string.
    pub database_url: String,
    /// Maximum pool connections per API instance.
    pub database_max_connections: u32,
    /// Whether to apply embedded migrations at startup.
    pub run_migrations: bool,
    /// Browser origins allowed by CORS.
    pub cors_allowed_origins: Vec<HeaderValue>,
    /// Per-request timeout in seconds.
    pub request_timeout_seconds: u64,
    /// Maximum request body size in bytes.
    pub request_body_limit_bytes: usize,
    /// Tracing output format.
    pub log_format: LogFormat,
    /// WorkOS settings, or `None` when authentication is not configured.
    pub workos: Option<WorkosConfig>,
}

impl Config {
    /// Loads configuration from the process environment.
    pub fn from_env() -> Result<Self, ConfigError> {
        let vars = std::env::vars_os()
            .filter_map(|(key, value)| Some((key.into_string().ok()?, value.into_string().ok()?)));
        Self::from_source(vars)
    }

    /// Loads configuration from any `(key, value)` iterator. Used by tests.
    pub fn from_source<I, K, V>(source: I) -> Result<Self, ConfigError>
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let map: HashMap<String, String> = source
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect();
        Self::from_map(&map)
    }

    fn from_map(map: &HashMap<String, String>) -> Result<Self, ConfigError> {
        let raw = |key: &str| {
            map.get(key)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };
        let required = |key: &str| raw(key).ok_or_else(|| ConfigError::missing(key));

        let app_env = match raw("APP_ENV") {
            Some(value) => AppEnv::parse(&value)?,
            None => AppEnv::Local,
        };

        let bind_addr = match raw("BIND_ADDR") {
            Some(value) => value
                .parse()
                .map_err(|_| ConfigError::invalid("BIND_ADDR", "must be a host:port pair"))?,
            None => SocketAddr::from(([0, 0, 0, 0], 8080)),
        };

        let database_max_connections = match raw("DATABASE_MAX_CONNECTIONS") {
            Some(value) => parse_u64("DATABASE_MAX_CONNECTIONS", &value)?,
            None => 5,
        };
        if !(1..=100).contains(&database_max_connections) {
            return Err(ConfigError::invalid(
                "DATABASE_MAX_CONNECTIONS",
                "must be between 1 and 100",
            ));
        }

        let request_timeout_seconds = match raw("REQUEST_TIMEOUT_SECONDS") {
            Some(value) => parse_u64("REQUEST_TIMEOUT_SECONDS", &value)?,
            None => 30,
        };
        if !(1..=300).contains(&request_timeout_seconds) {
            return Err(ConfigError::invalid(
                "REQUEST_TIMEOUT_SECONDS",
                "must be between 1 and 300",
            ));
        }

        let request_body_limit_bytes = match raw("REQUEST_BODY_LIMIT_BYTES") {
            Some(value) => parse_u64("REQUEST_BODY_LIMIT_BYTES", &value)? as usize,
            None => 1_048_576,
        };

        let cors_allowed_origins = match raw("CORS_ALLOWED_ORIGINS") {
            Some(value) => parse_origins(&value)?,
            None if app_env == AppEnv::Local => {
                vec![HeaderValue::from_static("http://localhost:5173")]
            }
            None => Vec::new(),
        };

        let run_migrations = match raw("RUN_MIGRATIONS") {
            Some(value) => parse_bool("RUN_MIGRATIONS", &value)?,
            None => matches!(app_env, AppEnv::Local | AppEnv::Test),
        };

        let log_format = match raw("LOG_FORMAT") {
            Some(value) => LogFormat::parse(&value)?,
            None if app_env.is_production() => LogFormat::Json,
            None => LogFormat::Pretty,
        };

        let workos = match (raw("WORKOS_CLIENT_ID"), raw("WORKOS_API_KEY")) {
            (None, None) => None,
            (Some(client_id), Some(api_key)) => Some(WorkosConfig {
                client_id,
                api_key,
                issuer: raw("WORKOS_ISSUER"),
            }),
            _ => return Err(ConfigError::IncompleteWorkos),
        };

        Ok(Self {
            app_env,
            bind_addr,
            database_url: required("DATABASE_URL")?,
            database_max_connections: database_max_connections as u32,
            run_migrations,
            cors_allowed_origins,
            request_timeout_seconds,
            request_body_limit_bytes,
            log_format,
            workos,
        })
    }
}

fn parse_u64(key: &'static str, value: &str) -> Result<u64, ConfigError> {
    value
        .parse()
        .map_err(|_| ConfigError::invalid(key, "must be a positive integer"))
}

fn parse_bool(key: &'static str, value: &str) -> Result<bool, ConfigError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(ConfigError::invalid(key, "must be a boolean")),
    }
}

fn parse_origins(value: &str) -> Result<Vec<HeaderValue>, ConfigError> {
    value
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(|origin| {
            origin.parse::<HeaderValue>().map_err(|_| {
                ConfigError::invalid("CORS_ALLOWED_ORIGINS", "contains an invalid origin")
            })
        })
        .collect()
}

/// Configuration errors raised at startup.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    /// A required variable is missing.
    #[error("missing required environment variable {0}")]
    Missing(String),
    /// A variable has an unusable value.
    #[error("invalid value for {key}: {reason}")]
    Invalid {
        /// Variable name.
        key: &'static str,
        /// Reason the value was rejected.
        reason: &'static str,
    },
    /// WorkOS credentials must be supplied together or not at all.
    #[error("WORKOS_CLIENT_ID and WORKOS_API_KEY must be set together")]
    IncompleteWorkos,
}

impl ConfigError {
    fn missing(key: &str) -> Self {
        Self::Missing(key.to_owned())
    }

    const fn invalid(key: &'static str, reason: &'static str) -> Self {
        Self::Invalid { key, reason }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal() -> Vec<(&'static str, &'static str)> {
        vec![("DATABASE_URL", "postgres://app:app@localhost:5432/app")]
    }

    #[test]
    fn minimal_config_uses_local_defaults() {
        let config = Config::from_source(minimal()).expect("valid config");

        assert_eq!(config.app_env, AppEnv::Local);
        assert_eq!(config.bind_addr, SocketAddr::from(([0, 0, 0, 0], 8080)));
        assert_eq!(config.database_max_connections, 5);
        assert!(config.run_migrations);
        assert_eq!(config.log_format, LogFormat::Pretty);
        assert!(config.workos.is_none());
        assert_eq!(
            config.cors_allowed_origins,
            vec![HeaderValue::from_static("http://localhost:5173")]
        );
    }

    #[test]
    fn database_url_is_required() {
        let error = Config::from_source(Vec::<(&str, &str)>::new()).expect_err("missing db url");
        assert_eq!(error, ConfigError::Missing("DATABASE_URL".to_owned()));
    }

    #[test]
    fn invalid_bind_addr_is_rejected() {
        let mut source = minimal();
        source.push(("BIND_ADDR", "not-a-socket"));
        let error = Config::from_source(source).expect_err("invalid bind");
        assert_eq!(
            error,
            ConfigError::Invalid {
                key: "BIND_ADDR",
                reason: "must be a host:port pair"
            }
        );
    }

    #[test]
    fn production_defaults_to_json_logs_and_no_migrations() {
        let mut source = minimal();
        source.push(("APP_ENV", "production"));
        let config = Config::from_source(source).expect("valid config");

        assert_eq!(config.app_env, AppEnv::Production);
        assert_eq!(config.log_format, LogFormat::Json);
        assert!(!config.run_migrations);
        assert!(config.cors_allowed_origins.is_empty());
    }

    #[test]
    fn cors_origins_are_split_and_trimmed() {
        let mut source = minimal();
        source.push((
            "CORS_ALLOWED_ORIGINS",
            "https://a.example, https://b.example",
        ));
        let config = Config::from_source(source).expect("valid config");

        assert_eq!(
            config.cors_allowed_origins,
            vec![
                HeaderValue::from_static("https://a.example"),
                HeaderValue::from_static("https://b.example"),
            ]
        );
    }

    #[test]
    fn workos_requires_both_credentials() {
        let mut source = minimal();
        source.push(("WORKOS_CLIENT_ID", "client_123"));
        let error = Config::from_source(source).expect_err("incomplete workos");
        assert_eq!(error, ConfigError::IncompleteWorkos);
    }

    #[test]
    fn workos_credentials_are_loaded_together() {
        let mut source = minimal();
        source.push(("WORKOS_CLIENT_ID", "client_123"));
        source.push(("WORKOS_API_KEY", "sk_test_123"));
        source.push(("WORKOS_ISSUER", "https://example.authkit.app"));
        let config = Config::from_source(source).expect("valid config");

        let workos = config.workos.expect("workos configured");
        assert_eq!(workos.client_id, "client_123");
        assert_eq!(workos.api_key, "sk_test_123");
        assert_eq!(
            workos.issuer.as_deref(),
            Some("https://example.authkit.app")
        );
    }

    #[test]
    fn connection_count_is_bounded() {
        let mut source = minimal();
        source.push(("DATABASE_MAX_CONNECTIONS", "0"));
        let error = Config::from_source(source).expect_err("too few connections");

        assert_eq!(
            error,
            ConfigError::Invalid {
                key: "DATABASE_MAX_CONNECTIONS",
                reason: "must be between 1 and 100"
            }
        );
    }
}
