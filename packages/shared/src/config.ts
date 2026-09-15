export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  minio: {
    endpoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    bucket: string;
    useSSL: boolean;
  };
  apiPort: number;
  webPort: number;
  corsOrigins: string[];
  workerHealthPort: number;
  schedulerHealthPort: number;
  schedulerIntervalMs: number;
  workerConcurrency: number;
  runTimeoutMs: number;
  staleAttemptMinutes: number;
  /** Empty means the API key check is off. `startApi` refuses that in production. */
  apiKey: string;
  allowCdp: boolean;
  allowLocalProfile: boolean;
  allowPrivateUrls: boolean;
  /** Delete runs older than this many days. 0 disables the retention sweeper. */
  retentionDays: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  return value === undefined || value === '' ? fallback : value;
}

function toInt(value: string, key: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${value}`);
  }
  return parsed;
}

function toBool(value: string): boolean {
  return value === 'true' || value === '1';
}

export const DEFAULT_CORS_ORIGINS = ['http://localhost:3000'];

function toOriginList(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    redisUrl: required(env, 'REDIS_URL'),
    minio: {
      endpoint: optional(env, 'MINIO_ENDPOINT', 'localhost'),
      port: toInt(optional(env, 'MINIO_PORT', '9000'), 'MINIO_PORT'),
      accessKey: required(env, 'MINIO_ACCESS_KEY'),
      secretKey: required(env, 'MINIO_SECRET_KEY'),
      bucket: optional(env, 'MINIO_BUCKET', 'scraper-artifacts'),
      useSSL: toBool(optional(env, 'MINIO_USE_SSL', 'false')),
    },
    apiPort: toInt(optional(env, 'API_PORT', '4000'), 'API_PORT'),
    webPort: toInt(optional(env, 'WEB_PORT', '3000'), 'WEB_PORT'),
    corsOrigins: toOriginList(
      optional(env, 'CORS_ORIGINS', DEFAULT_CORS_ORIGINS.join(',')),
    ),
    workerHealthPort: toInt(optional(env, 'WORKER_HEALTH_PORT', '4001'), 'WORKER_HEALTH_PORT'),
    schedulerHealthPort: toInt(
      optional(env, 'SCHEDULER_HEALTH_PORT', '4002'),
      'SCHEDULER_HEALTH_PORT',
    ),
    schedulerIntervalMs: toInt(optional(env, 'SCHEDULER_INTERVAL_MS', '10000'), 'SCHEDULER_INTERVAL_MS'),
    workerConcurrency: toInt(optional(env, 'WORKER_CONCURRENCY', '4'), 'WORKER_CONCURRENCY'),
    runTimeoutMs: toInt(optional(env, 'RUN_TIMEOUT_MS', '120000'), 'RUN_TIMEOUT_MS'),
    staleAttemptMinutes: toInt(
      optional(env, 'STALE_ATTEMPT_MINUTES', '10'),
      'STALE_ATTEMPT_MINUTES',
    ),
    apiKey: optional(env, 'API_KEY', ''),
    allowCdp: toBool(optional(env, 'ALLOW_CDP', 'false')),
    allowLocalProfile: toBool(optional(env, 'ALLOW_LOCAL_PROFILE', 'false')),
    allowPrivateUrls: toBool(optional(env, 'ALLOW_PRIVATE_URLS', 'false')),
    retentionDays: toInt(optional(env, 'RETENTION_DAYS', '30'), 'RETENTION_DAYS'),
  };
}
