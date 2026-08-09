export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type AttemptStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type RunTrigger = 'MANUAL' | 'API' | 'SCHEDULE';
export type ArtifactType = 'JSON' | 'CSV' | 'PNG' | 'HTML' | 'WEBM';

export const ARTIFACT_TYPES: readonly ArtifactType[] = ['JSON', 'CSV', 'PNG', 'HTML', 'WEBM'];

export interface ScrapeFieldSelector {
  name: string;
  selector: string;
  attribute?: string;
}

export interface ScrapeConfig {
  waitFor?: string;
  rowSelector?: string;
  fields: ScrapeFieldSelector[];
  artifacts: ArtifactType[];
}

export interface ScrapeDefinition {
  id: string;
  name: string;
  url: string;
  config: ScrapeConfig;
  created_at: string;
}

export interface ScrapeSchedule {
  id: string;
  definition_id: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export interface ScrapeRun {
  id: string;
  definition_id: string;
  schedule_id: string | null;
  status: RunStatus;
  trigger: RunTrigger;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ScrapeRunAttempt {
  id: string;
  run_id: string;
  attempt_number: number;
  status: AttemptStatus;
  worker_id: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Artifact {
  id: string;
  run_id: string;
  type: ArtifactType;
  object_key: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface RunDetail extends ScrapeRun {
  attempts: ScrapeRunAttempt[];
  artifacts: Artifact[];
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
}

export interface ApiClient {
  listDefinitions(): Promise<ScrapeDefinition[]>;
  getDefinition(id: string): Promise<ScrapeDefinition>;
  createDefinition(input: CreateDefinitionInput): Promise<ScrapeDefinition>;
  listSchedules(definitionId?: string): Promise<ScrapeSchedule[]>;
  createSchedule(input: CreateScheduleInput): Promise<ScrapeSchedule>;
  toggleSchedule(id: string, enabled: boolean): Promise<ScrapeSchedule>;
  triggerRun(definitionId: string): Promise<ScrapeRun>;
  listRuns(definitionId?: string): Promise<ScrapeRun[]>;
  getRun(id: string): Promise<RunDetail>;
  listArtifacts(runId: string): Promise<Artifact[]>;
  artifactDownloadUrl(artifactId: string): string;
}

export const RUN_COMPLETE_STATUSES: readonly RunStatus[] = ['SUCCEEDED', 'FAILED'];
