-- Phase 1: server-issued missions and normalized learning events.
--
-- Raw answer payloads are not stored here. Learning events hold the evaluated,
-- partial-credit evidence used by later learning phases.

CREATE TABLE mission_instances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL,
    certification_id text NOT NULL,
    certification_version text NOT NULL,
    content_version text NOT NULL,
    domain_id text NOT NULL,
    task_id text NOT NULL,
    question_ids jsonb NOT NULL,
    status text NOT NULL DEFAULT 'issued',
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    CONSTRAINT mission_instances_status_valid CHECK (status IN ('issued', 'completed')),
    CONSTRAINT mission_instances_questions_array CHECK (jsonb_typeof(question_ids) = 'array')
);

-- Query pattern: find a device's active missions.
CREATE INDEX mission_instances_device_status_idx ON mission_instances (device_id, status);

CREATE TABLE learning_events (
    event_id uuid PRIMARY KEY,
    device_id uuid NOT NULL,
    mission_instance_id uuid NOT NULL REFERENCES mission_instances (id) ON DELETE CASCADE,
    certification_id text NOT NULL,
    certification_version text NOT NULL,
    domain_id text NOT NULL,
    task_id text NOT NULL,
    question_id text NOT NULL,
    content_version text NOT NULL,
    concepts jsonb NOT NULL,
    assessment_mode text NOT NULL,
    interaction_type text NOT NULL,
    score double precision NOT NULL,
    attempt_number integer NOT NULL,
    hint_count integer NOT NULL DEFAULT 0,
    response_ms integer NOT NULL,
    structured_error_codes text[] NOT NULL DEFAULT '{}',
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT learning_events_score_range CHECK (score >= 0.0 AND score <= 1.0),
    CONSTRAINT learning_events_attempt_positive CHECK (attempt_number >= 1),
    CONSTRAINT learning_events_attempt_max CHECK (attempt_number <= 50),
    CONSTRAINT learning_events_attempt_unique
        UNIQUE (mission_instance_id, question_id, attempt_number),
    CONSTRAINT learning_events_hint_count_non_negative CHECK (hint_count >= 0),
    CONSTRAINT learning_events_hint_count_max CHECK (hint_count <= 20),
    CONSTRAINT learning_events_response_ms_non_negative CHECK (response_ms >= 0),
    CONSTRAINT learning_events_assessment_mode_valid CHECK (
        assessment_mode IN (
            'recognition',
            'recall',
            'application',
            'structural_reconstruction',
            'relationship_recall',
            'procedural_recall'
        )
    ),
    CONSTRAINT learning_events_interaction_type_valid CHECK (
        interaction_type IN ('classification', 'ordering', 'node_connection')
    ),
    CONSTRAINT learning_events_concepts_array CHECK (jsonb_typeof(concepts) = 'array')
);

-- Query pattern: load all accepted events for a mission.
CREATE INDEX learning_events_mission_idx ON learning_events (mission_instance_id);
-- Query pattern: recent events for a device.
CREATE INDEX learning_events_device_received_idx ON learning_events (device_id, received_at);
