import { beforeEach, expect, it } from 'vitest';
import { describeIntegration, useTestDb } from '../../../../test/integration/harness.js';
import { createDefinition } from '../repositories/definitions.js';
import { createRun } from '../repositories/runs.js';
import {
  getArtifact,
  insertArtifact,
  listArtifacts,
} from '../repositories/artifacts.js';
import type { ArtifactType, ScrapeConfig } from '../types.js';

const CONFIG: ScrapeConfig = {
  fields: [{ name: 'title', selector: 'h1' }],
  artifacts: ['JSON'],
};

describeIntegration('artifacts repository', () => {
  const { pool } = useTestDb();
  let runId = '';

  beforeEach(async () => {
    const definition = await createDefinition(pool, {
      name: 'artifacts',
      url: 'https://example.com',
      config: CONFIG,
    });
    const run = await createRun(pool, definition.id, 'MANUAL');
    runId = run.id;
  });

  it.each<{ type: ArtifactType; filename: string; contentType: string }>([
    { type: 'JSON', filename: 'data.json', contentType: 'application/json' },
    { type: 'CSV', filename: 'data.csv', contentType: 'text/csv' },
    { type: 'PNG', filename: 'screenshot.png', contentType: 'image/png' },
    { type: 'HTML', filename: 'source.html', contentType: 'text/html' },
    { type: 'WEBM', filename: 'recording.webm', contentType: 'video/webm' },
  ])('inserts a $type artifact', async ({ type, filename, contentType }) => {
    const artifact = await insertArtifact(pool, runId, type, {
      objectKey: `runs/${runId}/${filename}`,
      contentType,
      sizeBytes: 1234,
    });

    expect(artifact.run_id).toBe(runId);
    expect(artifact.type).toBe(type);
    expect(artifact.object_key).toBe(`runs/${runId}/${filename}`);
    expect(artifact.content_type).toBe(contentType);
    expect(Number(artifact.size_bytes)).toBe(1234);
    expect(artifact.created_at).toBeInstanceOf(Date);
  });

  it('lists only the artifacts of one run', async () => {
    const definition = await createDefinition(pool, {
      name: 'other',
      url: 'https://other.example',
      config: CONFIG,
    });
    const otherRun = await createRun(pool, definition.id, 'MANUAL');

    const mine = await insertArtifact(pool, runId, 'JSON', {
      objectKey: `runs/${runId}/data.json`,
      contentType: 'application/json',
      sizeBytes: 2,
    });
    await insertArtifact(pool, otherRun.id, 'JSON', {
      objectKey: `runs/${otherRun.id}/data.json`,
      contentType: 'application/json',
      sizeBytes: 2,
    });

    const artifacts = await listArtifacts(pool, runId);
    expect(artifacts.map((a) => a.id)).toEqual([mine.id]);
  });

  it('gets one artifact and returns null for an unknown id', async () => {
    const artifact = await insertArtifact(pool, runId, 'CSV', {
      objectKey: `runs/${runId}/data.csv`,
      contentType: 'text/csv',
      sizeBytes: 7,
    });

    await expect(getArtifact(pool, artifact.id)).resolves.toMatchObject({
      id: artifact.id,
      type: 'CSV',
    });
    await expect(
      getArtifact(pool, '00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeNull();
  });

  it('deletes artifacts when the run is deleted', async () => {
    const artifact = await insertArtifact(pool, runId, 'JSON', {
      objectKey: `runs/${runId}/data.json`,
      contentType: 'application/json',
      sizeBytes: 2,
    });
    await pool.query('DELETE FROM scrape_runs WHERE id = $1', [runId]);
    await expect(getArtifact(pool, artifact.id)).resolves.toBeNull();
  });
});
