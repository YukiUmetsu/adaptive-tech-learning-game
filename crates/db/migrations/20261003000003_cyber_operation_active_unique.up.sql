-- At most one active Operation run per learner.
--
-- The start endpoint checks for an active run first, but this partial unique
-- index makes the rule hold even when two start requests race, so a learner can
-- never accumulate parallel active runs.

CREATE UNIQUE INDEX cyber_operation_runs_one_active_idx
    ON cyber_operation_runs (user_id)
    WHERE status = 'active';
