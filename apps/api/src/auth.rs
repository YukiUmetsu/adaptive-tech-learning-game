//! Authentication and the authenticated-user extractor.
//!
//! The API never trusts a client-supplied identity. Ownership always comes from
//! a verified WorkOS AuthKit access token:
//!
//! ```text
//! Authorization: Bearer <access token>
//!         -> verify signature (provider JWKS), exp, iss, client_id
//!         -> provider subject (`sub`)
//!         -> find/upsert internal users row
//!         -> AuthenticatedUser { id, auth_subject, email }
//! ```
//!
//! `device_id` remains useful context (see [`device_header`]) but is never an
//! authorization boundary.
//!
//! Local development and automated tests run without WorkOS credentials using
//! [`DevVerifier`], which only understands an explicit `dev:<subject>` bearer
//! token and is unreachable in staging/production (enforced in `Config`).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::FromRequestParts;
use axum::http::header;
use axum::http::request::Parts;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use uuid::Uuid;

use adaptive_learn_db as db;

use crate::config::{AuthMode, Config};
use crate::error::ApiError;
use crate::state::AppState;

/// Identity provider key stored on every internal user.
pub const AUTH_PROVIDER: &str = "workos";

/// Header carrying optional device/install context. Never an auth factor.
pub const DEVICE_HEADER: &str = "x-device-id";

/// Default WorkOS issuer for access tokens (normalized, no trailing slash).
const WORKOS_ISSUER: &str = "https://api.workos.com";

/// How long fetched signing keys are reused before a refresh.
const JWKS_TTL: Duration = Duration::from_secs(60 * 60);

/// Clock skew allowance when validating `exp`.
const CLOCK_SKEW_SECONDS: u64 = 30;

type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// A verified external identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedIdentity {
    /// Stable provider subject (`sub`).
    pub subject: String,
    /// Provider email, when the token carries one.
    pub email: Option<String>,
}

/// Why a token could not be accepted.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AuthError {
    /// The token is missing, malformed, expired, or fails validation.
    #[error("invalid authentication token")]
    Invalid,
    /// Verification could not run (for example the JWKS endpoint is down).
    #[error("authentication verification is unavailable")]
    Unavailable,
}

/// Verifies a bearer token and returns the external identity it proves.
pub trait TokenVerifier: Send + Sync {
    /// Verifies `token`, returning the proven identity.
    fn verify<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<VerifiedIdentity, AuthError>>;
}

/// True when a token is acceptable to the current verifier, used only by tests
/// and the demo/dev tooling.
pub fn is_dev_token(token: &str) -> bool {
    token
        .strip_prefix("dev:")
        .map(str::trim)
        .is_some_and(|subject| !subject.is_empty())
}

/// Local/test verifier for the explicit `dev:<subject>` bearer scheme.
///
/// This exists so developers and automated tests do not need real WorkOS
/// credentials. It is only ever constructed for `local` and `test`
/// environments; staging/production require WorkOS configuration at startup.
#[derive(Debug, Default, Clone)]
pub struct DevVerifier;

impl TokenVerifier for DevVerifier {
    fn verify<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<VerifiedIdentity, AuthError>> {
        Box::pin(async move {
            let subject = token
                .strip_prefix("dev:")
                .map(str::trim)
                .filter(|subject| !subject.is_empty())
                .ok_or(AuthError::Invalid)?;
            Ok(VerifiedIdentity {
                subject: subject.to_owned(),
                email: None,
            })
        })
    }
}

/// A JSON Web Key from a provider JWKS document.
#[derive(Debug, Clone, Deserialize)]
pub struct Jwk {
    /// Key id matched against the token header.
    pub kid: Option<String>,
    /// Key type; only `RSA` is supported.
    pub kty: String,
    /// Base64url-encoded RSA modulus.
    pub n: Option<String>,
    /// Base64url-encoded RSA exponent.
    pub e: Option<String>,
    /// Advertised signing algorithm.
    #[serde(default)]
    pub alg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JwksDocument {
    keys: Vec<Jwk>,
}

/// Supplies signing keys to [`WorkosVerifier`].
pub trait JwksSource: Send + Sync {
    /// Fetches the current keys.
    fn fetch(&self) -> BoxFuture<'_, Result<Vec<Jwk>, AuthError>>;
}
/// Fetches keys from the WorkOS JWKS endpoint.
pub struct WorkosJwks {
    http: reqwest::Client,
    url: String,
}

impl WorkosJwks {
    /// Builds a source for the given JWKS URL.
    pub fn new(url: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            url,
        }
    }
}

