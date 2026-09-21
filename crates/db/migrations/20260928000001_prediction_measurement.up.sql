-- Prediction measurement (analytics only) and local-day Daily Missions.
--
-- Measurement is auxiliary: it never blocks mission issuance, answer
-- acceptance, reward settlement, or concept-state updates. `learning_events`
-- remain the authoritative outcomes.

-- 1. Persisted learner timezone for the local Daily Mission day boundary.
--    Captured once and then stable, so changing the browser timezone cannot
--    create additional reward-bearing Daily Missions.
ALTER TABLE users
    ADD COLUMN timezone text;

-- 2. Prediction snapshot captured at question issuance, before any answer is
--    known. Fully immutable: the answer only ever adds a row to
--    `prediction_outcomes`, never touches this row.
CREATE TABLE prediction_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users (id) ON DELETE CASCADE,
    mission_instance_id uuid NOT NULL,
    question_id text NOT NULL,
    track_id text NOT NULL,
    track_version text NOT NULL,
    content_version text NOT NULL,
    domain_id text NOT NULL,
    assessment_mode text NOT NULL,
    interaction_type text NOT NULL,
    difficulty_prior double precision NOT NULL,
    concepts jsonb NOT NULL,
    concept_detail jsonb NOT NULL DEFAULT '[]'::jsonb,
    predicted_score double precision NOT NULL,
    model_version text NOT NULL,
    practice_source text NOT NULL,
    delayed_retrieval boolean NOT NULL DEFAULT false,
    seconds_since_previous_practice integer,
    predicted_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT prediction_snapshots_predicted_range
        CHECK (predicted_score >= 0.0 AND predicted_score <= 1.0),
    CONSTRAINT prediction_snapshots_difficulty_range
        CHECK (difficulty_prior >= 0.0 AND difficulty_prior <= 1.0),
    CONSTRAINT prediction_snapshots_concepts_array CHECK (jsonb_typeof(concepts) = 'array'),
    CONSTRAINT prediction_snapshots_detail_array CHECK (jsonb_typeof(concept_detail) = 'array'),
    CONSTRAINT prediction_snapshots_model_not_blank CHECK (btrim(model_version) <> ''),
    CONSTRAINT prediction_snapshots_source_not_blank CHECK (btrim(practice_source) <> ''),
    CONSTRAINT prediction_snapshots_unique
        UNIQUE (mission_instance_id, question_id, model_version)
);

CREATE INDEX prediction_snapshots_user_idx ON prediction_snapshots (user_id, predicted_at);
CREATE INDEX prediction_snapshots_model_idx ON prediction_snapshots (model_version, predicted_at);

-- 3. Outcome linkage: append-only, one row per (prediction, accepted event).
--    Unresolved snapshots (abandoned or unanswered questions) simply have no
--    row here and are excluded from evaluation.
CREATE TABLE prediction_outcomes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id uuid NOT NULL REFERENCES prediction_snapshots (id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    observed_score double precision NOT NULL,
    observed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT prediction_outcomes_observed_range
        CHECK (observed_score >= 0.0 AND observed_score <= 1.0),
    CONSTRAINT prediction_outcomes_attempt_positive CHECK (attempt_number >= 1),
    CONSTRAINT prediction_outcomes_unique UNIQUE (prediction_id, event_id)
);

CREATE INDEX prediction_outcomes_prediction_idx
    ON prediction_outcomes (prediction_id, attempt_number);
CREATE INDEX prediction_outcomes_event_idx ON prediction_outcomes (event_id);
