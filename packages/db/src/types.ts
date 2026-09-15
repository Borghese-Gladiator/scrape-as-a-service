import type { ArtifactType, ScrapeConfig } from '@scraper/shared';

export type { ArtifactType, ScrapeConfig };

export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type AttemptStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type RunTrigger = 'MANUAL' | 'API' | 'SCHEDULE';
export type CatchUpPolicy = 'skip' | 'runOnce';

export const CATCH_UP_POLICIES: readonly CatchUpPolicy[] = ['skip', 'runOnce'];

export function isCatchUpPolicy(value: unknown): value is CatchUpPolicy {
  return typeof value === 'string' && (CATCH_UP_POLICIES as readonly string[]).includes(value);
}

export interface ScrapeDefinition {
  id: string;
  name: string;
  url: string;
  config: ScrapeConfig;
  created_at: Date;
}

export interface ScrapeSchedule {
  id: string;
  definition_id: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  last_run_at: Date | null;
  next_run_at: Date | null;
  catch_up: CatchUpPolicy;
  created_at: Date;
}

export interface ScrapeRun {
  id: string;
  definition_id: string;
  schedule_id: string | null;
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

export interface CreateDefinitionInput {
  name: string;
  url: string;
  config: ScrapeConfig;
}

export interface CreateScheduleInput {
  definitionId: string;
  cron: string;
  timezone: string;
  enabled?: boolean;
  catchUp?: CatchUpPolicy;
}

export interface RunDetail extends ScrapeRun {
  attempts: ScrapeRunAttempt[];
  artifacts: Artifact[];
}
