#!/usr/bin/env node
// Manual acceptance test for Phase 5.
//
//   node scripts/manual/phase-5-export.mjs
//
// Part 1 needs nothing but Chromium: it serves the fixture site and runs the
// local runner CLI into a temporary folder, then checks the files on disk.
//
// Part 2 needs Postgres and MinIO from the stack. It applies the migrations,
// stores the files of part 1 as the artifacts of a real run, starts the API in
// this process, and exports the run through the streaming zip route with the
// export CLI. It deletes every row and object that it created.
//
// Run `npx playwright install chromium` first when Chromium is missing.

import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, ROWS } from './fixture-site.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const { runMigrations } = await import(join(repoRoot, 'packages/db/dist/index.js'));
const { getPool } = await import(join(repoRoot, 'packages/db/dist/client.js'));
const { getStorage, getQueue, loadConfig, runObjectKey } = await import(
  join(repoRoot, 'packages/shared/dist/index.js')
);
const { createServer } = await import(join(repoRoot, 'apps/api/dist/server.js'));

const CONFIG = {
  version: 2,
  steps: [
    { op: 'goto' },
    { op: 'waitFor', selector: 'table tbody tr' },
    {
      op: 'paginate',
      nextSelector: 'a.next',
      maxPages: 10,
      steps: [
        {
          op: 'extract',
          name: 'rows',
          rowSelector: 'table tbody tr',
          fields: [
            { name: 'date', selector: 'td.date' },
            { name: 'amount', selector: 'td.amount' },
            { name: 'receipt', selector: 'td.receipt-no' },
          ],
          emit: ['JSON', 'CSV'],
        },
        {
          op: 'forEach',
          rowSelector: 'table tbody tr',
          steps: [
            {
              op: 'extract',
              name: 'row',
              fields: [{ name: 'receipt', selector: 'td.receipt-no' }],
            },
            {
              op: 'openLink',
              selector: 'a.receipt',
              steps: [
                {
                  op: 'capture',
                  as: ['PNG'],
                  name: 'receipt-p{{page}}-r{{index}}-{{row.receipt}}',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  limits: { maxPages: 200, maxSteps: 5000 },
};

const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

function expectedCaptureNames() {
  return ROWS.map(
    (row, index) => `receipt-p${row.page}-r${index}-${row.receipt.toLowerCase()}.png`,
  );
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function listen(server) {
  await new Promise((done) => server.once('listening', done));
  return `http://127.0.0.1:${server.address().port}`;
}

async function partOneLocalRunner(workDir, baseUrl) {
  const definitionPath = join(workDir, 'definition.json');
  const outDir = join(workDir, 'local-out');
  await writeFile(
    definitionPath,
    JSON.stringify({ name: 'Fixture receipts', url: `${baseUrl}/list?page=1`, config: CONFIG }),
    'utf8',
  );

  console.log('--- part 1: the local runner CLI');
  const code = await run('node', [
    join(repoRoot, 'apps/worker/dist/cli/run-local.js'),
    '--definition',
    definitionPath,
    '--out',
    outDir,
    // The fixture serves on 127.0.0.1, which the Phase 4 SSRF guard blocks.
    '--allow-private',
  ]);
  check(code === 0, `the local runner exited with ${code}`);

  const onDisk = (await readdir(outDir)).sort();
  const expected = [...expectedCaptureNames(), 'row.json', 'rows.csv', 'rows.json'].sort();
  check(
    onDisk.length === expected.length,
    `expected ${expected.length} files on disk, found ${onDisk.length}`,
  );
  for (const name of expected) {
    check(onDisk.includes(name), `missing file on disk: ${name}`);
  }

  const rows = JSON.parse(await readFile(join(outDir, 'rows.json'), 'utf8'));
  check(rows.length === ROWS.length, `expected ${ROWS.length} rows, got ${rows.length}`);

  console.log(`part 1 wrote ${onDisk.length} files to ${outDir}`);
  return outDir;
}

async function partTwoZipExport(workDir, localOutDir) {
  console.log('--- part 2: the zip route and the export CLI');
  const config = loadConfig();
  const pool = getPool(config);
  const storage = getStorage(config);
  const queue = getQueue(config);

  await runMigrations(pool);
  await storage.ensureBucket();

  const created = { definitionId: null, runId: null, objectKeys: [] };
  let server;
  try {
    const definition = await pool.query(
      `INSERT INTO scrape_definitions (name, url, config) VALUES ($1, $2, $3) RETURNING id`,
      ['phase-5-manual', 'http://127.0.0.1/list', JSON.stringify(CONFIG)],
    );
    created.definitionId = definition.rows[0].id;

    const inserted = await pool.query(
      `INSERT INTO scrape_runs (definition_id, status, trigger)
       VALUES ($1, 'SUCCEEDED', 'MANUAL') RETURNING id`,
      [created.definitionId],
    );
    created.runId = inserted.rows[0].id;

    const names = (await readdir(localOutDir)).sort();
    for (const name of names) {
      const body = await readFile(join(localOutDir, name));
      const key = runObjectKey(created.runId, name);
      const contentType = name.endsWith('.png')
        ? 'image/png'
        : name.endsWith('.csv')
          ? 'text/csv'
          : 'application/json';
      const type = name.endsWith('.png') ? 'PNG' : name.endsWith('.csv') ? 'CSV' : 'JSON';
      await storage.put(key, body, contentType);
      created.objectKeys.push(key);
      await pool.query(
        `INSERT INTO artifacts (run_id, type, name, step_index, object_key, content_type, size_bytes)
         VALUES ($1, $2::artifact_type, $3, 0, $4, $5, $6)`,
        [created.runId, type, name, key, contentType, body.length],
      );
    }

    const app = createServer(pool, queue, storage);
    server = app.listen(0, '127.0.0.1');
    const apiBaseUrl = await listen(server);

    const exportDir = join(workDir, 'export-out');
    const code = await run('node', [
      join(repoRoot, 'apps/worker/dist/cli/export.js'),
      '--run',
      created.runId,
      '--out',
      exportDir,
      '--api',
      apiBaseUrl,
    ]);
    check(code === 0, `the export CLI exited with ${code}`);

    const unpacked = (await readdir(exportDir)).sort();
    check(
      unpacked.length === names.length,
      `expected ${names.length} unpacked files, found ${unpacked.length}`,
    );
    for (const name of names) {
      if (!unpacked.includes(name)) {
        problems.push(`missing unpacked file: ${name}`);
        continue;
      }
      const before = await readFile(join(localOutDir, name));
      const after = await readFile(join(exportDir, name));
      if (!before.equals(after)) problems.push(`bytes differ for ${name}`);
    }
    console.log(`part 2 unpacked ${unpacked.length} files to ${exportDir}`);
  } finally {
    if (server) server.close();
    for (const key of created.objectKeys) {
      await storage.remove(key).catch(() => {});
    }
    if (created.runId) {
      await pool.query('DELETE FROM scrape_runs WHERE id = $1', [created.runId]).catch(() => {});
    }
    if (created.definitionId) {
      await pool
        .query('DELETE FROM scrape_definitions WHERE id = $1', [created.definitionId])
        .catch(() => {});
    }
    await queue.close().catch(() => {});
    await pool.end().catch(() => {});
  }
}

async function main() {
  const { server, baseUrl } = await startFixtureServer();
  const workDir = await mkdtemp(join(tmpdir(), 'phase-5-export-'));
  console.log(`fixture site: ${baseUrl}`);
  console.log(`work folder: ${workDir}`);

  try {
    const localOutDir = await partOneLocalRunner(workDir, baseUrl);
    await partTwoZipExport(workDir, localOutDir);
  } finally {
    server.close();
  }

  if (problems.length > 0) {
    console.error('FAILED:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('OK');
  await rm(workDir, { recursive: true, force: true });
}

await main();
