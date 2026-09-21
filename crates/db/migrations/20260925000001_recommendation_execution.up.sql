-- Recommendation execution and lifecycle telemetry.
--
-- Lifecycle telemetry is auxiliary: it is never learning evidence and never
-- touches scoring, rewards, or concept state. It is written best-effort after
-- the core action, in its own statements, so a telemetry failure can never roll
-- back a mission or a learning event.

-- 1. A focused recommended-practice mission anchored on one recommendation.
ALTER TABLE mission_instances
    DROP CONSTRAINT mission_instances_mode_valid;

ALTER TABLE mission_instances
    ADD CONSTRAINT mission_instances_mode_valid CHECK (
        mode IN (
            'quick_adaptive',
            'domain_quiz',
            'full_practice',
            'task_practice',
            'recommended_practice'
        )
    );

-- Context link from a mission back to the recommendation that started it. This
-- is nullable context, not an ownership or authorization key.
ALTER TABLE mission_instances
    ADD COLUMN recommendation_id uuid;

-- Query pattern: find missions started from one recommendation.
CREATE INDEX mission_instances_recommendation_idx
    ON mission_instances (recommendation_id)
    WHERE recommendation_id IS NOT NULL;

-- 2. Give every generated recommendation a stable id so lifecycle events can
--    refer to the same recommendation. Existing rows are backfilled.
ALTER TABLE recommendation_log
    ADD COLUMN recommendation_id uuid;

UPDATE recommendation_log
    SET recommendation_id = gen_random_uuid()
    WHERE recommendation_id IS NULL;

ALTER TABLE recommendation_log
    ALTER COLUMN recommendation_id SET NOT NULL;

ALTER TABLE recommendation_log
    ADD CONSTRAINT recommendation_log_recommendation_id_key UNIQUE (recommendation_id);

-- 3. Lifecycle events for a recommendation. There is intentionally no foreign
--    key to recommendation_log: generation logging is best-effort, so an event
--    must still be recordable if the generated row could not be written.
CREATE TABLE recommendation_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    track_id text NOT NULL,
    event text NOT NULL,
    action text,
    domain_id text,
    node_id text,
    question_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recommendation_events_event_valid CHECK (
        event IN ('generated', 'shown', 'clicked', 'started', 'node_opened', 'completed')
    ),
    CONSTRAINT recommendation_events_track_not_blank CHECK (btrim(track_id) <> '')
);

-- Query pattern: reconstruct the lifecycle of one recommendation.
CREATE INDEX recommendation_events_recommendation_idx
    ON recommendation_events (recommendation_id, created_at);

-- Query pattern: review a learner's recent recommendation events.
CREATE INDEX recommendation_events_user_idx
    ON recommendation_events (user_id, created_at);
