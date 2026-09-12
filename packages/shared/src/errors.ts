export type ScrapeErrorCode =
  | 'TIMEOUT'
  | 'SELECTOR_NOT_FOUND'
  | 'NAVIGATION_FAILED'
  | 'AUTH_FAILED'
  | 'LIMIT_EXCEEDED'
  | 'STORAGE_FAILED'
  | 'STALE'
  | 'UNKNOWN';

export class ScrapeError extends Error {
  readonly code: ScrapeErrorCode;

  constructor(code: ScrapeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ScrapeError';
    this.code = code;
  }
}

/**
 * Map any thrown value to a taxonomy code. The Playwright TimeoutError is
 * matched by name so that this package keeps no Playwright dependency.
 */
export function toErrorCode(err: unknown): ScrapeErrorCode {
  if (err instanceof ScrapeError) return err.code;
  if (err instanceof Error && err.name === 'TimeoutError') return 'TIMEOUT';
  return 'UNKNOWN';
}
