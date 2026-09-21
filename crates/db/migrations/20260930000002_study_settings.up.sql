-- Learner study settings (V1).
--
-- `unlock_all_materials` lets a learner bypass the guided, in-order unlocking and
-- open any knowledge node. It is a preference only: it never changes scoring,
-- evidence, concept state, or rewards.
ALTER TABLE users
    ADD COLUMN unlock_all_materials boolean NOT NULL DEFAULT false;
