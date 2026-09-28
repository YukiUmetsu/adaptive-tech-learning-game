-- Batched Cyber Defense balance telemetry.
--
-- Append-only, batched events used to find boring, dominant, impossible, or
-- overly grindy systems. No raw personal data: only game identifiers and
-- results. Rows are short-lived by policy and pruned out of band; the API never
-- reads individual rows back.

CREATE TABLE cyber_telemetry_events (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    event_name TEXT NOT NULL,
    run_id UUID,
    template_id TEXT,
    adversary_id TEXT,
    threat_level INTEGER,
    hero_id TEXT,
    defense_id TEXT,
    wave INTEGER,
    result TEXT,
    stars INTEGER,
    duration_bucket TEXT,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cyber_telemetry_events_user_received_idx
    ON cyber_telemetry_events (user_id, received_at DESC);

CREATE INDEX cyber_telemetry_events_name_received_idx
    ON cyber_telemetry_events (event_name, received_at DESC);
