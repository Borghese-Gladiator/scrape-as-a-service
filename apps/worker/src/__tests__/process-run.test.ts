import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '@scraper/db';
import type {
  ScrapeConfig,
  ScrapeJobData,
  StorageClient,
  StoragePutResult,
} from '@scraper/shared';
import { ScrapeError } from '@scraper/shared';

const runScrapeMock = vi.fn();
const closeScrapeSessionMock = vi.fn(async () => {});
vi.mock('../scrape.js', () => ({
  runScrape: (...args: unknown[]) => runScrapeMock(...args),
  openScrapeSession: async (browser: unknown) => ({ context: { browser } }),
  closeScrapeSession: (...args: unknown[]) => closeScrapeSessionMock(...(args as [])),
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
  version: 2,
  steps: [
    { op: 'goto' },
    { op: 'extract', name: 'rows', fields: [{ name: 'title', selector: 'h1' }] },
  ],
};

class FakeDb implements Queryable {
  runStatus = 'QUEUED';
  runFinishedAt: Date | null = null;
  attempts: AttemptRow[] = [];
  artifacts: Array<{
    type: string;
    name: string;
    step_index: number;
    object_key: string;
  }> = [];
  heartbeats = 0;
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
    if (text.includes('SET heartbeat_at')) {
      this.heartbeats += 1;
      return [];
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
      const [, type, name, stepIndex, objectKey] = values as [
        string,
        string,
        string,
        number,
        string,
      ];
      this.artifacts.push({ type, name, step_index: stepIndex, object_key: objectKey });
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
  return { close: vi.fn(async () => {}), isConnected: () => true };
}

const RUN_TIMEOUT_MS = 60_000;

beforeEach(() => {
  runScrapeMock.mockReset();
  closeScrapeSessionMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('processRun success path', () => {
  it('inserts an attempt, transitions run RUNNING->SUCCEEDED, records artifacts', async () => {
    const db = new FakeDb();
    const storage = fakeStorage();
    const browser = fakeBrowser();
    runScrapeMock.mockResolvedValue({
      datasets: { rows: [{ title: 'Hello' }] },
      artifacts: [
        {
          type: 'JSON',
          name: 'rows.json',
          body: Buffer.from('[]', 'utf8'),
          contentType: 'application/json',
          stepIndex: 1,
        },
      ],
    });

    await processRun(fakeJob(0, 3), {
      pool: db,
      storage,
      workerId: 'worker-1',
      getBrowser: async () => browser as never,
      runTimeoutMs: RUN_TIMEOUT_MS,
    });

    expect(db.attempts).toHaveLength(1);
    expect(db.attempts[0]!.attempt_number).toBe(1);
    expect(db.attempts[0]!.status).toBe('SUCCEEDED');
    expect(db.runStatus).toBe('SUCCEEDED');
    expect(db.artifacts).toEqual([
      {
        type: 'JSON',
        name: 'rows.json',
        step_index: 1,
        object_key: 'runs/run-1/rows.json',
      },
    ]);
    expect(closeScrapeSessionMock).toHaveBeenCalledTimes(1);
  });
});

describe('processRun failure/retry path', () => {
  it('records the taxonomy code on the attempt and does NOT fail the run before retries are exhausted', async () => {
    const db = new FakeDb();
    const browser = fakeBrowser();
    runScrapeMock.mockRejectedValue(
      new ScrapeError('NAVIGATION_FAILED', 'navigation to https://x failed'),
    );

    await expect(
      processRun(fakeJob(0, 3), {
        pool: db,
        storage: fakeStorage(),
        workerId: 'w',
        getBrowser: async () => browser as never,
        runTimeoutMs: RUN_TIMEOUT_MS,
      }),
    ).rejects.toThrow('navigation to https://x failed');

    expect(db.attempts[0]!.status).toBe('FAILED');
    expect(db.attempts[0]!.error_code).toBe('NAVIGATION_FAILED');
    expect(db.runStatus).toBe('RUNNING');
    expect(closeScrapeSessionMock).toHaveBeenCalledTimes(1);
  });

  it('records UNKNOWN for an untyped error', async () => {
    const db = new FakeDb();
    runScrapeMock.mockRejectedValue(new Error('boom'));

    await expect(
      processRun(fakeJob(0, 3), {
        pool: db,
        storage: fakeStorage(),
        workerId: 'w',
        getBrowser: async () => fakeBrowser() as never,
        runTimeoutMs: RUN_TIMEOUT_MS,
      }),
    ).rejects.toThrow('boom');

    expect(db.attempts[0]!.error_code).toBe('UNKNOWN');
  });

  it('creates a NEW attempt per retry and marks run FAILED only after retries exhausted', async () => {
    const db = new FakeDb();
    runScrapeMock.mockRejectedValue(new Error('boom'));
    const deps = {
      pool: db,
      storage: fakeStorage(),
      workerId: 'w',
      getBrowser: async () => fakeBrowser() as never,
      runTimeoutMs: RUN_TIMEOUT_MS,
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

describe('processRun run timeout', () => {
  it('fails a scrape that never resolves with code TIMEOUT and releases the context', async () => {
    const db = new FakeDb();
    runScrapeMock.mockReturnValue(new Promise(() => {}));

    await expect(
      processRun(fakeJob(2, 3), {
        pool: db,
        storage: fakeStorage(),
        workerId: 'w',
        getBrowser: async () => fakeBrowser() as never,
        runTimeoutMs: 5,
      }),
    ).rejects.toThrow('run exceeded 5ms');

    expect(db.attempts[0]!.status).toBe('FAILED');
    expect(db.attempts[0]!.error_code).toBe('TIMEOUT');
    expect(db.runStatus).toBe('FAILED');
    expect(closeScrapeSessionMock).toHaveBeenCalledTimes(1);
  });
});

describe('processRun browser reuse', () => {
  it('reuses one browser across jobs and never closes it', async () => {
    const db = new FakeDb();
    const browser = fakeBrowser();
    const getBrowser = vi.fn(async () => browser as never);
    runScrapeMock.mockResolvedValue({ datasets: {}, artifacts: [] });
    const deps = {
      pool: db,
      storage: fakeStorage(),
      workerId: 'w',
      getBrowser,
      runTimeoutMs: RUN_TIMEOUT_MS,
    };

    await processRun(fakeJob(0, 3), deps);
    await processRun(fakeJob(0, 3), deps);

    expect(getBrowser).toHaveBeenCalledTimes(2);
    expect(getBrowser.mock.results[0]!.value).not.toBe(undefined);
    await expect(getBrowser.mock.results[0]!.value).resolves.toBe(browser);
    await expect(getBrowser.mock.results[1]!.value).resolves.toBe(browser);
    expect(browser.close).not.toHaveBeenCalled();
    expect(closeScrapeSessionMock).toHaveBeenCalledTimes(2);
  });
});

describe('processRun heartbeat', () => {
  it('beats on the attempt for as long as the job runs', async () => {
    vi.useFakeTimers();
    const db = new FakeDb();
    let finish: (result: unknown) => void = () => {};
    runScrapeMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const pending = processRun(fakeJob(0, 3), {
      pool: db,
      storage: fakeStorage(),
      workerId: 'w',
      getBrowser: async () => fakeBrowser() as never,
      runTimeoutMs: 600_000,
    });

    await vi.advanceTimersByTimeAsync(31_000);
    expect(db.heartbeats).toBe(2);

    finish({ datasets: {}, artifacts: [] });
    await pending;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(db.heartbeats).toBe(2);
  });
});
