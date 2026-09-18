-- Reverses quiz modes, mixed-domain missions, expanded interaction types, and
-- the Bits currency.

DROP TABLE IF EXISTS bit_transactions;
DROP TABLE IF EXISTS device_wallets;

ALTER TABLE learning_events
    DROP CONSTRAINT IF EXISTS learning_events_interaction_type_valid;

ALTER TABLE learning_events
    ADD CONSTRAINT learning_events_interaction_type_valid CHECK (
        interaction_type IN ('classification', 'ordering', 'node_connection')
    );

ALTER TABLE mission_instances
    DROP CONSTRAINT IF EXISTS mission_instances_mode_valid;

ALTER TABLE mission_instances
    ALTER COLUMN domain_id SET NOT NULL,
    ALTER COLUMN task_id SET NOT NULL;

ALTER TABLE mission_instances
    DROP COLUMN IF EXISTS mode;
