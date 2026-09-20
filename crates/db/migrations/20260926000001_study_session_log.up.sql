-- Auxiliary log of generated adaptive study sessions.
--
-- This is deliberately NOT learning evidence: it never feeds scoring, rewards,
-- concept state, or mastery. Writes are best-effort and never share a
-- transaction with authoritative learning-event persistence.

CREATE TABLE study_session_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    track_id text NOT NULL,
    track_version text NOT NULL,
    available_minutes integer NOT NULL,
    preference text NOT NULL,
    estimated_minutes integer NOT NULL,
    activity_count integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT study_session_log_track_not_blank CHECK (btrim(track_id) <> ''),
    CONSTRAINT study_session_log_preference_valid CHECK (
        preference IN ('balanced', 'more_practice', 'more_learning')
    ),
    CONSTRAINT study_session_log_minutes_non_negative CHECK (
        available_minutes >= 0 AND estimated_minutes >= 0
    ),
    CONSTRAINT study_session_log_activity_count_non_negative CHECK (activity_count >= 0)
);

-- Query pattern: review a learner's recent session history.
CREATE INDEX study_session_log_user_created_idx
    ON study_session_log (user_id, created_at);
