-- Cron-based scheduling is removed. Stale-run detection and retention
-- cleanup stay; they never depended on scrape_schedules.
--
-- run_trigger keeps its unused 'SCHEDULE' value: Postgres cannot drop an
-- enum value without recreating the type, and an unused member is harmless.
ALTER TABLE scrape_runs DROP COLUMN IF EXISTS schedule_id;
DROP TABLE IF EXISTS scrape_schedules CASCADE;
