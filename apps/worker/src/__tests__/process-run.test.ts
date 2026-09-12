import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '@scraper/db';
import type {
  ScrapeConfig,
  ScrapeJobData,
  StorageClient,
  StoragePutResult,
} from '@scraper/shared';

const runScrapeMock = vi.fn();
vi.mock('../scrape.js', () => ({
  runScrape: (...args: unknown[]) => runScrapeMock(...args),
}));

import { processRun } from '../process-run.js';

interface RunRow extends QueryResultRow {
  id: string;
  status: string;
  finished_at: Date | null;
}
interface AttemptRow extends QueryResultRow {
  id: string;
  attempt_number: number;
  status: string;
  error_code: string | null;
  error_message: string | null;
}

const DEF_CONFIG: ScrapeConfig = {
  fields: [{ name: 'title', selector: 'h1' }],
  artifacts: ['JSON'],
};

class FakeDb implements Queryable {
  runStatus = 'QUEUED';
  runFinishedAt: Date | null = null;
  attempts: AttemptRow[] = [];
  artifacts: Array<{ type: string; object_key: string }> = [];
  private seq = 0;

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const rows = this.dispatch(text, values) as R[];
    return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] };
  }

  private dispatch(text: string, values: unknown[]): unknown[] {
    if (text.includes('INSERT INTO scrape_run_attempts')) {
      this.seq += 1;
      const attempt: AttemptRow = {
        id: `attempt-${this.seq}`,
        attempt_number: this.attempts.length + 1,
        status: 'RUNNING',
        error_code: null,
        error_message: null,
      };
      this.attempts.push(attempt);
      return [attempt];
    }
    if (text.includes('UPDATE scrape_run_attempts')) {
      const [id, status, code, message] = values as [
        string,
        string,
        string | null,
        string | null,
      ];
      const attempt = this.attempts.find((a) => a.id === id)!;
      attempt.status = status;
      attempt.error_code = code;
      attempt.error_message = message;
      return [attempt];
    }
    if (text.includes('UPDATE scrape_runs')) {
      const [, status, at] = values as [string, string, Date];
      this.runStatus = status;
      if (status === 'SUCCEEDED' || status === 'FAILED') this.runFinishedAt = at;
      return [{ id: 'run-1', status, finished_at: this.runFinishedAt } as RunRow];
    }
    if (text.includes('FROM scrape_definitions')) {
      return [
        {
          id: 'def-1',
          name: 'd',
          url: 'https://x',
          config: DEF_CONFIG,
          created_at: new Date(),
        },
      ];
    }
    if (text.includes('INSERT INTO artifacts')) {
      const [, type, objectKey] = values as [string, string, string];
      this.artifacts.push({ type, object_key: objectKey });
      return [{ id: `art-${this.artifacts.length}` }];
    }
    throw new Error(`Unhandled query: ${text}`);
  }
}

function fakeStorage(): StorageClient {
  return {
    ensureBucket: vi.fn(async () => {}),
    put: vi.fn(
      async (
        objectKey: string,
        body: Buffer,
        contentType: string,
      ): Promise<StoragePutResult> => ({
        objectKey,
        contentType,
        sizeBytes: body.length,
      }),
    ),
    getStream: vi.fn(),
    presignedGetUrl: vi.fn(),
  } as unknown as StorageClient;
}

function fakeJob(attemptsMade: number, maxAttempts: number): Job<ScrapeJobData> {
  return {
    data: { runId: 'run-1', definitionId: 'def-1' },
    attemptsMade,
    opts: { attempts: maxAttempts },
  } as unknown as Job<ScrapeJobData>;
}

function fakeBrowser() {
  return { close: vi.fn(async () => {}) };
}

beforeEach(() => {
  runScrapeMock.mockReset();
});

describe('processRun success path', () => {
  it('inserts an attempt, transitions run RUNNING->SUCCEEDED, records artifacts', async () => {
    const db = new FakeDb();
    const storage = fakeStorage();
    const browser = fakeBrowser();
    runScrapeMock.mockResolvedValue({ rows: [{ title: 'Hello' }] });

    await processRun(fakeJob(0, 3), {
      pool: db,
      storage,
      workerId: 'worker-1',
      launchBrowser: async () => browser as never,
    });

    expect(db.attempts).toHaveLength(1);
    expect(db.attempts[0]!.attempt_number).toBe(1);
    expect(db.attempts[0]!.status).toBe('SUCCEEDED');
    expect(db.runStatus).toBe('SUCCEEDED');
    expect(db.artifacts).toEqual([{ type: 'JSON', object_key: 'runs/run-1/data.json' }]);
    expect(browser.close).toHaveBeenCalled();
  });
});

describe('processRun failure/retry path', () => {
  it('records error on attempt and does NOT fail the run before retries are exhausted', async () => {
    const db = new FakeDb();
    const browser = fakeBrowser();
    runScrapeMock.mockRejectedValue(
      Object.assign(new Error('nav timeout'), { name: 'NAV_TIMEOUT' }),
    );

    await expect(
      processRun(fakeJob(0, 3), {
        pool: db,
        storage: fakeStorage(),
        workerId: 'w',
        launchBrowser: async () => browser as never,
      }),
    ).rejects.toThrow('nav timeout');

    expect(db.attempts[0]!.status).toBe('FAILED');
    expect(db.attempts[0]!.error_code).toBe('NAV_TIMEOUT');
    expect(db.attempts[0]!.error_message).toBe('nav timeout');
    expect(db.runStatus).toBe('RUNNING');
  });

  it('creates a NEW attempt per retry and marks run FAILED only after retries exhausted', async () => {
    const db = new FakeDb();
    runScrapeMock.mockRejectedValue(new Error('boom'));
    const deps = {
      pool: db,
      storage: fakeStorage(),
      workerId: 'w',
      launchBrowser: async () => fakeBrowser() as never,
    };

    // attempt 1 (attemptsMade=0) and 2 (attemptsMade=1): not last -> run stays RUNNING
    await expect(processRun(fakeJob(0, 3), deps)).rejects.toThrow('boom');
    await expect(processRun(fakeJob(1, 3), deps)).rejects.toThrow('boom');
    expect(db.attempts).toHaveLength(2);
    expect(db.attempts[1]!.attempt_number).toBe(2);
    expect(db.runStatus).toBe('RUNNING');

    // attempt 3 (attemptsMade=2): last -> run FAILED
    await expect(processRun(fakeJob(2, 3), deps)).rejects.toThrow('boom');
    expect(db.attempts).toHaveLength(3);
    expect(db.attempts[2]!.attempt_number).toBe(3);
    expect(db.runStatus).toBe('FAILED');
    expect(db.runFinishedAt).not.toBeNull();
  });
});
