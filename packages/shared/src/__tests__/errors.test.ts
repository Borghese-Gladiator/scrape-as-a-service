import { describe, it, expect } from 'vitest';
import { ScrapeError, toErrorCode, type ScrapeErrorCode } from '../errors.js';

const CODES: ScrapeErrorCode[] = [
  'TIMEOUT',
  'SELECTOR_NOT_FOUND',
  'NAVIGATION_FAILED',
  'AUTH_FAILED',
  'LIMIT_EXCEEDED',
  'STORAGE_FAILED',
  'STALE',
  'UNKNOWN',
];

describe('toErrorCode', () => {
  it.each(CODES)('returns the code carried by a ScrapeError: %s', (code) => {
    expect(toErrorCode(new ScrapeError(code, 'boom'))).toBe(code);
  });

  it('maps a Playwright TimeoutError to TIMEOUT by name', () => {
    const err = Object.assign(new Error('waiting for selector'), { name: 'TimeoutError' });
    expect(toErrorCode(err)).toBe('TIMEOUT');
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to UNKNOWN for %s', (_label, value) => {
    expect(toErrorCode(value)).toBe('UNKNOWN');
  });

  it('keeps the cause on a ScrapeError', () => {
    const cause = new Error('socket hang up');
    const err = new ScrapeError('NAVIGATION_FAILED', 'navigation failed', { cause });
    expect(err.cause).toBe(cause);
    expect(err.message).toBe('navigation failed');
  });
});
