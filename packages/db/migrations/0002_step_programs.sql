-- Phase 2: the step interpreter.
-- PDF becomes a capture type, and an artifact carries the name that the step
-- program produced plus the index of the step that produced it.

ALTER TYPE artifact_type ADD VALUE IF NOT EXISTS 'PDF';

ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS step_index INTEGER;
