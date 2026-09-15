-- Run reliability: attempt heartbeat, stale sweep support, schedule catch-up.
-- Idempotent: safe to run repeatedly.

ALTER TABLE scrape_run_attempts ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

ALTER TABLE scrape_schedules ADD COLUMN IF NOT EXISTS catch_up TEXT NOT NULL DEFAULT 'skip';

-- Supports the stale-attempt sweep, which reads exactly this expression.
CREATE INDEX IF NOT EXISTS idx_scrape_run_attempts_stale
  ON scrape_run_attempts (COALESCE(heartbeat_at, started_at))
  WHERE status = 'RUNNING';
