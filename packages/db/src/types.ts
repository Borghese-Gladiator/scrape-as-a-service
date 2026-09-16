import type { ArtifactType, ScrapeConfig } from '@scraper/shared';

export type { ArtifactType, ScrapeConfig };

export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type AttemptStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type RunTrigger = 'MANUAL' | 'API';

export interface ScrapeDefinition {
  id: string;
  name: string;
  url: string;
  config: ScrapeConfig;
  created_at: Date;
  deleted_at: Date | null;
}

export interface ScrapeRun {
  id: string;
  definition_id: string;
  status: RunStatus;
  trigger: RunTrigger;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface ScrapeRunAttempt {
  id: string;
  run_id: string;
  attempt_number: number;
  status: AttemptStatus;
  worker_id: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date;
  heartbeat_at: Date | null;
  finished_at: Date | null;
}

export interface Artifact {
  id: string;
  run_id: string;
  type: ArtifactType;
  name: string | null;
  step_index: number | null;
  object_key: string;
  content_type: string;
  size_bytes: number;
  created_at: Date;
}

/** A secret row without its ciphertext. This is the only shape the API returns. */
export interface SecretMeta {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDefinitionInput {
  name: string;
  url: string;
  config: ScrapeConfig;
}

export interface UpdateDefinitionInput {
  name?: string;
  url?: string;
  config?: ScrapeConfig;
}

/** One keyset page. `nextCursor` is null when the page is the last one. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PageQuery {
  limit?: number;
  cursor?: string;
}

export interface RunDetail extends ScrapeRun {
  attempts: ScrapeRunAttempt[];
  artifacts: Artifact[];
}
