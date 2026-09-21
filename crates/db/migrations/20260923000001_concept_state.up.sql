-- Adaptive student-state layer, `heuristic-v1`.
--
-- `user_concept_state` is a derived/cache projection of accepted
-- `learning_events`; it is never authoritative. It is keyed per assessment mode
-- so recognition, recall, application, and structural reconstruction stay
-- separate evidence signals.
--
-- `learning_events` gains the canonical question difficulty so accepted evidence
-- preserves the difficulty the item actually had. The value is copied from
-- server content and is never trusted from the client.

-- 1. Preserve canonical difficulty with the accepted evidence. Legacy rows get
--    the neutral prior; forward writes always supply a server-derived value.
ALTER TABLE learning_events
    ADD COLUMN difficulty_prior double precision NOT NULL DEFAULT 0.5;

ALTER TABLE learning_events
    ADD CONSTRAINT learning_events_difficulty_prior_range
        CHECK (difficulty_prior >= 0.0 AND difficulty_prior <= 1.0);

-- 2. Derived per-concept learner state.
CREATE TABLE user_concept_state (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    certification_version text NOT NULL,
    concept_id text NOT NULL,
    assessment_mode text NOT NULL,
    estimate double precision NOT NULL DEFAULT 0.5,
    evidence_mass double precision NOT NULL DEFAULT 0.0,
    exposure_count integer NOT NULL DEFAULT 0,
    success_count integer NOT NULL DEFAULT 0,
    failure_count integer NOT NULL DEFAULT 0,
    last_practiced_at timestamptz,
    last_success_at timestamptz,
    model_version text NOT NULL,
    state_version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, certification_version, concept_id, assessment_mode),
    CONSTRAINT user_concept_state_estimate_range
        CHECK (estimate >= 0.0 AND estimate <= 1.0),
    CONSTRAINT user_concept_state_evidence_non_negative CHECK (evidence_mass >= 0.0),
    CONSTRAINT user_concept_state_exposure_non_negative CHECK (exposure_count >= 0),
    CONSTRAINT user_concept_state_success_non_negative CHECK (success_count >= 0),
    CONSTRAINT user_concept_state_failure_non_negative CHECK (failure_count >= 0),
    CONSTRAINT user_concept_state_state_version_positive CHECK (state_version >= 1),
    CONSTRAINT user_concept_state_model_version_not_blank CHECK (btrim(model_version) <> ''),
    CONSTRAINT user_concept_state_assessment_mode_valid CHECK (
        assessment_mode IN (
            'recognition',
            'recall',
            'application',
            'structural_reconstruction',
            'relationship_recall',
            'procedural_recall'
        )
    )
);

-- Query pattern: load every derived state row for one learner and version.
CREATE INDEX user_concept_state_user_version_idx
    ON user_concept_state (user_id, certification_version);
