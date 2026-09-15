import { describe, it, expect, vi } from 'vitest';
import type { ScrapeConfig, StorageClient, StoragePutResult } from '@scraper/shared';
import { upgradeScrapeConfig } from '@scraper/shared';
import { buildAndUploadArtifacts, toCsv } from '../artifacts.js';
import type { ScrapeResult } from '../interpreter.js';

function csv(rows: Record<string, string | null>[]): string {
  return toCsv(rows).toString('utf8');
}

describe('toCsv', () => {
  it('writes a header from the first row and one line per row', () => {
    expect(
      csv([
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ]),
    ).toBe('a,b\n1,2\n3,4');
  });

  it.each([
    { desc: 'a comma', value: 'a,b', expected: '"a,b"' },
    { desc: 'a double quote', value: 'say "hi"', expected: '"say ""hi"""' },
    { desc: 'a newline', value: 'line1\nline2', expected: '"line1\nline2"' },
    { desc: 'a carriage return', value: 'line1\rline2', expected: '"line1\rline2"' },
    { desc: 'no special character', value: 'plain', expected: 'plain' },
  ])('quotes $desc', ({ value, expected }) => {
    expect(csv([{ a: value }])).toBe(`a\n${expected}`);
  });

  it('writes an empty buffer for an empty row set', () => {
    expect(toCsv([])).toHaveLength(0);
  });

  it('writes a null cell as an empty field', () => {
    expect(csv([{ a: null }])).toBe('a\n');
  });

  it('uses the union of every row key and keeps first-seen order', () => {
    expect(csv([{ a: '1' }, { b: '2' }, { a: '3', c: '4' }])).toBe(
      'a,b,c\n1,,\n,2,\n3,,4',
    );
  });

  it('quotes a header that holds a comma', () => {
    expect(csv([{ 'a,b': '1' }])).toBe('"a,b"\n1');
  });
});

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

function result(names: Array<[string, string]>): ScrapeResult {
  return {
    datasets: {},
    artifacts: names.map(([name, contentType], index) => ({
      type: 'PNG' as const,
      name,
      body: Buffer.from(name, 'utf8'),
      contentType,
      stepIndex: index,
    })),
  };
}

describe('buildAndUploadArtifacts', () => {
  it('uploads every artifact under runs/<run-id>/ and returns its name', async () => {
    const storage = fakeStorage();
    const config: ScrapeConfig = { version: 2, steps: [{ op: 'goBack' }] };

    const uploaded = await buildAndUploadArtifacts(
      storage,
      'run-1',
      config,
      result([
        ['receipt-0.png', 'image/png'],
        ['receipt-1.png', 'image/png'],
      ]),
    );

    expect(uploaded.map((a) => [a.name, a.put.objectKey, a.stepIndex])).toEqual([
      ['receipt-0.png', 'runs/run-1/receipt-0.png', 0],
      ['receipt-1.png', 'runs/run-1/receipt-1.png', 1],
    ]);
  });

  it.each([
    ['rows.json', 'data.json'],
    ['rows.csv', 'data.csv'],
    ['page.png', 'screenshot.png'],
    ['page.html', 'source.html'],
    ['recording.webm', 'recording.webm'],
    ['receipt-0.png', 'receipt-0.png'],
  ])('maps %s to %s for an upgraded v1 config', async (name, expected) => {
    const config = upgradeScrapeConfig({
      fields: [{ name: 'a', selector: 'b' }],
      artifacts: ['JSON', 'CSV', 'PNG', 'HTML', 'WEBM'],
    });
    const uploaded = await buildAndUploadArtifacts(
      fakeStorage(),
      'run-1',
      config,
      result([[name, 'image/png']]),
    );
    expect(uploaded[0]?.name).toBe(expected);
  });

  it('leaves a v2 name alone', async () => {
    const config: ScrapeConfig = { version: 2, steps: [{ op: 'goBack' }] };
    const uploaded = await buildAndUploadArtifacts(
      fakeStorage(),
      'run-1',
      config,
      result([['rows.json', 'application/json']]),
    );
    expect(uploaded[0]?.name).toBe('rows.json');
  });
});