impl JwksSource for WorkosJwks {
    fn fetch(&self) -> BoxFuture<'_, Result<Vec<Jwk>, AuthError>> {
        Box::pin(async move {
            let response = self
                .http
                .get(&self.url)
                .send()
                .await
                .map_err(|_| AuthError::Unavailable)?;
            if !response.status().is_success() {
                return Err(AuthError::Unavailable);
            }
            let document: JwksDocument =
                response.json().await.map_err(|_| AuthError::Unavailable)?;
            Ok(document.keys)
        })
    }
}

/// In-memory JWKS source, used by tests and fixtures.
pub struct StaticJwks {
    keys: Vec<Jwk>,
}

impl StaticJwks {
    /// Builds a source with fixed keys.
    pub fn new(keys: Vec<Jwk>) -> Self {
        Self { keys }
    }
}

impl JwksSource for StaticJwks {
    fn fetch(&self) -> BoxFuture<'_, Result<Vec<Jwk>, AuthError>> {
        Box::pin(async move { Ok(self.keys.clone()) })
    }
}

/// Supplies non-identity profile data for a verified subject.
///
/// Used to fill in the account email, which WorkOS access tokens do not carry.
/// Profile lookup is advisory: a failure never blocks authentication.
pub trait ProfileDirectory: Send + Sync {
    /// Returns the provider email for `subject`, if one is available.
    fn email_for<'a>(&'a self, subject: &'a str) -> BoxFuture<'a, Option<String>>;
}

/// Looks up a WorkOS user profile with the server-side API key.
///
/// This is only ever called when the stored account has no email yet, so a
/// normal account incurs at most one profile request in its lifetime.
pub struct WorkosDirectory {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl WorkosDirectory {
    /// Builds a directory client. The API key never leaves the server.
    pub fn new(api_key: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: "https://api.workos.com".to_owned(),
            api_key,
        }
    }
}

#[derive(Debug, Deserialize)]
struct WorkosProfile {
    #[serde(default)]
    email: Option<String>,
}

impl ProfileDirectory for WorkosDirectory {
    fn email_for<'a>(&'a self, subject: &'a str) -> BoxFuture<'a, Option<String>> {
        Box::pin(async move {
            let url = format!("{}/user_management/users/{}", self.base_url, subject);
            let response = self
                .http
                .get(url)
                .bearer_auth(&self.api_key)
                .send()
                .await
                .ok()?;
            if !response.status().is_success() {
                return None;
            }
            let profile: WorkosProfile = response.json().await.ok()?;
            profile.email.filter(|email| !email.trim().is_empty())
        })
    }
}

struct CachedJwks {
    keys: HashMap<String, DecodingKey>,
    fetched_at: Instant,
}

/// Verifies WorkOS AuthKit access tokens.
pub struct WorkosVerifier {
    client_id: String,
    accepted_issuers: Vec<String>,
    source: Arc<dyn JwksSource>,
    cache: tokio::sync::RwLock<Option<CachedJwks>>,
}

impl WorkosVerifier {
    /// Builds a verifier for one WorkOS application.
    pub fn new(
        client_id: String,
        accepted_issuers: Vec<String>,
        source: Arc<dyn JwksSource>,
    ) -> Self {
        Self {
            client_id,
            accepted_issuers,
            source,
            cache: tokio::sync::RwLock::new(None),
        }
    }

    /// Resolves the decoding key for a token's `kid`, refreshing the cache when
    /// the key is unknown or the cached copy is stale.
    async fn decoding_key(&self, kid: &str) -> Result<DecodingKey, AuthError> {
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.as_ref() {
                if cached.fetched_at.elapsed() < JWKS_TTL {
                    if let Some(key) = cached.keys.get(kid) {
                        return Ok(key.clone());
                    }
                }
            }
        }

