-- Idempotent auxiliary telemetry.
--
-- Batched recommendation lifecycle telemetry may be retried after a partial
-- sync failure, so each event carries a stable client-generated id. Duplicate
-- delivery becomes harmless with an `ON CONFLICT DO NOTHING` insert. Telemetry
-- remains auxiliary and is never learning evidence.
ALTER TABLE recommendation_events
    ADD COLUMN event_id uuid;

UPDATE recommendation_events
    SET event_id = gen_random_uuid()
    WHERE event_id IS NULL;

ALTER TABLE recommendation_events
    ALTER COLUMN event_id SET NOT NULL;

ALTER TABLE recommendation_events
    ADD CONSTRAINT recommendation_events_event_id_key UNIQUE (event_id);
