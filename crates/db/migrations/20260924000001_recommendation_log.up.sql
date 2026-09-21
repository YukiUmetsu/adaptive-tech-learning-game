-- Optional auxiliary log of recommendations shown to learners.
--
-- This is deliberately NOT learning evidence: it never feeds scoring, rewards,
-- concept state, or mastery. It exists so recommendation quality can be reviewed
-- later. Writes are best-effort and failures never block a recommendation.

CREATE TABLE recommendation_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    track_id text NOT NULL,
    track_version text NOT NULL,
    action text NOT NULL,
    reason text NOT NULL,
    domain_id text,
    node_id text,
    question_id text,
    concept_ids text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recommendation_log_track_not_blank CHECK (btrim(track_id) <> ''),
    CONSTRAINT recommendation_log_version_not_blank CHECK (btrim(track_version) <> ''),
    CONSTRAINT recommendation_log_action_not_blank CHECK (btrim(action) <> ''),
    CONSTRAINT recommendation_log_reason_not_blank CHECK (btrim(reason) <> '')
);

-- Query pattern: review a learner's recent recommendation history.
CREATE INDEX recommendation_log_user_created_idx
    ON recommendation_log (user_id, created_at);
