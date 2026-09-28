-- Cyber Defense Stage 2.2: Operation offers and cosmetic Bits sinks.
--
-- `cyber_operation_offers` holds short-lived server-issued Operation choices so
-- a client can only start a template the server actually offered (and that is
-- currently unlocked). `cyber_cosmetic_unlocks` is the permanent, no-gameplay
-- effect Bits sink used once functional Tower rooms are maxed; the equipped
-- theme lives on the existing profile row.

CREATE TABLE cyber_operation_offers (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    seed BIGINT NOT NULL,
    template_id TEXT NOT NULL,
    adversary_id TEXT NOT NULL,
    adversary_rank INTEGER NOT NULL CHECK (adversary_rank >= 1),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX cyber_operation_offers_user_created_idx
    ON cyber_operation_offers(user_id, created_at DESC);

CREATE TABLE cyber_cosmetic_unlocks (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cosmetic_id TEXT NOT NULL,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, cosmetic_id)
);

ALTER TABLE cyber_defense_profiles
    ADD COLUMN equipped_theme TEXT;
