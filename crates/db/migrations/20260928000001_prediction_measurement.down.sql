-- Revert prediction measurement and the local-day timezone column.

DROP TABLE IF EXISTS prediction_outcomes;
DROP TABLE IF EXISTS prediction_snapshots;

ALTER TABLE users DROP COLUMN IF EXISTS timezone;
