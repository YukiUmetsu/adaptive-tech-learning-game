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
