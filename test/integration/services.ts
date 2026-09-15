import { connect } from 'node:net';
import type { AppConfig } from '@scraper/shared';
import { serviceEndpoints, type ServiceEndpoint } from './config.js';

export const SERVICES_FLAG = 'SCRAPER_ITEST_SERVICES';

function reachable(endpoint: ServiceEndpoint, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: endpoint.host, port: endpoint.port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export async function unreachableServices(
  config: AppConfig,
  timeoutMs = 2000,
): Promise<string[]> {
  const endpoints = serviceEndpoints(config);
  const results = await Promise.all(
    endpoints.map(async (endpoint) => ({
      endpoint,
      up: await reachable(endpoint, timeoutMs),
    })),
  );
  return results
    .filter((r) => !r.up)
    .map((r) => `${r.endpoint.name} (${r.endpoint.host}:${r.endpoint.port})`);
}

/**
 * Poll until every service answers, or until the deadline. CI starts the suite
 * as soon as the containers report healthy, which can still be a second or two
 * before the ports accept a connection.
 */
export async function waitForServices(
  config: AppConfig,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let missing = await unreachableServices(config);
  while (missing.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    missing = await unreachableServices(config);
  }
  return missing;
}

export function servicesAvailable(): boolean {
  return process.env[SERVICES_FLAG] === 'available';
}
