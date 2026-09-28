-- Cyber Defense Stage 2 persistent progression.
--
-- Adds the server-authoritative tables that let the existing five-mission game
-- become a long-running one: career profile, hero progression, Tower/HQ
-- upgrades, adversary progress, story progress, campaign results, and
-- repeatable Operation runs. Bits and XP awards are settled through the
-- existing `user_wallets`/`bit_transactions` ledger; these tables hold the
-- progression state those awards update.

CREATE TABLE cyber_defense_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    career_xp BIGINT NOT NULL DEFAULT 0 CHECK (career_xp >= 0),

    total_operations_completed INTEGER NOT NULL DEFAULT 0
        CHECK (total_operations_completed >= 0),

    highest_threat_level_cleared INTEGER NOT NULL DEFAULT 0
        CHECK (highest_threat_level_cleared >= 0),

    recommended_threat_level INTEGER NOT NULL DEFAULT 1
        CHECK (recommended_threat_level >= 1),

    active_story_chapter TEXT NOT NULL DEFAULT 'chapter-1',

    legacy_progress_imported BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cyber_hero_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hero_id TEXT NOT NULL,
    xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
    selected_talents JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, hero_id)
);

CREATE TABLE cyber_tower_upgrades (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    upgrade_id TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, upgrade_id)
);

CREATE TABLE cyber_adversary_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    adversary_id TEXT NOT NULL,

    progress BIGINT NOT NULL DEFAULT 0 CHECK (progress >= 0),
    encounters INTEGER NOT NULL DEFAULT 0 CHECK (encounters >= 0),
    victories INTEGER NOT NULL DEFAULT 0 CHECK (victories >= 0),

    highest_threat_level_cleared INTEGER NOT NULL DEFAULT 0
        CHECK (highest_threat_level_cleared >= 0),

    dossier_flags JSONB NOT NULL DEFAULT '[]'::jsonb,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, adversary_id)
);

CREATE TABLE cyber_story_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_node_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, story_node_id)
);

-- Authoritative one-time settlement for the five Stage 1 campaign missions.
CREATE TABLE cyber_campaign_results (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mission_id TEXT NOT NULL,

    completed BOOLEAN NOT NULL,
    best_stars INTEGER NOT NULL DEFAULT 0
        CHECK (best_stars BETWEEN 0 AND 3),
    best_health INTEGER NOT NULL DEFAULT 0
        CHECK (best_health >= 0),
    attempts INTEGER NOT NULL DEFAULT 0
        CHECK (attempts >= 0),

    first_clear_reward_settled BOOLEAN NOT NULL DEFAULT FALSE,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, mission_id)
);

CREATE TABLE cyber_operation_runs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    seed BIGINT NOT NULL,
    template_id TEXT NOT NULL,
    adversary_id TEXT NOT NULL,
    hero_id TEXT,

    threat_level INTEGER NOT NULL CHECK (threat_level >= 1),

    status TEXT NOT NULL CHECK (
        status IN ('active', 'completed', 'failed', 'abandoned')
    ),

    generated_config JSONB NOT NULL,

    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,

    result_stars INTEGER CHECK (
        result_stars IS NULL OR result_stars BETWEEN 0 AND 3
    ),
    result_health INTEGER,
    duration_ms BIGINT,

    bits_awarded BIGINT NOT NULL DEFAULT 0,
    career_xp_awarded BIGINT NOT NULL DEFAULT 0,
    hero_xp_awarded BIGINT NOT NULL DEFAULT 0,

    reward_event_id UUID UNIQUE
);

CREATE INDEX cyber_operation_runs_user_status_idx
    ON cyber_operation_runs(user_id, status);

CREATE INDEX cyber_operation_runs_user_started_idx
    ON cyber_operation_runs(user_id, started_at DESC);
