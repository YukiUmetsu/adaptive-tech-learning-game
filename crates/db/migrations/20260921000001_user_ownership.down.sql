-- Reverses user ownership. Best-effort: rows written under the user-owned model
-- have user_id values that the device-owned model cannot represent, so they are
-- not preserved here. This mirrors the project's reversible-migration policy.
DROP INDEX IF EXISTS bit_transactions_user_created_idx;

ALTER TABLE bit_transactions
    ADD CONSTRAINT bit_transactions_device_id_fkey
    FOREIGN KEY (device_id) REFERENCES device_wallets (device_id) ON DELETE CASCADE;

ALTER TABLE bit_transactions
    DROP COLUMN IF EXISTS user_id;

DROP INDEX IF EXISTS learning_events_user_received_idx;

ALTER TABLE learning_events
    DROP COLUMN IF EXISTS user_id;

DROP INDEX IF EXISTS mission_instances_user_status_idx;

ALTER TABLE mission_instances
    DROP COLUMN IF EXISTS user_id;

DROP TABLE IF EXISTS user_wallets;
DROP TABLE IF EXISTS devices;
