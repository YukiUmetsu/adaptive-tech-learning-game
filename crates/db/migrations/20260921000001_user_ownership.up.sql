-- User-owned learning and economy state.
--
-- Ownership moves from the device to the authenticated user. `device_id` is
-- retained everywhere as device/install/session context for analytics, offline
-- reconciliation, abuse detection, and multi-device modelling, but it is never
-- an authorization proof again.
--
-- Legacy rows created before authentication existed cannot be securely
-- attributed to an account: a bare client-supplied `device_id` is not an
-- account-claim credential. Their `user_id` therefore stays NULL, they are
-- excluded from every user-scoped query, and no anonymous device balance is ever
-- promoted to a user wallet. They are retained (not dropped) so the migration is
-- non-destructive and auditable.

-- 1. Explicit device association. A device may be linked to an account for
--    context, but association is not authentication: every protected request
--    still verifies the WorkOS token.
CREATE TABLE devices (
    device_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX devices_user_idx ON devices (user_id);

-- 2. One wallet per authenticated user. Bits are user-owned, so the same
--    balance is visible from every device the learner signs in on.
CREATE TABLE user_wallets (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    bits_balance bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_wallets_bits_non_negative CHECK (bits_balance >= 0)
);

-- 3. Missions gain an owner. Nullable so legacy anonymous rows remain valid.
ALTER TABLE mission_instances
    ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;

-- Query pattern: a learner's active missions across all of their devices.
CREATE INDEX mission_instances_user_status_idx
    ON mission_instances (user_id, status);

-- 4. Accepted learning evidence gains an owner. The device stays for context so
--    future models can optionally learn device/session effects.
ALTER TABLE learning_events
    ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;

-- Query pattern: combine every device's history for one learner.
CREATE INDEX learning_events_user_received_idx
    ON learning_events (user_id, received_at);

-- 5. Bit ledger moves to user ownership. `event_id` remains globally unique, so
--    duplicate syncs can never award Bits twice regardless of ownership churn.
ALTER TABLE bit_transactions
    ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE bit_transactions
    ALTER COLUMN device_id DROP NOT NULL;

ALTER TABLE bit_transactions
    DROP CONSTRAINT bit_transactions_device_id_fkey;

CREATE INDEX bit_transactions_user_created_idx
    ON bit_transactions (user_id, created_at);
