-- Reverses the Cyber Defense Stage 2 progression schema.
--
-- The tables hold only derived progression state; wallet balances and the Bits
-- ledger are untouched, so dropping them loses no spendable value.

DROP TABLE IF EXISTS cyber_operation_runs;
DROP TABLE IF EXISTS cyber_campaign_results;
DROP TABLE IF EXISTS cyber_story_progress;
DROP TABLE IF EXISTS cyber_adversary_progress;
DROP TABLE IF EXISTS cyber_tower_upgrades;
DROP TABLE IF EXISTS cyber_hero_progress;
DROP TABLE IF EXISTS cyber_defense_profiles;