        // Unknown key or stale cache: refresh once.
        let jwks = self.source.fetch().await?;
        let mut keys = HashMap::new();
        for jwk in jwks {
            let Some(key_id) = jwk.kid.as_deref() else {
                continue;
            };
            if let Ok(key) = decoding_key_from_jwk(&jwk) {
                keys.insert(key_id.to_owned(), key);
            }
        }

        let found = keys.get(kid).cloned();
        *self.cache.write().await = Some(CachedJwks {
            keys,
            fetched_at: Instant::now(),
        });
        found.ok_or(AuthError::Invalid)
    }
}

fn decoding_key_from_jwk(jwk: &Jwk) -> Result<DecodingKey, AuthError> {
    if jwk.kty != "RSA" {
        return Err(AuthError::Invalid);
    }
    let n = jwk.n.as_deref().ok_or(AuthError::Invalid)?;
    let e = jwk.e.as_deref().ok_or(AuthError::Invalid)?;
    DecodingKey::from_rsa_components(n, e).map_err(|_| AuthError::Invalid)
}

#[derive(Debug, Deserialize)]
struct AccessTokenClaims {
    sub: String,
    #[serde(default)]
    iss: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    email: Option<String>,
}

impl TokenVerifier for WorkosVerifier {
    fn verify<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<VerifiedIdentity, AuthError>> {
        Box::pin(async move {
            let header = decode_header(token).map_err(|_| AuthError::Invalid)?;
            if header.alg != Algorithm::RS256 {
                return Err(AuthError::Invalid);
            }
            let kid = header.kid.ok_or(AuthError::Invalid)?;
            let key = self.decoding_key(&kid).await?;

            let mut validation = Validation::new(Algorithm::RS256);
            // WorkOS access tokens identify the application with `client_id`
            // rather than the standard `aud` claim, so audience validation is
            // replaced by an explicit `client_id` check below.
            validation.validate_aud = false;
            validation.leeway = CLOCK_SKEW_SECONDS;

            let data = decode::<AccessTokenClaims>(token, &key, &validation)
                .map_err(|_| AuthError::Invalid)?;
            let claims = data.claims;

            if claims.sub.trim().is_empty() {
                return Err(AuthError::Invalid);
            }
            if claims.client_id.as_deref() != Some(self.client_id.as_str()) {
                return Err(AuthError::Invalid);
            }

            let issuer = claims.iss.as_deref().ok_or(AuthError::Invalid)?;
            let issuer = issuer.trim_end_matches('/');
            if !self.accepted_issuers.iter().any(|known| known == issuer) {
                return Err(AuthError::Invalid);
            }

            Ok(VerifiedIdentity {
                subject: claims.sub,
                email: claims.email.filter(|value| !value.trim().is_empty()),
            })
        })
    }
}

/// Authentication components implied by validated startup configuration.
pub struct Authenticator {
    /// Verifies bearer tokens.
    pub verifier: Arc<dyn TokenVerifier>,
    /// Optional provider profile lookup for advisory data such as email.
    pub profile: Option<Arc<dyn ProfileDirectory>>,
}

/// Builds the token verifier and profile directory from configuration.
pub fn build_authenticator(config: &Config) -> Authenticator {
    match config.auth {
        AuthMode::Dev => Authenticator {
            verifier: Arc::new(DevVerifier),
            profile: None,
        },
        AuthMode::Workos => {
            let workos = config
                .workos
                .as_ref()
                .expect("validated: Workos auth mode always has credentials");
            let issuer = workos
                .issuer
                .as_deref()
                .map(|value| value.trim_end_matches('/').to_owned())
                .unwrap_or_else(|| WORKOS_ISSUER.to_owned());
            let base = issuer.trim_end_matches('/');
            let jwks_url = format!("{base}/sso/jwks/{}", workos.client_id);
            let source = Arc::new(WorkosJwks::new(jwks_url));
            Authenticator {
                verifier: Arc::new(WorkosVerifier::new(
                    workos.client_id.clone(),
                    vec![issuer],
                    source,
                )),
                profile: Some(Arc::new(WorkosDirectory::new(workos.api_key.clone()))),
            }
        }
    }
}

