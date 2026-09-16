import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '@scraper/shared';

export const REQUEST_ID_HEADER = 'X-Request-Id';

function readRequestId(value: string | string[] | undefined): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0)
    return value[0];
  return randomUUID();
}

/** Tag every request with an id, echo it back, and log the finished response. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = readRequestId(req.headers['x-request-id']);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info(
        {
          requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs),
        },
        'request completed',
      );
    });

    next();
  };
}
