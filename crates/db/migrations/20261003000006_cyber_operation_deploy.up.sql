-- Cyber Defense Stage 2.3: pre-deploy -> deployed lifecycle.
--
-- `deployed_at` is the authoritative marker that a run's configuration is
-- frozen. NULL means the run is still configurable (Engineering Lab loadout);
-- a timestamp means the battle has started and the loadout can no longer change.
-- The result `status` column keeps its existing meaning (active/completed/...).

ALTER TABLE cyber_operation_runs
    ADD COLUMN deployed_at TIMESTAMPTZ;
