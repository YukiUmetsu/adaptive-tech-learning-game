-- Section quizzes: a one-question retrieval check that concludes a learning
-- module (section), plus a one-time completion bonus per learner/section.
--
-- Forward-only: the mission mode constraint is widened, the mission row records
-- the learning module it was scoped to, and the completion bonus is recorded so
-- it can only settle once per (user, track version, domain, module). Retaking
-- the quiz therefore cannot farm the bonus.

ALTER TABLE mission_instances
    DROP CONSTRAINT mission_instances_mode_valid;

ALTER TABLE mission_instances
    ADD CONSTRAINT mission_instances_mode_valid CHECK (
        mode IN (
            'quick_adaptive',
            'domain_quiz',
            'full_practice',
            'task_practice',
            'recommended_practice',
            'section_quiz'
        )
    );

-- Context link from a section-quiz mission back to its learning module. It is
-- nullable because every other mission mode has no module.
ALTER TABLE mission_instances
    ADD COLUMN module_id text;

CREATE TABLE section_quiz_rewards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    track_id text NOT NULL,
    track_version text NOT NULL,
    domain_id text NOT NULL,
    module_id text NOT NULL,
    mission_instance_id uuid NOT NULL,
    reward_bits integer NOT NULL,
    settled_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT section_quiz_rewards_bits_non_negative CHECK (reward_bits >= 0),
    CONSTRAINT section_quiz_rewards_scope_not_blank CHECK (
        btrim(track_id) <> ''
        AND btrim(track_version) <> ''
        AND btrim(domain_id) <> ''
        AND btrim(module_id) <> ''
    ),
    -- One completion bonus per learner and section, regardless of how many
    -- section-quiz missions are issued for it.
    CONSTRAINT section_quiz_rewards_user_section_unique
        UNIQUE (user_id, track_version, domain_id, module_id)
);

-- Query pattern: a learner's recent section-quiz completions.
CREATE INDEX section_quiz_rewards_user_settled_idx
    ON section_quiz_rewards (user_id, settled_at);
