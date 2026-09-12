import { beforeEach, expect, it } from 'vitest';
import { describeIntegration, useTestDb } from '../../../../test/integration/harness.js';
import { createDefinition } from '../repositories/definitions.js';
import {
  advanceSchedule,
  createSchedule,
  findDueSchedules,
  listSchedules,
  setScheduleEnabled,
} from '../repositories/schedules.js';
import type { ScrapeConfig } from '../types.js';

const CONFIG: ScrapeConfig = {
  fields: [{ name: 'title', selector: 'h1' }],
  artifacts: ['JSON'],
};

describeIntegration('schedules repository', () => {
  const { pool } = useTestDb();
  let definitionId = '';

  beforeEach(async () => {
    const definition = await createDefinition(pool, {
      name: 'scheduled',
      url: 'https://example.com',
      config: CONFIG,
    });
    definitionId = definition.id;
  });

  it('creates a schedule with every column populated', async () => {
    const nextRunAt = new Date('2026-01-01T00:00:00.000Z');
    const schedule = await createSchedule(
      pool,
      { definitionId, cron: '0 9 * * *', timezone: 'America/New_York' },
      nextRunAt,
    );

    expect(schedule.definition_id).toBe(definitionId);
    expect(schedule.cron).toBe('0 9 * * *');
    expect(schedule.timezone).toBe('America/New_York');
    expect(schedule.enabled).toBe(true);
    expect(schedule.last_run_at).toBeNull();
    expect(schedule.next_run_at?.toISOString()).toBe(nextRunAt.toISOString());
  });

  it('honours an explicit enabled flag of false', async () => {
    const schedule = await createSchedule(
      pool,
      { definitionId, cron: '* * * * *', timezone: 'UTC', enabled: false },
      new Date(),
    );
    expect(schedule.enabled).toBe(false);
  });

  it('lists all schedules and filters by definition', async () => {
    const other = await createDefinition(pool, {
      name: 'other',
      url: 'https://other.example',
      config: CONFIG,
    });
    const mine = await createSchedule(
      pool,
      { definitionId, cron: '* * * * *', timezone: 'UTC' },
      new Date(),
    );
    const theirs = await createSchedule(
      pool,
      { definitionId: other.id, cron: '* * * * *', timezone: 'UTC' },
      new Date(),
    );

    const all = await listSchedules(pool);
    expect(all.map((s) => s.id).sort()).toEqual([mine.id, theirs.id].sort());

    const filtered = await listSchedules(pool, definitionId);
    expect(filtered.map((s) => s.id)).toEqual([mine.id]);
  });

  it('toggles enabled', async () => {
    const schedule = await createSchedule(
      pool,
      { definitionId, cron: '* * * * *', timezone: 'UTC' },
      new Date(),
    );

    const disabled = await setScheduleEnabled(pool, schedule.id, false);
    expect(disabled.enabled).toBe(false);

    const enabled = await setScheduleEnabled(pool, schedule.id, true);
    expect(enabled.enabled).toBe(true);
  });

  it.each([
    { label: 'due and enabled', enabled: true, offsetMs: -60_000, expected: true },
    { label: 'not yet due', enabled: true, offsetMs: 60_000, expected: false },
    { label: 'due but disabled', enabled: false, offsetMs: -60_000, expected: false },
  ])('findDueSchedules returns $expected when $label', async ({ enabled, offsetMs, expected }) => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const schedule = await createSchedule(
      pool,
      { definitionId, cron: '* * * * *', timezone: 'UTC', enabled },
      new Date(now.getTime() + offsetMs),
    );

    const due = await findDueSchedules(pool, now);
    expect(due.some((s) => s.id === schedule.id)).toBe(expected);
  });

  it('ignores schedules with a null next_run_at', async () => {
    const schedule = await createSchedule(
      pool,
      { definitionId, cron: '* * * * *', timezone: 'UTC' },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    await pool.query('UPDATE scrape_schedules SET next_run_at = NULL WHERE id = $1', [
      schedule.id,
    ]);

    const due = await findDueSchedules(pool, new Date('2026-06-01T12:00:00.000Z'));
    expect(due).toEqual([]);
  });

  it('advances last_run_at and next_run_at', async () => {
    const schedule = await createSchedule(
      pool,
      { definitionId, cron: '* * * * *', timezone: 'UTC' },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const lastRunAt = new Date('2026-01-01T00:00:00.000Z');
    const nextRunAt = new Date('2026-01-01T00:01:00.000Z');

    const advanced = await advanceSchedule(pool, schedule.id, lastRunAt, nextRunAt);
    expect(advanced.last_run_at?.toISOString()).toBe(lastRunAt.toISOString());
    expect(advanced.next_run_at?.toISOString()).toBe(nextRunAt.toISOString());
  });
});
