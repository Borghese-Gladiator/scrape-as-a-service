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

export const SCRAPE_ERROR_CODES: readonly ScrapeErrorCode[] = [
  'TIMEOUT',
  'SELECTOR_NOT_FOUND',
  'NAVIGATION_FAILED',
  'AUTH_FAILED',
  'LIMIT_EXCEEDED',
  'STORAGE_FAILED',
  'STALE',
  'UNKNOWN',
];

export function isScrapeErrorCode(value: unknown): value is ScrapeErrorCode {
  return (
    typeof value === 'string' && (SCRAPE_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** Chromium reports a failed navigation as `net::ERR_NAME_NOT_RESOLVED` and kin. */
const NAVIGATION_MESSAGE = /net::|ERR_[A-Z][A-Z_]*/;

/** Playwright reports an expired deadline as `Timeout 30000ms exceeded.`. */
const TIMEOUT_MESSAGE = /Timeout\b.*\bexceeded/i;

/**
 * Map any thrown value to a taxonomy code, in order: a ScrapeError, then any
 * error that carries a code from the taxonomy (the step interpreter throws its
 * own class), then the Playwright TimeoutError by name, then the message
 * patterns Playwright and Chromium produce. Playwright is matched by name and
 * by message so that this package keeps no Playwright dependency.
 */
export function toErrorCode(err: unknown): ScrapeErrorCode {
  if (err instanceof ScrapeError) return err.code;

  if (typeof err === 'object' && err !== null) {
    const { code } = err as { code?: unknown };
    if (isScrapeErrorCode(code)) return code;
  }

  if (err instanceof Error && err.name === 'TimeoutError') return 'TIMEOUT';

  const message = err instanceof Error ? err.message : '';
  if (NAVIGATION_MESSAGE.test(message)) return 'NAVIGATION_FAILED';
  if (TIMEOUT_MESSAGE.test(message)) return 'TIMEOUT';

  return 'UNKNOWN';
}
