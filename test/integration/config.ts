import type { AppConfig } from '@scraper/shared';

/**
 * Defaults match docker-compose.test.yml, which publishes the three services on
 * non-default host ports so the suite never touches a developer's own stack.
 */
export const TEST_POSTGRES_PORT = 55432;
export const TEST_REDIS_PORT = 56379;
export const TEST_MINIO_PORT = 59000;

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

export function testConfig(): AppConfig {
  return {
    databaseUrl: env(
      'TEST_DATABASE_URL',
      `postgres://postgres:postgres@localhost:${TEST_POSTGRES_PORT}/scraper_test`,
    ),
    redisUrl: env('TEST_REDIS_URL', `redis://localhost:${TEST_REDIS_PORT}`),
    minio: {
      endpoint: env('TEST_MINIO_ENDPOINT', 'localhost'),
      port: Number.parseInt(env('TEST_MINIO_PORT', String(TEST_MINIO_PORT)), 10),
      accessKey: env('TEST_MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: env('TEST_MINIO_SECRET_KEY', 'minioadmin'),
      bucket: env('TEST_MINIO_BUCKET', 'scraper-itest'),
      useSSL: false,
    },
    apiPort: 0,
    webPort: 0,
    schedulerIntervalMs: 1000,
    workerConcurrency: 1,
  };
}

export interface ServiceEndpoint {
  name: string;
  host: string;
  port: number;
}

export function serviceEndpoints(config: AppConfig): ServiceEndpoint[] {
  const postgres = new URL(config.databaseUrl);
  const redis = new URL(config.redisUrl);
  return [
    {
      name: 'postgres',
      host: postgres.hostname,
      port: postgres.port ? Number.parseInt(postgres.port, 10) : 5432,
    },
    {
      name: 'redis',
      host: redis.hostname,
      port: redis.port ? Number.parseInt(redis.port, 10) : 6379,
    },
    { name: 'minio', host: config.minio.endpoint, port: config.minio.port },
  ];
}
