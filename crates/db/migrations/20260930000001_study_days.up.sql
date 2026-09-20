-- Account-wide daily study streak (V1).
--
-- One row per qualified `(user, local_day)`. A day qualifies when the learner
-- accepts at least one scored learning event; opening pages, revealing cards,
-- viewing recommendations, and telemetry never qualify.
--
-- Storing unique days (instead of a mutable counter) makes the streak
-- idempotent: duplicate syncs and retries cannot advance it twice, and the
-- current/longest streak are derived deterministically on read.
--
-- The streak is motivational, not learning evidence. It never touches
-- `learning_events`, `user_concept_state`, wallets, or rewards.
--
-- The `local_day` uses the learner's persisted IANA timezone (`users.timezone`),
-- the same boundary Daily Missions use, so changing the timezone cannot farm
-- extra study days.
CREATE TABLE user_study_days (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    local_day date NOT NULL,
    first_qualified_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_study_days_pk PRIMARY KEY (user_id, local_day)
);

-- Query pattern: recent active days for one learner, newest first.
CREATE INDEX user_study_days_user_day_idx
    ON user_study_days (user_id, local_day DESC);
