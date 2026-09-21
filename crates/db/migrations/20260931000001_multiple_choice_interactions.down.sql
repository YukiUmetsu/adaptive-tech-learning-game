-- Revert the interaction_type constraint to the typed_fill_blank list.
--
-- A downgrade fails if any recorded event uses multiple_choice or
-- multiple_response, matching the forward-only pattern of the previous
-- interaction migrations.

ALTER TABLE learning_events
    DROP CONSTRAINT IF EXISTS learning_events_interaction_type_valid;

ALTER TABLE learning_events
    ADD CONSTRAINT learning_events_interaction_type_valid CHECK (
        interaction_type IN (
            'classification',
            'ordering',
            'node_connection',
            'reconstruction',
            'evidence_selection',
            'spot_the_fault',
            'fill_slots',
            'troubleshooting',
            'scenario_choice_chain',
            'configuration_builder',
            'two_dimensional_placement',
            'command_assembly',
            'typed_fill_blank'
        )
    );
