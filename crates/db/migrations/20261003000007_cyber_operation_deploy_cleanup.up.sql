-- Cyber Defense Stage 2.3.1: settle/completion now requires a deployed run.
--
-- Active runs created before `deployed_at` existed appear configurable even if
-- the player had already started fighting. There is no reliable signal to
-- backfill "this run had progressed", and the product has not launched, so the
-- simple, honest choice is to invalidate those pre-deploy runs rather than
-- invent an unsafe heuristic. New runs created after this migration are
-- unaffected: they are configurable until the player explicitly DEPLOYs.
--
-- This also guarantees the invariant "an undeployed Operation can never be
-- settled" holds for legacy rows, not just for rows created after the change.

UPDATE cyber_operation_runs
SET status = 'abandoned',
    completed_at = COALESCE(completed_at, now())
WHERE status = 'active'
  AND deployed_at IS NULL;
