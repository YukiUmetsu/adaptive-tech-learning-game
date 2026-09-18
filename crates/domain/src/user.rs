use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::DomainError;

/// A learner account.
///
/// The internal `id` is always a UUID and is the only primary key. External
/// identity provider identifiers are stored separately. Email is never a
/// primary key or join key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct User {
    /// Internal account identifier.
    pub id: Uuid,
    /// Identity provider key, for example `workos`.
    pub auth_provider: String,
    /// Provider-side subject identifier. `None` until an account is linked.
    pub auth_subject: Option<String>,
    /// Contact email, if the provider supplied one.
    pub email: Option<String>,
    /// Account creation time in UTC.
    pub created_at: DateTime<Utc>,
}

/// Values required to create a [`User`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewUser {
    /// Identity provider key, for example `workos`.
    pub auth_provider: String,
    /// Provider-side subject identifier.
    pub auth_subject: Option<String>,
    /// Contact email, if known.
    pub email: Option<String>,
}

impl NewUser {
    /// Creates a user bound to the WorkOS provider.
    pub fn workos(auth_subject: impl Into<String>, email: Option<String>) -> Self {
        Self {
            auth_provider: "workos".to_owned(),
            auth_subject: Some(auth_subject.into()),
            email: email.map(|value| value.trim().to_owned()),
        }
    }

    /// Validates the values before they reach the database.
    ///
    /// Rejects empty or whitespace-only provider/subject values and blank
    /// email strings so that the database never stores meaningless identities.
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.auth_provider.trim().is_empty() {
            return Err(DomainError::invalid("auth_provider", "must not be empty"));
        }
        if let Some(subject) = &self.auth_subject {
            if subject.trim().is_empty() {
                return Err(DomainError::invalid("auth_subject", "must not be blank"));
            }
        }
        if let Some(email) = &self.email {
            if email.trim().is_empty() {
                return Err(DomainError::invalid("email", "must not be blank"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workos_constructor_trims_email_and_sets_provider() {
        let new_user = NewUser::workos("user_123", Some("  learner@example.com ".to_owned()));

        assert_eq!(new_user.auth_provider, "workos");
        assert_eq!(new_user.auth_subject.as_deref(), Some("user_123"));
        assert_eq!(new_user.email.as_deref(), Some("learner@example.com"));
        assert_eq!(new_user.validate(), Ok(()));
    }

    #[test]
    fn validate_rejects_blank_provider() {
        let new_user = NewUser {
            auth_provider: "   ".to_owned(),
            auth_subject: Some("user_123".to_owned()),
            email: None,
        };

        assert_eq!(
            new_user.validate(),
            Err(DomainError::invalid("auth_provider", "must not be empty"))
        );
    }

    #[test]
    fn validate_rejects_blank_subject() {
        let new_user = NewUser {
            auth_provider: "workos".to_owned(),
            auth_subject: Some(String::new()),
            email: None,
        };

        assert!(new_user.validate().is_err());
    }

    #[test]
    fn validate_allows_missing_subject_and_email() {
        let new_user = NewUser {
            auth_provider: "workos".to_owned(),
            auth_subject: None,
            email: None,
        };

        assert_eq!(new_user.validate(), Ok(()));
    }
}
