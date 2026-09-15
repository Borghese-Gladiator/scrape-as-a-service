-- Phase 4: the secret store.
-- A secret holds a credential that a scrape needs: a Playwright storageState
-- blob, or a password that `fill.valueFrom` names. The value is encrypted with
-- AES-256-GCM before it reaches this table, and only the worker decrypts it.

CREATE TABLE IF NOT EXISTS secrets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  ciphertext  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
