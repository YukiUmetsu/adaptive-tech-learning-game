-- Revert the adaptive student-state layer.

DROP TABLE IF EXISTS user_concept_state;

ALTER TABLE learning_events
    DROP CONSTRAINT IF EXISTS learning_events_difficulty_prior_range;

ALTER TABLE learning_events
    DROP COLUMN IF EXISTS difficulty_prior;
