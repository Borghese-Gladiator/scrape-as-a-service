import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { HttpError } from './http.js';

/** Paths that answer without a key. Keep this list as short as it is today. */
const EXEMPT_PATHS = new Set(['/health']);

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Both sides go through a digest first, so `timingSafeEqual` always compares two
 * buffers of the same length and the key length never leaks.
 */
function matches(expected: string, supplied: string): boolean {
  return timingSafeEqual(digest(expected), digest(supplied));
}

/**
 * Require `X-API-Key` on every route except `/health`. An empty `apiKey` turns
 * the check off; `startApi` refuses that combination in production.
 */
export function apiKeyMiddleware(apiKey: string): RequestHandler {
  return (req, _res, next) => {
    if (apiKey === '') return next();
    if (EXEMPT_PATHS.has(req.path)) return next();

    const header = req.get('x-api-key');
    if (typeof header !== 'string' || header.length === 0) {
      return next(new HttpError(401, 'X-API-Key is required'));
    }
    if (!matches(apiKey, header)) {
      return next(new HttpError(401, 'X-API-Key is not valid'));
    }
    return next();
  };
}

/**
 * Refuse to serve an open API in production. Anywhere else the platform runs
 * with the check off, because the local walkthrough and the route tests build a
 * server with no key.
 */
export function assertApiKeyPolicy(
  apiKey: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (apiKey !== '') return;
  if (env.NODE_ENV === 'production') {
    throw new Error('API_KEY is required when NODE_ENV=production');
  }
  // eslint-disable-next-line no-console
  console.warn(
    'WARNING: API_KEY is not set. Every route is open to any caller that reaches this port.',
  );
}
