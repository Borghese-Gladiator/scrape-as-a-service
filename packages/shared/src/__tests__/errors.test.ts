import { describe, it, expect } from 'vitest';
import {
  ScrapeError,
  SCRAPE_ERROR_CODES,
  toErrorCode,
  type ScrapeErrorCode,
} from '../errors.js';

/** The shape the step interpreter throws: a code, but not a ScrapeError. */
class StepError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StepError';
  }
}

function playwrightError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

describe('toErrorCode', () => {
  it.each(SCRAPE_ERROR_CODES)('returns the code carried by a ScrapeError: %s', (code) => {
    expect(toErrorCode(new ScrapeError(code, 'boom'))).toBe(code);
  });

  it.each(SCRAPE_ERROR_CODES)(
    'honours a duck-typed code on an error of another class: %s',
    (code) => {
      expect(toErrorCode(new StepError(code, 'step failed'))).toBe(code);
    },
  );

  it('honours a duck-typed code on a plain object', () => {
    expect(toErrorCode({ code: 'STORAGE_FAILED' })).toBe('STORAGE_FAILED');
  });

  it.each([
    [
      'a Node system error',
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    ],
    ['a lowercase near-miss', Object.assign(new Error('nope'), { code: 'timeout' })],
    ['a non-string code', Object.assign(new Error('nope'), { code: 42 })],
  ])('ignores a code outside the taxonomy: %s', (_label, err) => {
    expect(toErrorCode(err)).toBe('UNKNOWN');
  });

  it.each([
    ['locator.click: Timeout 30000ms exceeded.'],
    ['page.waitForSelector: Timeout 5000ms exceeded.'],
  ])('maps a Playwright TimeoutError by name: %s', (message) => {
    expect(toErrorCode(playwrightError('TimeoutError', message))).toBe('TIMEOUT');
  });

  it.each([
    ['page.goto: Timeout 30000ms exceeded.'],
    ['Timeout 120000ms exceeded while waiting for the navigation'],
  ])('maps a timeout by message when the name is plain Error: %s', (message) => {
    expect(toErrorCode(playwrightError('Error', message))).toBe('TIMEOUT');
  });

  it.each([
    ['page.goto: net::ERR_NAME_NOT_RESOLVED at https://does-not-exist.invalid/'],
    ['page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:1/'],
    ['page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://self-signed.example/'],
    ['Navigation failed because of ERR_ABORTED'],
  ])('maps a Chromium navigation failure by message: %s', (message) => {
    expect(toErrorCode(playwrightError('Error', message))).toBe('NAVIGATION_FAILED');
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['an empty Error', new Error('')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
  ])('falls back to UNKNOWN for %s', (_label, value) => {
    expect(toErrorCode(value)).toBe('UNKNOWN');
  });

  it('prefers the ScrapeError code over every message pattern', () => {
    const err = new ScrapeError('STORAGE_FAILED', 'page.goto: net::ERR_FAILED');
    expect(toErrorCode(err)).toBe('STORAGE_FAILED');
  });

  it('prefers a duck-typed code over a message pattern', () => {
    const err = new StepError('LIMIT_EXCEEDED', 'stopped after net::ERR_ABORTED');
    expect(toErrorCode(err)).toBe('LIMIT_EXCEEDED');
  });

  it('keeps the cause on a ScrapeError', () => {
    const cause = new Error('socket hang up');
    const err = new ScrapeError('NAVIGATION_FAILED', 'navigation failed', { cause });
    expect(err.cause).toBe(cause);
    expect(err.message).toBe('navigation failed');
  });

  it('lists every code in the taxonomy exactly once', () => {
    const codes: ScrapeErrorCode[] = [...SCRAPE_ERROR_CODES];
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(8);
  });
});
