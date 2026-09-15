import { Queue, type ConnectionOptions } from 'bullmq';
import { loadConfig, type AppConfig } from './config.js';

export const SCRAPE_QUEUE_NAME = 'scrape';

export interface ScrapeJobData {
  runId: string;
  definitionId: string;
}

export interface QueueDefaults {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number | boolean;
  removeOnFail: number | boolean;
}

let queueSingleton: Queue<ScrapeJobData> | undefined;

export function getRedisConnection(config: AppConfig = loadConfig()): ConnectionOptions {
  const url = new URL(config.redisUrl);
  const connection: ConnectionOptions = {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 6379,
  };
  if (url.username) connection.username = url.username;
  if (url.password) connection.password = url.password;
  return connection;
}

export function defaultJobOptions(): QueueDefaults {
  return {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

export function getQueue(config: AppConfig = loadConfig()): Queue<ScrapeJobData> {
  if (!queueSingleton) {
    queueSingleton = new Queue<ScrapeJobData>(SCRAPE_QUEUE_NAME, {
      connection: getRedisConnection(config),
      defaultJobOptions: defaultJobOptions(),
    });
  }
  return queueSingleton;
}

export async function enqueueRun(
  queue: Queue<ScrapeJobData>,
  data: ScrapeJobData,
): Promise<void> {
  await queue.add('scrape-run', data, { jobId: data.runId });
}
