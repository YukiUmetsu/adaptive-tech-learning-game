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
