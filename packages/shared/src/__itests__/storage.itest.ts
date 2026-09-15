import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { describeIntegration } from '../../../../test/integration/harness.js';
import { testConfig } from '../../../../test/integration/config.js';
import { getStorage, runObjectKey } from '../storage.js';

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describeIntegration('MinIO storage client', () => {
  const storage = getStorage(testConfig());

  it('puts an object, reads it back, and presigns a working URL', async () => {
    await storage.ensureBucket();

    const runId = randomUUID();
    const key = runObjectKey(runId, 'data.json');
    const body = Buffer.from(JSON.stringify([{ title: 'hello' }]), 'utf8');

    const put = await storage.put(key, body, 'application/json');
    expect(put).toEqual({
      objectKey: key,
      contentType: 'application/json',
      sizeBytes: body.length,
    });

    const stream = await storage.getStream(key);
    expect((await readAll(stream)).toString('utf8')).toBe(body.toString('utf8'));

    const url = await storage.presignedGetUrl(key, 60);
    expect(url).toContain(key);

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
  });

  it('overwrites an existing object key', async () => {
    await storage.ensureBucket();
    const key = runObjectKey(randomUUID(), 'data.csv');

    await storage.put(key, Buffer.from('a,b\n1,2', 'utf8'), 'text/csv');
    const second = await storage.put(key, Buffer.from('a,b\n3,4', 'utf8'), 'text/csv');

    const stream = await storage.getStream(key);
    expect((await readAll(stream)).toString('utf8')).toBe('a,b\n3,4');
    expect(second.sizeBytes).toBe(7);
  });

  it('rejects a read of a key that does not exist', async () => {
    await storage.ensureBucket();
    await expect(
      storage.getStream(runObjectKey(randomUUID(), 'missing.json')),
    ).rejects.toThrow(/does not exist/i);
  });
});
