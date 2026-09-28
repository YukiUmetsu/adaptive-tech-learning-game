-- Multi-stage challenges: a track-neutral mission mode that orchestrates an
-- authored ordered sequence of existing question and learning-node stages.
--
-- Forward-only: widen the mission mode constraint. No new table is needed —
-- challenge identity and stage order are authored content, and the issued
-- mission freezes the referenced question/content version. Per-question rewards
-- are unchanged; there is no challenge completion bonus.

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
            'section_quiz',
            'challenge'
        )
    );