/// A request proven to come from an authenticated learner.
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    /// Internal application user id. This is the ownership key.
    pub id: Uuid,
    /// Stable provider subject, kept for audit/telemetry.
    pub auth_subject: String,
    /// Provider email, when available.
    pub email: Option<String>,
}

/// Optional authentication for public/partially public routes.
///
/// A missing `Authorization` header yields `None`; a present but invalid token
/// is rejected so a bad token cannot silently downgrade to anonymous.
#[derive(Debug, Clone)]
pub struct OptionalUser(pub Option<AuthenticatedUser>);

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        match resolve_user(parts, state).await {
            Ok(Some(user)) => Ok(user),
            Ok(None) => Err(ApiError::Unauthorized),
            Err(AuthError::Unavailable) => Err(ApiError::Unavailable),
            Err(error) => {
                tracing::debug!(error = %error, "authentication failed");
                Err(ApiError::Unauthorized)
            }
        }
    }
}

impl FromRequestParts<AppState> for OptionalUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        match resolve_user(parts, state).await {
            Ok(user) => Ok(Self(user)),
            Err(AuthError::Unavailable) => Err(ApiError::Unavailable),
            Err(error) => {
                tracing::debug!(error = %error, "authentication failed");
                Err(ApiError::Unauthorized)
            }
        }
    }
}

async fn resolve_user(
    parts: &Parts,
    state: &AppState,
) -> Result<Option<AuthenticatedUser>, AuthError> {
    let Some(token) = bearer_token(parts) else {
        return Ok(None);
    };

    let identity = state.auth.verify(token).await?;

    let mut user = db::users::upsert_by_auth_subject(
        &state.pool,
        AUTH_PROVIDER,
        &identity.subject,
        identity.email.as_deref(),
    )
    .await
    .map_err(|error| {
        // Never log the token or the raw database error message.
        tracing::warn!(error = %error, "could not resolve authenticated user");
        AuthError::Unavailable
    })?;

    // WorkOS access tokens do not carry an email, so fill it from the provider
    // profile once. The lookup is advisory and never blocks authentication.
    if user.email.is_none() {
        if let Some(profile) = state.profile.as_ref() {
            if let Some(email) = profile.email_for(&identity.subject).await {
                match db::users::upsert_by_auth_subject(
                    &state.pool,
                    AUTH_PROVIDER,
                    &identity.subject,
                    Some(&email),
                )
                .await
                {
                    Ok(updated) => user = updated,
                    Err(error) => {
                        tracing::debug!(error = %error, "could not store provider email");
                    }
                }
            }
        }
    }

    // Device association is best-effort context, never authorization.
    if let Some(device_id) = device_header(parts) {
        if let Err(error) = db::devices::upsert(&state.pool, device_id, user.id).await {
            tracing::debug!(error = %error, "could not associate device with user");
        }
    }

    Ok(Some(AuthenticatedUser {
        id: user.id,
        auth_subject: identity.subject,
        email: user.email,
    }))
}

/// Extracts a bearer token from the `Authorization` header.
pub fn bearer_token(parts: &Parts) -> Option<&str> {
    let value = parts.headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let token = token.trim();
    (!token.is_empty()).then_some(token)
}

