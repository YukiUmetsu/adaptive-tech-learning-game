use adaptive_learn_domain::DomainError;

/// Errors returned by the persistence layer.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    /// The database rejected or failed a query.
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    /// A stored value violated a domain invariant.
    #[error(transparent)]
    Domain(#[from] DomainError),
    /// Migrations could not be applied.
    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
}

impl DbError {
    /// Whether this error is a PostgreSQL unique-constraint violation.
    pub fn is_unique_violation(&self) -> bool {
        match self {
            Self::Sqlx(sqlx::Error::Database(database)) => {
                database.code().as_deref() == Some("23505")
            }
            _ => false,
        }
    }
}
