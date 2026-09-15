-- Phase 5: delivery.
-- A definition is soft-deleted, so its runs and artifacts survive the delete.
-- The two indexes support the keyset pagination on the list endpoints, which
-- orders by (created_at DESC, id DESC).

ALTER TABLE scrape_definitions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scrape_definitions_keyset
  ON scrape_definitions (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_keyset
  ON scrape_runs (created_at DESC, id DESC);
