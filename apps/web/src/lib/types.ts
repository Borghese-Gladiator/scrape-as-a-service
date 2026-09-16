export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type AttemptStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type RunTrigger = 'MANUAL' | 'API';
export type ArtifactType = 'JSON' | 'CSV' | 'PNG' | 'HTML' | 'WEBM' | 'PDF';
export type CaptureType = 'PNG' | 'PDF' | 'HTML';
export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

export const ARTIFACT_TYPES: readonly ArtifactType[] = [
  'JSON',
  'CSV',
  'PNG',
  'HTML',
  'WEBM',
  'PDF',
];

export interface ScrapeFieldSelector {
  name: string;
  selector: string;
  attribute?: string;
}

export interface Limits {
  maxDurationMs?: number;
  maxSteps?: number;
  maxPages?: number;
  maxArtifacts?: number;
}

export type AuthConfig =
  | { mode: 'none' }
  | { mode: 'storageState'; secretRef: string }
  | { mode: 'cdp'; endpointUrl: string }
  | { mode: 'chromeProfile'; userDataDir: string; profileDirectory?: string }
  | { mode: 'login'; secretRef?: string; steps: Step[] };

export type Step =
  | { op: 'goto'; url?: string; waitUntil?: WaitUntil }
  | { op: 'waitFor'; selector: string; timeoutMs?: number; state?: 'visible' | 'attached' }
  | {
      op: 'click';
      selector: string;
      opens?: 'same' | 'newTab';
      timeoutMs?: number;
      optional?: boolean;
    }
  | { op: 'fill'; selector: string; value?: string; valueFrom?: string }
  | { op: 'select'; selector: string; value: string }
  | { op: 'press'; key: string }
  | { op: 'scroll'; to: 'bottom' | 'element'; selector?: string }
  | {
      op: 'extract';
      name: string;
      rowSelector?: string;
      fields: ScrapeFieldSelector[];
      emit?: ('JSON' | 'CSV')[];
    }
  | { op: 'capture'; as: CaptureType[]; name: string; fullPage?: boolean }
  | { op: 'forEach'; rowSelector: string; max?: number; steps: Step[] }
  | { op: 'openLink'; selector: string; attribute?: string; steps: Step[] }
  | { op: 'paginate'; nextSelector: string; maxPages: number; steps: Step[] }
  | { op: 'goBack' };

export interface ScrapeConfig {
  auth?: AuthConfig;
  steps: Step[];
  limits?: Limits;
  record?: boolean;
}

export interface ScrapeDefinition {
  id: string;
  name: string;
  url: string;
  config: ScrapeConfig;
  created_at: string;
  deleted_at: string | null;
}

/** One keyset page. The list endpoints return this shape. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ScrapeRun {
  id: string;
  definition_id: string;
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
  name: string | null;
  step_index: number | null;
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

/** `PUT /definitions/:id` replaces the whole definition. */
export interface UpdateDefinitionInput {
  name: string;
  url: string;
  config: ScrapeConfig;
}

export interface ApiClient {
  listDefinitions(): Promise<ScrapeDefinition[]>;
  getDefinition(id: string): Promise<ScrapeDefinition>;
  createDefinition(input: CreateDefinitionInput): Promise<ScrapeDefinition>;
  updateDefinition(id: string, input: UpdateDefinitionInput): Promise<ScrapeDefinition>;
  deleteDefinition(id: string): Promise<void>;
  triggerRun(definitionId: string): Promise<ScrapeRun>;
  listRuns(definitionId?: string): Promise<ScrapeRun[]>;
  getRun(id: string): Promise<RunDetail>;
  listArtifacts(runId: string): Promise<Artifact[]>;
  artifactDownloadUrl(artifactId: string): string;
  /** A short-lived object URL. The browser cannot send the API key on a link. */
  artifactPresignedUrl(artifactId: string): Promise<string>;
  runArchiveUrl(runId: string): string;
}

export const RUN_COMPLETE_STATUSES: readonly RunStatus[] = ['SUCCEEDED', 'FAILED'];
