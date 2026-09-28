-- Idempotency ledger for one-off Cyber Defense reward settlements.
--
-- The Bits ledger already dedupes rewards by `event_id`, but a campaign replay
-- grants XP with no Bits, so it needs its own key. `event_id` is the
-- client-generated idempotency key for one result; a retry inserts nothing and
-- therefore settles no XP twice.

CREATE TABLE cyber_reward_events (
    event_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cyber_reward_events_user_idx
    ON cyber_reward_events (user_id, created_at DESC);
