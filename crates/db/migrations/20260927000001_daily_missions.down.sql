-- Revert Daily Missions V1.

DROP INDEX IF EXISTS mission_instances_daily_item_idx;

ALTER TABLE mission_instances
    DROP COLUMN IF EXISTS daily_item_position,
    DROP COLUMN IF EXISTS daily_mission_id;

DROP TABLE IF EXISTS daily_mission_items;
DROP TABLE IF EXISTS daily_missions;
