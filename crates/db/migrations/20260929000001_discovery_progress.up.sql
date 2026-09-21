-- Server-persisted Knowledge Map discovery progress (V1).
--
-- Discovery means "I revealed/explored learning material", NOT "I demonstrated
-- knowledge". This table is therefore deliberately separate from
-- `learning_events`, `user_concept_state`, wallets, and rewards: writing here can
-- never create scored evidence, mastery, or Bits.
--
-- Raw monotonic data only: the revealed prompt ids and namespaced element ids
-- per node. Node/module/domain state (explored, unlocked, completed) is derived
-- on read with the same rules the Knowledge Map and planner already share, so
-- persisted progress can never drift from the curriculum.
--
-- Merging is set-union (see `adaptive_learn_content::merge_domain_discovery`),
-- so an older device can never remove a newer reveal and duplicate batches are
-- harmless. The row lock in the merge transaction makes concurrent multi-device
-- writes safe without last-write-wins.
CREATE TABLE discovery_progress (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    track_version text NOT NULL,
    domain_id text NOT NULL,
    content_version text NOT NULL,
    revealed_prompt_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
    revealed_element_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT discovery_progress_pk PRIMARY KEY (user_id, track_version, domain_id),
    CONSTRAINT discovery_progress_prompts_object
        CHECK (jsonb_typeof(revealed_prompt_ids) = 'object'),
    CONSTRAINT discovery_progress_elements_object
        CHECK (jsonb_typeof(revealed_element_ids) = 'object'),
    CONSTRAINT discovery_progress_track_not_blank CHECK (btrim(track_version) <> ''),
    CONSTRAINT discovery_progress_domain_not_blank CHECK (btrim(domain_id) <> '')
);

-- Query pattern: load a learner's discovery for one track (planner union) and
-- the async Knowledge Map fetch.
CREATE INDEX discovery_progress_user_track_idx
    ON discovery_progress (user_id, track_version);