/// Extracts an optional device id from the `X-Device-Id` header.
pub fn device_header(parts: &Parts) -> Option<Uuid> {
    parts
        .headers
        .get(DEVICE_HEADER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{EncodingKey, Header, encode};

    // Test-only RSA key pair. Never a production credential.
    const TEST_PRIVATE_PEM: &str = "-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDr0AsWHmHi2U9/
2FAEzg/m+KnjixfWuFNaTnGRQu9Bq+sdCYsDmmC17tce19DwbOUaa5+KzvJRsAd/
lweRAGcDaI/jQP0bSNEs1TN8TTjF+x0bpa62eW92ZoSA4Y//LzEYjb3i8qpTmFwy
pfOK9Zf40SBu38af3ySvAfeyyaMsRc5xK5pV5VfU3RItqFnZLTo8BohN60myHp04
Cj69SG2oXCnBSL5XccrT0D56vFwxTDJxgxrwjhsY78QGp6AfOqUFBD5TsiDtB5+c
gLzic3Btv2amd5usbyub4dRRMmTBXWhMWaP5K4xFA0YCzHxC4/LEYgRD5HS22jga
17PFxxQNAgMBAAECggEAHwWD59mAXBTlcfaVdERdcC+nPdFnBe7CvF8Ubp0lF3kT
2YKPYJ52+Ygdkaeni3Fv5D1jRCH8W8Wx/tVx/9/TLW4ce7NpeKToK6Myfjg0b0sd
Ja1yofuwr51F8iR6SoI9TbMb11bAFHY3LsyJEO9FGkz8nMlgelijHUi/eqwvBJw7
qo0WGzQI7wBqAdcvkr497Ki2PF6Z+Uzjr9h9lIrIiRYLvg7vh0e09xvle82ls7qo
1XeUPYhMmZjuczoP66ZgQHTd5I2IuLZ8oM+G+c4OxgAhmBu6Q3Ijnyq8y31tJWoZ
3M/tIPPyED0mGuqzePP6w+BUAOzkSjstqgYjBnhtWwKBgQD2PL8eANMUyvXlVQ6R
G65VuV2hgWcNDOMC3b9bzqXcMTtZVazwJkq8pinenyMsYEQVIHixu1MKyMuZzFED
36+TdUOjO6UQASoQEpkHuXIS7+UaBRBk2mWSXeGbz4ky0jUdwd/rfM06ga4gjxK2
H8BHmbBM9+cCmApJTJObZmIqbwKBgQD1KX06XDkkHLQO3P1VS42wkKf0WfcJFgqY
PM1JUDnO61hQ2vAhrtJzv9k4qCao8FUbbWKq+Z7UN5G3dXygzMFdlMRaBg8i8BNi
ZWwhgDaaUQEEN2sm/SPcOJI5LsQInu8Qa0YwmTLGGHTsM5vkG6SqDrw7II1NkHqR
ZlSxNxoXQwKBgH1dFBhcZxsQ8fweP9pU838lbqwJS8PzKaiN6Rz+qqbeUc77tZ5W
gHpnRq3W63tuT3tKGuix7GdzL2VQBncobSVv8E2s0i7ByP6B2XN7UL6fcE69AUm3
fzrznSdMlBdRukU6LZyg34PH/jUJYodixuwtLPsiw3QooCQNXqEhkRz1AoGAYTCy
eXloGb3bT+0h7TeHk1C1lLQ5r/tx9cpc48yPLk20dFFnUyMYQVT0C3b15JFqW/Yw
YHGXGrBw7xb/ckvZ+Hxqnvm59HLSbHaiuGE4xFKKoZ5Kt2kxVzOCHHNCudwwEAVH
DSseqtO1PpJzIaonzFcNHi+YdQBq5st3lc2vZTsCgYAMscH1o8XRNpUzJwhV4iIS
5xCyTw/TSklDrmo6OIfrfor3ksnj4V7A3eNcUp6nJ/XfmqpPnFKlFG9ff/boakEG
nXPv2IDB3ly+UhQ9IBpPLJ2b01zRMkfVgA9PjH8k2BUJLu2VcpTv8zT/W2RLRn49
INjFT9+ehEH8ohGHeB1QIw==
-----END PRIVATE KEY-----";

    const TEST_MODULUS: &str = "69ALFh5h4tlPf9hQBM4P5vip44sX1rhTWk5xkULvQavrHQmLA5pgte7XHtfQ8GzlGmufis7yUbAHf5cHkQBnA2iP40D9G0jRLNUzfE04xfsdG6WutnlvdmaEgOGP_y8xGI294vKqU5hcMqXzivWX-NEgbt_Gn98krwH3ssmjLEXOcSuaVeVX1N0SLahZ2S06PAaITetJsh6dOAo-vUhtqFwpwUi-V3HK09A-erxcMUwycYMa8I4bGO_EBqegHzqlBQQ-U7Ig7QefnIC84nNwbb9mpnebrG8rm-HUUTJkwV1oTFmj-SuMRQNGAsx8QuPyxGIEQ-R0tto4GtezxccUDQ";
    const TEST_EXPONENT: &str = "AQAB";
    const CLIENT_ID: &str = "client_test_123";

    fn jwk(kid: &str, n: &str, e: &str) -> Jwk {
        Jwk {
            kid: Some(kid.to_owned()),
            kty: "RSA".to_owned(),
            n: Some(n.to_owned()),
            e: Some(e.to_owned()),
            alg: Some("RS256".to_owned()),
        }
    }

    fn verifier() -> WorkosVerifier {
        let source = StaticJwks::new(vec![jwk("test-key", TEST_MODULUS, TEST_EXPONENT)]);
        WorkosVerifier::new(
            CLIENT_ID.to_owned(),
            vec![WORKOS_ISSUER.to_owned()],
            Arc::new(source),
        )
    }

    #[derive(serde::Serialize)]
    struct TokenClaims {
        sub: String,
        iss: String,
        client_id: String,
        exp: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        email: Option<String>,
    }

    fn token(kid: &str, claims: TokenClaims) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(kid.to_owned());
        let key = EncodingKey::from_rsa_pem(TEST_PRIVATE_PEM.as_bytes()).expect("test key");
        encode(&header, &claims, &key).expect("sign token")
    }

    fn valid_claims() -> TokenClaims {
        TokenClaims {
            sub: "user_abc123".to_owned(),
            iss: WORKOS_ISSUER.to_owned(),
            client_id: CLIENT_ID.to_owned(),
            exp: chrono::Utc::now().timestamp() + 300,
            email: Some("learner@example.com".to_owned()),
        }
    }

    #[tokio::test]
    async fn dev_verifier_accepts_explicit_subject() {
        let identity = DevVerifier
            .verify("dev:local-user")
            .await
            .expect("valid dev token");
        assert_eq!(identity.subject, "local-user");
    }

    #[tokio::test]
    async fn dev_verifier_rejects_other_tokens() {
        assert!(DevVerifier.verify("real.jwt.token").await.is_err());
        assert!(DevVerifier.verify("dev:").await.is_err());
    }

    #[tokio::test]
    async fn workos_verifier_accepts_a_valid_token() {
        let identity = verifier()
            .verify(&token("test-key", valid_claims()))
            .await
            .expect("valid token");
        assert_eq!(identity.subject, "user_abc123");
        assert_eq!(identity.email.as_deref(), Some("learner@example.com"));
    }

    #[tokio::test]
    async fn workos_verifier_rejects_expired_token() {
        let mut claims = valid_claims();
        claims.exp = chrono::Utc::now().timestamp() - 120;
        assert!(
            verifier().verify(&token("test-key", claims)).await.is_err(),
            "expired token must be rejected"
        );
    }

    #[tokio::test]
    async fn workos_verifier_rejects_wrong_issuer() {
        let mut claims = valid_claims();
        claims.iss = "https://evil.example".to_owned();
        assert!(
            verifier().verify(&token("test-key", claims)).await.is_err(),
            "unexpected issuer must be rejected"
        );
    }

    #[tokio::test]
    async fn workos_verifier_rejects_wrong_client_id() {
        let mut claims = valid_claims();
        claims.client_id = "client_someone_else".to_owned();
        assert!(
            verifier().verify(&token("test-key", claims)).await.is_err(),
            "token for another client must be rejected"
        );
    }

    #[tokio::test]
    async fn workos_verifier_rejects_unknown_key() {
        assert!(
            verifier()
                .verify(&token("rotated-out", valid_claims()))
                .await
                .is_err(),
            "unknown kid must be rejected"
        );
    }

    #[tokio::test]
    async fn workos_verifier_normalizes_trailing_slash_in_issuer() {
        let mut claims = valid_claims();
        claims.iss = format!("{WORKOS_ISSUER}/");
        assert!(verifier().verify(&token("test-key", claims)).await.is_ok());
    }
}
