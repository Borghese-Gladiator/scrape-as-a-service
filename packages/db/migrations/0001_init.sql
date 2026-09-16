-- Scraper platform schema.
-- Idempotent: safe to run repeatedly (guards on enum/table creation).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE run_status AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE attempt_status AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE run_trigger AS ENUM ('MANUAL', 'API', 'SCHEDULE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE artifact_type AS ENUM ('JSON', 'CSV', 'PNG', 'HTML', 'WEBM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS scrape_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  config      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scrape_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES scrape_definitions(id) ON DELETE CASCADE,
  cron          TEXT NOT NULL,
  timezone      TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scrape_schedules_definition_id
  ON scrape_schedules (definition_id);

-- Supports find-due-schedules: enabled schedules ordered by next_run_at.
CREATE INDEX IF NOT EXISTS idx_scrape_schedules_due
  ON scrape_schedules (next_run_at)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS scrape_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES scrape_definitions(id) ON DELETE CASCADE,
  schedule_id   UUID REFERENCES scrape_schedules(id) ON DELETE SET NULL,
  status        run_status NOT NULL DEFAULT 'QUEUED',
  trigger       run_trigger NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_definition_id
  ON scrape_runs (definition_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scrape_run_attempts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status         attempt_status NOT NULL DEFAULT 'RUNNING',
  worker_id      TEXT,
  error_code     TEXT,
  error_message  TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  UNIQUE (run_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_scrape_run_attempts_run_id
  ON scrape_run_attempts (run_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  type         artifact_type NOT NULL,
  object_key   TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run_id
  ON artifacts (run_id);
