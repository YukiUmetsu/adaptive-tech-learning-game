-- Phase 0 foundation: accounts and batch sync metadata.
--
-- Raw learning history will live in object storage, not here. These tables only
-- hold the transactional identity and sync bookkeeping needed to prove the
-- architecture.

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_provider text NOT NULL,
    auth_subject text,
    email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_auth_provider_not_blank CHECK (btrim(auth_provider) <> ''),
    CONSTRAINT users_auth_subject_not_blank CHECK (auth_subject IS NULL OR btrim(auth_subject) <> '')
);

-- One external identity maps to at most one account. Accounts that are not yet
-- linked have a NULL subject and are excluded from the constraint.
CREATE UNIQUE INDEX users_auth_provider_subject_idx
    ON users (auth_provider, auth_subject)
    WHERE auth_subject IS NOT NULL;

CREATE TABLE sync_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_id uuid NOT NULL,
    client_batch_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    event_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    received_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sync_batches_status_valid
        CHECK (status IN ('pending', 'applied', 'rejected')),
    CONSTRAINT sync_batches_event_count_non_negative
        CHECK (event_count >= 0),
    CONSTRAINT sync_batches_user_client_unique
        UNIQUE (user_id, client_batch_id)
);

-- Query pattern: list a learner's batches filtered by reconciliation status.
CREATE INDEX sync_batches_user_status_idx ON sync_batches (user_id, status);
