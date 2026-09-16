import type { Request } from 'express';
import type { PageQuery, RunStatus } from '@scraper/db';
import { HttpError } from './http.js';

const RUN_STATUSES: readonly RunStatus[] = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'];

export function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Read `?limit=` and `?cursor=`. The repository clamps the limit. */
export function pageQuery(req: Request): PageQuery {
  const query: PageQuery = {};
  const limit = queryString(req, 'limit');
  if (limit !== undefined) {
    const parsed = Number.parseInt(limit, 10);
    if (!Number.isFinite(parsed)) {
      throw new HttpError(400, 'limit must be an integer');
    }
    query.limit = parsed;
  }
  const cursor = queryString(req, 'cursor');
  if (cursor !== undefined) query.cursor = cursor;
  return query;
}

export function runStatus(req: Request): RunStatus | undefined {
  const value = queryString(req, 'status');
  if (value === undefined) return undefined;
  if (!RUN_STATUSES.includes(value as RunStatus)) {
    throw new HttpError(400, `status must be one of ${RUN_STATUSES.join(', ')}`);
  }
  return value as RunStatus;
}
