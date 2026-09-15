import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { Page } from 'playwright';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '@scraper/db';
import type { ScrapeConfig, ScrapeJobData, StorageClient, StoragePutResult } from '@scraper/shared';
import { attachDiagnostics, getDiagnostics, type DiagnosticError } from '../diagnostics.js';

const runScrapeMock = vi.fn();
vi.mock('../scrape.js', () => ({
  runScrape: (...args: unknown[]) => runScrapeMock(...args),
  openScrapeSession: async () => ({ context: {} }),
  closeScrapeSession: async () => {},
}));

import { processRun } from '../process-run.js';

const DEF_CONFIG: ScrapeConfig = {
  fields: [{ name: 'title', selector: 'h1' }],
  artifacts: ['JSON'],
};

class FakeDb implements Queryable {
  artifacts: Array<{ type: string; object_key: string }> = [];

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const rows = this.dispatch(text, values) as R[];
    return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] };
  }

  private dispatch(text: string, values: unknown[]): unknown[] {
    if (text.includes('INSERT INTO scrape_run_attempts')) {
      return [{ id: 'attempt-1', attempt_number: 1, status: 'RUNNING' }];
    }
    if (text.includes('UPDATE scrape_run_attempts')) return [{ id: 'attempt-1' }];
    if (text.includes('UPDATE scrape_runs')) return [{ id: 'run-1' }];
    if (text.includes('FROM scrape_definitions')) {
      return [{ id: 'def-1', name: 'd', url: 'https://x', config: DEF_CONFIG }];
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
      async (objectKey: string, body: Buffer, contentType: string): Promise<StoragePutResult> => ({
        objectKey,
        contentType,
        sizeBytes: body.length,
      }),
    ),
    getStream: vi.fn(),
    presignedGetUrl: vi.fn(),
  } as unknown as StorageClient;
}

function fakeJob(): Job<ScrapeJobData> {
  return {
    data: { runId: 'run-1', definitionId: 'def-1' },
    attemptsMade: 2,
    opts: { attempts: 3 },
  } as unknown as Job<ScrapeJobData>;
}

function fakePage(overrides: Partial<Page> = {}): Page {
  return {
    screenshot: vi.fn(async () => Buffer.from('png-bytes')),
    content: vi.fn(async () => '<html>broken</html>'),
    ...overrides,
  } as unknown as Page;
}

beforeEach(() => {
  runScrapeMock.mockReset();
});

describe('attachDiagnostics', () => {
  it('attaches the screenshot, the HTML and the console to the error', async () => {
    const error = new Error('selector not found');
    const entries = [{ type: 'error', text: 'boom' }];

    await attachDiagnostics(error, fakePage(), entries);

    expect(getDiagnostics(error)).toEqual({
      screenshot: Buffer.from('png-bytes'),
      html: '<html>broken</html>',
      console: entries,
    });
  });

  it('hides the diagnostics from an error log serializer', async () => {
    const error = new Error('selector not found');

    await attachDiagnostics(error, fakePage(), []);

    expect(Object.keys(error)).not.toContain('diagnostics');
    expect(JSON.stringify({ ...error })).not.toContain('png-bytes');
    expect(getDiagnostics(error)?.screenshot).toEqual(Buffer.from('png-bytes'));
  });

  it('keeps the original error when the capture itself throws', async () => {
    const error = new Error('selector not found');
    const page = fakePage({
      screenshot: vi.fn(async () => {
        throw new Error('target closed');
      }),
      content: vi.fn(async () => {
        throw new Error('target closed');
      }),
    } as unknown as Partial<Page>);

    const returned = (await attachDiagnostics(error, page, [])) as Error;

    expect(returned).toBe(error);
    expect(returned.message).toBe('selector not found');
    expect(getDiagnostics(error)).toEqual({ console: [] });
  });
});

describe('processRun failure diagnostics', () => {
  it('stores the three failure artifacts before the run is finalized', async () => {
    const db = new FakeDb();
    const error: DiagnosticError = new Error('selector not found');
    error.diagnostics = {
      screenshot: Buffer.from('png-bytes'),
      html: '<html>broken</html>',
      console: [{ type: 'error', text: 'boom' }],
    };
    runScrapeMock.mockRejectedValue(error);

    await expect(
      processRun(fakeJob(), {
        pool: db,
        storage: fakeStorage(),
        workerId: 'w',
        getBrowser: async () => ({ close: vi.fn(async () => {}) }) as never,
        runTimeoutMs: 30_000,
      }),
    ).rejects.toThrow('selector not found');

    expect(db.artifacts).toEqual([
      { type: 'PNG', object_key: 'runs/run-1/failure-screenshot.png' },
      { type: 'HTML', object_key: 'runs/run-1/failure-source.html' },
      { type: 'JSON', object_key: 'runs/run-1/failure-console.json' },
    ]);
  });

  it('still fails the run when the diagnostics upload throws', async () => {
    const db = new FakeDb();
    const error: DiagnosticError = new Error('selector not found');
    error.diagnostics = { console: [] };
    runScrapeMock.mockRejectedValue(error);

    const storage = fakeStorage();
    storage.put = vi.fn(async () => {
      throw new Error('minio down');
    });

    await expect(
      processRun(fakeJob(), {
        pool: db,
        storage,
        workerId: 'w',
        getBrowser: async () => ({ close: vi.fn(async () => {}) }) as never,
        runTimeoutMs: 30_000,
      }),
    ).rejects.toThrow('selector not found');

    expect(db.artifacts).toEqual([]);
  });
});
