-- Quiz modes, mixed-domain missions, expanded interaction types, and the Bits
-- currency foundation.
--
-- Forward-only: the historical learning_mvp migration is left untouched.

-- 1. Missions are no longer scoped to one task. Mixed-domain quizzes carry many
--    domains and tasks, defined by their question ids.
ALTER TABLE mission_instances
    ADD COLUMN mode text NOT NULL DEFAULT 'task_practice';

ALTER TABLE mission_instances
    ALTER COLUMN domain_id DROP NOT NULL,
    ALTER COLUMN task_id DROP NOT NULL;

ALTER TABLE mission_instances
    ADD CONSTRAINT mission_instances_mode_valid CHECK (
        mode IN ('quick_adaptive', 'domain_quiz', 'full_practice', 'task_practice')
    );

-- 2. Every interaction type the Rust enum now supports must be acceptable.
ALTER TABLE learning_events
    DROP CONSTRAINT learning_events_interaction_type_valid;

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
            'command_assembly'
        )
    );

-- 3. Server-authoritative Bits wallet, keyed by device for the current
--    unauthenticated flow. Settlement is idempotent by event_id.
CREATE TABLE device_wallets (
    device_id uuid PRIMARY KEY,
    bits_balance bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT device_wallets_bits_non_negative CHECK (bits_balance >= 0)
);

CREATE TABLE bit_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES device_wallets (device_id) ON DELETE CASCADE,
    event_id uuid NOT NULL UNIQUE,
    mission_instance_id uuid NOT NULL,
    question_id text NOT NULL,
    amount integer NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bit_transactions_amount_non_negative CHECK (amount >= 0)
);

-- Query pattern: list one device's recent Bit activity.
CREATE INDEX bit_transactions_device_created_idx
    ON bit_transactions (device_id, created_at);
