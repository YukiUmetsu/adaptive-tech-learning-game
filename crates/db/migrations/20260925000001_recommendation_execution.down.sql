-- Revert recommendation execution and lifecycle telemetry.

DROP TABLE IF EXISTS recommendation_events;

ALTER TABLE recommendation_log
    DROP CONSTRAINT IF EXISTS recommendation_log_recommendation_id_key;

ALTER TABLE recommendation_log
    DROP COLUMN IF EXISTS recommendation_id;

DROP INDEX IF EXISTS mission_instances_recommendation_idx;

ALTER TABLE mission_instances
    DROP COLUMN IF EXISTS recommendation_id;

ALTER TABLE mission_instances
    DROP CONSTRAINT mission_instances_mode_valid;

ALTER TABLE mission_instances
    ADD CONSTRAINT mission_instances_mode_valid CHECK (
        mode IN ('quick_adaptive', 'domain_quiz', 'full_practice', 'task_practice')
    );
