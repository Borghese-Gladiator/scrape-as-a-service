import { describe, it, expect } from 'vitest';
import { computeNextRun } from '../cron.js';

describe('computeNextRun', () => {
  it.each([
    // Daily at 09:00 America/New_York. From just before, in winter (EST = UTC-5).
    {
      cron: '0 9 * * *',
      tz: 'America/New_York',
      from: '2026-01-15T00:00:00.000Z',
      expected: '2026-01-15T14:00:00.000Z',
    },
    // Same schedule in summer (EDT = UTC-4).
    {
      cron: '0 9 * * *',
      tz: 'America/New_York',
      from: '2026-07-15T00:00:00.000Z',
      expected: '2026-07-15T13:00:00.000Z',
    },
    // UTC every 15 minutes.
    {
      cron: '*/15 * * * *',
      tz: 'UTC',
      from: '2026-03-01T10:07:00.000Z',
      expected: '2026-03-01T10:15:00.000Z',
    },
    // Tokyo daily midnight (JST = UTC+9).
    {
      cron: '0 0 * * *',
      tz: 'Asia/Tokyo',
      from: '2026-05-10T12:00:00.000Z',
      expected: '2026-05-10T15:00:00.000Z',
    },
  ])('computes $expected for $cron in $tz', ({ cron, tz, from, expected }) => {
    const next = computeNextRun(cron, tz, new Date(from));
    expect(next.toISOString()).toBe(expected);
  });

  it('always returns a time strictly after the from instant', () => {
    const from = new Date('2026-01-15T14:00:00.000Z');
    const next = computeNextRun('0 9 * * *', 'America/New_York', from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});
