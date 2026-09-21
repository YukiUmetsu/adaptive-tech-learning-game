-- Revert learner study settings.
ALTER TABLE users
    DROP COLUMN IF EXISTS unlock_all_materials;
