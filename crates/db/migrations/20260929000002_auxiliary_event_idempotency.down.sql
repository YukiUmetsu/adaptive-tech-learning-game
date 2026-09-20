-- Revert auxiliary telemetry idempotency.
ALTER TABLE recommendation_events
    DROP CONSTRAINT IF EXISTS recommendation_events_event_id_key;

ALTER TABLE recommendation_events
    DROP COLUMN IF EXISTS event_id;
