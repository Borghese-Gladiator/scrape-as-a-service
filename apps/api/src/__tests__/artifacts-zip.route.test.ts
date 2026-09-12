import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Queue } from 'bullmq';
import yauzl from 'yauzl';
import type { ScrapeJobData } from '@scraper/shared';
import { createServer } from '../server.js';
import { artifactRow, FakeDb, runRow } from './fake-db.js';

const queue = { add: async () => ({}) } as unknown as Queue<ScrapeJobData>;

/** Big enough that the first entry fills a socket write and reaches the client. */
const CHUNK = 64 * 1024;

interface Recorded {
  opened: string[];
  /** The route waits here before it opens this key. The test releases it. */
  gateKey?: string;
  release?: () => void;
  gate?: Promise<void>;
}

function fakeStorage(objects: Record<string, Buffer>, recorded: Recorded) {
  return {
    async getStream(objectKey: string): Promise<NodeJS.ReadableStream> {
      if (recorded.gate && objectKey === recorded.gateKey) await recorded.gate;
      recorded.opened.push(objectKey);
      const body = objects[objectKey];
      if (!body) throw new Error(`no such object: ${objectKey}`);
      return Readable.from(
        (async function* () {
          for (let offset = 0; offset < body.length; offset += CHUNK) {
            yield body.subarray(offset, offset + CHUNK);
          }
        })(),
      );
    },
  } as never;
}

function unzip(buffer: Buffer): Promise<Record<string, Buffer>> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        rejectPromise(err ?? new Error('no archive'));
        return;
      }
      const entries: Record<string, Buffer> = {};
      zipfile.on('error', rejectPromise);
      zipfile.on('end', () => resolvePromise(entries));
      zipfile.on('entry', (entry: yauzl.Entry) => {
        zipfile.openReadStream(entry, (readErr, stream) => {
          if (readErr || !stream) {
            rejectPromise(readErr ?? new Error('no entry stream'));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            entries[entry.fileName] = Buffer.concat(chunks);
            zipfile.readEntry();
          });
        });
      });
      zipfile.readEntry();
    });
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.once('listening', () => done()));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function body(marker: string, size: number): Buffer {
  return Buffer.alloc(size, marker);
}

const OBJECTS: Record<string, Buffer> = {
  'runs/run-1/a.png': body('a', CHUNK * 2),
  'runs/run-1/b.png': body('b', CHUNK * 2),
  'runs/run-1/c.png': body('c', CHUNK * 2),
};

function db(): FakeDb {
  return new FakeDb({
    runs: [runRow({ id: 'run-1', status: 'SUCCEEDED' })],
    artifacts: [
      artifactRow({ id: 'art-1', name: 'a.png', object_key: 'runs/run-1/a.png' }),
      artifactRow({ id: 'art-2', name: null, object_key: 'runs/run-1/b.png' }),
      artifactRow({ id: 'art-3', name: 'a.png', object_key: 'runs/run-1/c.png' }),
    ],
  });
}

describe('GET /runs/:id/artifacts.zip', () => {
  it('streams every artifact, names each entry, and suffixes a repeat name', async () => {
    const recorded: Recorded = { opened: [], gateKey: 'runs/run-1/c.png' };
    recorded.gate = new Promise<void>((done) => {
      recorded.release = done;
    });
    const app = createServer(db().asPool(), queue, fakeStorage(OBJECTS, recorded));
    const server = app.listen(0, '127.0.0.1') as unknown as Server;
    const base = await listen(server);

    try {
      const res = await fetch(`${base}/runs/run-1/artifacts.zip`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');

      // The third object never opens until the test releases it. The client
      // still receives bytes first, which a buffered route could never do.
      const reader = res.body!.getReader();
      const chunks: Buffer[] = [];
      const first = await reader.read();
      expect(first.done).toBe(false);
      const openedAtFirstByte = [...recorded.opened];
      chunks.push(Buffer.from(first.value!));
      recorded.release?.();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }

      expect(openedAtFirstByte).not.toContain('runs/run-1/c.png');
      expect(recorded.opened).toEqual([
        'runs/run-1/a.png',
        'runs/run-1/b.png',
        'runs/run-1/c.png',
      ]);

      const entries = await unzip(Buffer.concat(chunks));
      expect(Object.keys(entries).sort()).toEqual(['a-2.png', 'a.png', 'b.png']);
      expect(entries['a.png']).toEqual(OBJECTS['runs/run-1/a.png']);
      expect(entries['b.png']).toEqual(OBJECTS['runs/run-1/b.png']);
      expect(entries['a-2.png']).toEqual(OBJECTS['runs/run-1/c.png']);
    } finally {
      server.close();
    }
  });

  it.each([
    { desc: 'an unknown run', runId: 'missing', data: { runs: [], artifacts: [] } },
    {
      desc: 'a run with no artifact',
      runId: 'run-1',
      data: { runs: [runRow({ id: 'run-1' })], artifacts: [] },
    },
  ])('returns 404 for $desc', async ({ runId, data }) => {
    const recorded: Recorded = { events: [] };
    const app = createServer(
      new FakeDb(data).asPool(),
      queue,
      fakeStorage(OBJECTS, recorded),
    );
    const server = app.listen(0, '127.0.0.1') as unknown as Server;
    const base = await listen(server);
    try {
      const res = await fetch(`${base}/runs/${runId}/artifacts.zip`);
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
