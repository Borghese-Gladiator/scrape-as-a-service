import { describe, it, expect } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '../client.js';
import { updateRunStatus } from '../repositories/runs.js';

/** An UPDATE whose WHERE clause matches nothing returns zero rows. */
class EmptyDb implements Queryable {
  async query<R extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<R>> {
    return { rows: [], command: '', rowCount: 0, oid: 0, fields: [] };
  }
}

describe('repositories on a missing row', () => {
  it.each([
    {
      name: 'updateRunStatus',
      call: (db: Queryable) =>
        updateRunStatus(db, 'run-does-not-exist', 'RUNNING', new Date()),
    },
  ])('$name returns null', async ({ call }) => {
    await expect(call(new EmptyDb())).resolves.toBeNull();
  });
});
