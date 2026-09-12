import { beforeEach, expect, it } from 'vitest';
import { describeIntegration, useTestDb } from '../../../../test/integration/harness.js';
import { createDefinition } from '../repositories/definitions.js';
import { createSchedule } from '../repositories/schedules.js';
import { insertAttempt } from '../repositories/attempts.js';
import { insertArtifact } from '../repositories/artifacts.js';
import {
  createRun,
  getRun,
  getRunDetail,
  listRuns,
  updateRunStatus,
} from '../repositories/runs.js';
import type { RunTrigger, ScrapeConfig } from '../types.js';

const CONFIG: ScrapeConfig = {
  fields: [{ name: 'title', selector: 'h1' }],
  artifacts: ['JSON'],
};

describeIntegration('runs repository', () => {
  const { pool } = useTestDb();
  let definitionId = '';

  beforeEach(async () => {
    const definition = await createDefinition(pool, {
      name: 'runs',
      url: 'https://example.com',
      config: CONFIG,
    });
    definitionId = definition.id;
  });

  it.each<RunTrigger>(['MANUAL', 'API', 'SCHEDULE'])(
    'creates a QUEUED run with trigger %s',
    async (trigger) => {
      const run = await createRun(pool, definitionId, trigger);
      expect(run.status).toBe('QUEUED');
      expect(run.trigger).toBe(trigger);
      expect(run.definition_id).toBe(definitionId);
      expect(run.schedule_id).toBeNull();
      expect(run.started_at).toBeNull();
      expect(run.finished_at).toBeNull();
    },
  );

  it('records the schedule id when the run comes from a schedule', async () => {
    const schedule = await createSchedule(
      pool,
      { definitionId, cron: '* * * * *', timezone: 'UTC' },
      new Date(),
    );
    const run = await createRun(pool, definitionId, 'SCHEDULE', schedule.id);
    expect(run.schedule_id).toBe(schedule.id);
  });

  it('sets started_at on RUNNING and finished_at on a terminal status', async () => {
    const run = await createRun(pool, definitionId, 'MANUAL');
    const startedAt = new Date('2026-02-01T10:00:00.000Z');
    const finishedAt = new Date('2026-02-01T10:05:00.000Z');

    const running = await updateRunStatus(pool, run.id, 'RUNNING', startedAt);
    expect(running.status).toBe('RUNNING');
    expect(running.started_at?.toISOString()).toBe(startedAt.toISOString());
    expect(running.finished_at).toBeNull();

    const succeeded = await updateRunStatus(pool, run.id, 'SUCCEEDED', finishedAt);
    expect(succeeded.status).toBe('SUCCEEDED');
    expect(succeeded.finished_at?.toISOString()).toBe(finishedAt.toISOString());
    expect(succeeded.started_at?.toISOString()).toBe(startedAt.toISOString());
  });

  it('marks a run FAILED with a finished_at', async () => {
    const run = await createRun(pool, definitionId, 'MANUAL');
    const failedAt = new Date('2026-02-01T11:00:00.000Z');
    const failed = await updateRunStatus(pool, run.id, 'FAILED', failedAt);
    expect(failed.status).toBe('FAILED');
    expect(failed.finished_at?.toISOString()).toBe(failedAt.toISOString());
  });

  it('gets one run and returns null for an unknown id', async () => {
    const run = await createRun(pool, definitionId, 'MANUAL');
    await expect(getRun(pool, run.id)).resolves.toMatchObject({ id: run.id });
    await expect(
      getRun(pool, '00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeNull();
  });

  it('builds a run detail with its attempts and artifacts', async () => {
    const run = await createRun(pool, definitionId, 'MANUAL');
    const attempt = await insertAttempt(pool, run.id, 'worker-1');
    const artifact = await insertArtifact(pool, run.id, 'JSON', {
      objectKey: `runs/${run.id}/data.json`,
      contentType: 'application/json',
      sizeBytes: 12,
    });

    const detail = await getRunDetail(pool, run.id);
    expect(detail?.id).toBe(run.id);
    expect(detail?.attempts.map((a) => a.id)).toEqual([attempt.id]);
    expect(detail?.artifacts.map((a) => a.id)).toEqual([artifact.id]);
  });

  it('returns null for the detail of an unknown run', async () => {
    await expect(
      getRunDetail(pool, '00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeNull();
  });

  it('lists all runs and filters by definition', async () => {
    const other = await createDefinition(pool, {
      name: 'other',
      url: 'https://other.example',
      config: CONFIG,
    });
    const mine = await createRun(pool, definitionId, 'MANUAL');
    const theirs = await createRun(pool, other.id, 'MANUAL');

    const all = await listRuns(pool);
    expect(all.map((r) => r.id).sort()).toEqual([mine.id, theirs.id].sort());

    const filtered = await listRuns(pool, definitionId);
    expect(filtered.map((r) => r.id)).toEqual([mine.id]);
  });
});
