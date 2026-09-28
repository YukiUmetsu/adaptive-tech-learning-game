-- Irreversible by design: this migration abandons pre-deploy active runs and
-- intentionally does not restore them, because a reverted schema has no way to
-- know which runs the player had actually started. No schema change is made.
SELECT 1;
