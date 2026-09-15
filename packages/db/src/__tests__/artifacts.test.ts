import { describe, it, expect } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '../client.js';
import { getArtifact, insertArtifact, listArtifacts } from '../repositories/artifacts.js';

/**
 * The pg driver maps a Postgres bigint to a JavaScript string, so this fake
 * returns `size_bytes` the way the real driver does.
 */
function fakeDb(sizeBytes: string): Queryable {
  return {
    async query<R extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<R>> {
      const rows = [
        {
          id: 'artifact-1',
          run_id: 'run-1',
          type: 'PNG',
          name: 'receipt-0.png',
          step_index: 3,
          object_key: 'runs/run-1/receipt-0.png',
          content_type: 'image/png',
          size_bytes: sizeBytes,
          created_at: new Date('2026-01-01T00:00:00Z'),
        },
      ];
      return { rows: rows as R[], command: '', rowCount: rows.length, oid: 0, fields: [] };
    },
  };
}

const put = {
  objectKey: 'runs/run-1/receipt-0.png',
  contentType: 'image/png',
  sizeBytes: 17_660,
};

describe('size_bytes', () => {
  it.each([
    {
      desc: 'insertArtifact',
      read: (db: Queryable) => insertArtifact(db, 'run-1', 'PNG', put, 'receipt-0.png', 3),
    },
    {
      desc: 'listArtifacts',
      read: async (db: Queryable) => (await listArtifacts(db, 'run-1'))[0]!,
    },
    {
      desc: 'getArtifact',
      read: async (db: Queryable) => (await getArtifact(db, 'artifact-1'))!,
    },
  ])('comes back from $desc as a number, not a bigint string', async ({ read }) => {
    const artifact = await read(fakeDb('17660'));

    expect(artifact.size_bytes).toBe(17_660);
    expect(typeof artifact.size_bytes).toBe('number');
    expect(JSON.stringify(artifact)).toContain('"size_bytes":17660');
  });

  it('keeps every other column of the row', async () => {
    const artifact = await getArtifact(fakeDb('17660'), 'artifact-1');

    expect(artifact).toMatchObject({
      id: 'artifact-1',
      run_id: 'run-1',
      type: 'PNG',
      name: 'receipt-0.png',
      step_index: 3,
      object_key: 'runs/run-1/receipt-0.png',
      content_type: 'image/png',
    });
  });

  it('returns null when no row matched', async () => {
    const empty: Queryable = {
      async query<R extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<R>> {
        return { rows: [] as R[], command: '', rowCount: 0, oid: 0, fields: [] };
      },
    };

    expect(await getArtifact(empty, 'absent')).toBeNull();
  });
});
