import { expect, it } from 'vitest';
import { describeIntegration, useTestDb } from '../../../../test/integration/harness.js';
import {
  createDefinition,
  getDefinition,
  listDefinitions,
} from '../repositories/definitions.js';
import type { ScrapeConfig } from '../types.js';

const CONFIG: ScrapeConfig = {
  steps: [
    { op: 'waitFor', selector: 'body' },
    { op: 'extract', name: 'rows', rowSelector: 'tr', fields: [{ name: 'title', selector: 'h1' }] },
  ],
};

describeIntegration('definitions repository', () => {
  const { pool } = useTestDb();

  it('creates a definition and returns every selected column', async () => {
    const created = await createDefinition(pool, {
      name: 'example',
      url: 'https://example.com',
      config: CONFIG,
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.name).toBe('example');
    expect(created.url).toBe('https://example.com');
    expect(created.config).toEqual(CONFIG);
    expect(created.created_at).toBeInstanceOf(Date);
  });

  it('lists definitions newest first', async () => {
    const first = await createDefinition(pool, {
      name: 'first',
      url: 'https://a.example',
      config: CONFIG,
    });
    await pool.query(
      "UPDATE scrape_definitions SET created_at = now() - interval '1 hour' WHERE id = $1",
      [first.id],
    );
    const second = await createDefinition(pool, {
      name: 'second',
      url: 'https://b.example',
      config: CONFIG,
    });

    const rows = await listDefinitions(pool);
    expect(rows.items.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('gets one definition by id and returns null for an unknown id', async () => {
    const created = await createDefinition(pool, {
      name: 'one',
      url: 'https://one.example',
      config: CONFIG,
    });

    await expect(getDefinition(pool, created.id)).resolves.toMatchObject({
      id: created.id,
      name: 'one',
    });
    await expect(
      getDefinition(pool, '00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeNull();
  });
});
