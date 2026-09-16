#!/usr/bin/env node
// Manual acceptance test for Phase 2.
// It serves a fixture site, runs a v2 step program against it with a real
// Chromium, and writes every artifact to a temporary folder.
//
//   node scripts/manual/phase-2-interpreter.mjs
//
// Run `npx playwright install chromium` first when Chromium is missing.

import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

// Phase 4 put an SSRF guard on every navigation. The fixture server listens on
// 127.0.0.1, which the guard rejects by default.
process.env.ALLOW_PRIVATE_URLS = 'true';

// playwright is a dependency of the worker workspace, not of the repo root.
const requireFromWorker = createRequire(join(repoRoot, 'apps/worker/package.json'));
const { chromium } = requireFromWorker('playwright');
const { runScrape } = await import(join(repoRoot, 'apps/worker/dist/scrape.js'));

const ROWS = [
  { page: 1, date: '12/19/2025', amount: '$40.00', type: 'Card', receipt: '8DX6T13140' },
  { page: 1, date: '12/20/2025', amount: '$50.00', type: 'Card', receipt: '9KL2P13141' },
  { page: 1, date: '01/04/2026', amount: '$60.00', type: 'Cash', receipt: '3QW8R13142' },
  { page: 2, date: '05/02/2026', amount: '$70.00', type: 'Card', receipt: '7ZY4M13143' },
  { page: 2, date: '06/11/2026', amount: '$80.00', type: 'Card', receipt: '1AB5N13144' },
  { page: 2, date: '07/31/2026', amount: '$90.00', type: 'Cash', receipt: '5CD9V13145' },
];

const TOTAL_PAGES = 2;

function listPage(pageNumber) {
  const rows = ROWS.filter((row) => row.page === pageNumber)
    .map(
      (row) => `
        <tr>
          <td class="date">${row.date}</td>
          <td class="amount">${row.amount}</td>
          <td class="type">${row.type}</td>
          <td class="receipt-no">${row.receipt}</td>
          <td><a class="receipt" href="/receipt/${row.receipt}">Receipt</a></td>
        </tr>`,
    )
    .join('');

  const next =
    pageNumber < TOTAL_PAGES
      ? `<a class="next" href="/list?page=${pageNumber + 1}">Next</a>`
      : '<a class="next disabled" aria-disabled="true">Next</a>';

  return `<!doctype html>
<html><head><title>Transactions page ${pageNumber}</title></head>
<body>
  <h1>Transaction(s)</h1>
  <table><tbody>${rows}</tbody></table>
  <div class="pager">${next}</div>
</body></html>`;
}

function receiptPage(receipt) {
  const row = ROWS.find((candidate) => candidate.receipt === receipt);
  if (!row) return null;
  return `<!doctype html>
<html><head><title>Receipt ${receipt}</title></head>
<body>
  <div class="card">
    <h1>Receipt: #${receipt}</h1>
    <p class="date">${row.date}</p>
    <p class="total">${row.amount}</p>
    <p class="type">${row.type}</p>
  </div>
</body></html>`;
}

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/list') {
      const pageNumber = Number(url.searchParams.get('page') ?? '1');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(listPage(Number.isFinite(pageNumber) ? pageNumber : 1));
      return;
    }
    if (url.pathname.startsWith('/receipt/')) {
      const body = receiptPage(url.pathname.slice('/receipt/'.length));
      if (body) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(body);
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

const CONFIG = {
  version: 2,
  steps: [
    { op: 'goto' },
    { op: 'waitFor', selector: 'table tbody tr' },
    {
      op: 'paginate',
      nextSelector: 'a.next',
      maxPages: 5,
      steps: [
        {
          op: 'extract',
          name: 'rows',
          rowSelector: 'table tbody tr',
          fields: [
            { name: 'date', selector: 'td.date' },
            { name: 'amount', selector: 'td.amount' },
            { name: 'type', selector: 'td.type' },
            { name: 'receipt', selector: 'td.receipt-no' },
            { name: 'href', selector: 'a.receipt', attribute: 'href' },
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
                  as: ['PNG', 'PDF'],
                  name: 'receipt-p{{page}}-r{{index}}-{{row.receipt}}',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  limits: { maxPages: 100, maxSteps: 2000 },
};

const EXPECTED_CAPTURES = ROWS.length * 2;
const EXPECTED_DATASETS = 3;
const EXPECTED_TOTAL = EXPECTED_CAPTURES + EXPECTED_DATASETS;

async function main() {
  const { server, baseUrl } = await startFixtureServer();
  const outDir = await mkdtemp(join(tmpdir(), 'phase-2-interpreter-'));
  const browser = await chromium.launch();

  try {
    const result = await runScrape(browser, `${baseUrl}/list?page=1`, CONFIG);

    for (const artifact of result.artifacts) {
      await writeFile(join(outDir, artifact.name), artifact.body);
    }

    console.log(`fixture site: ${baseUrl}`);
    console.log(`output folder: ${outDir}`);
    console.log(`rows extracted: ${result.datasets.rows?.length ?? 0}`);
    console.log('artifacts:');
    for (const artifact of result.artifacts) {
      console.log(
        `  ${artifact.type.padEnd(4)} ${artifact.name} (${artifact.body.length} bytes)`,
      );
    }

    const problems = [];
    if (result.artifacts.length !== EXPECTED_TOTAL) {
      problems.push(
        `expected ${EXPECTED_TOTAL} artifacts, got ${result.artifacts.length}`,
      );
    }
    const pngCount = result.artifacts.filter((a) => a.type === 'PNG').length;
    const pdfCount = result.artifacts.filter((a) => a.type === 'PDF').length;
    if (pngCount !== ROWS.length)
      problems.push(`expected ${ROWS.length} PNG, got ${pngCount}`);
    if (pdfCount !== ROWS.length)
      problems.push(`expected ${ROWS.length} PDF, got ${pdfCount}`);
    if ((result.datasets.rows?.length ?? 0) !== ROWS.length) {
      problems.push(
        `expected ${ROWS.length} rows, got ${result.datasets.rows?.length ?? 0}`,
      );
    }
    for (const row of ROWS) {
      const expected = `receipt-p${row.page}-r${ROWS.indexOf(row)}-${row.receipt.toLowerCase()}.png`;
      if (!result.artifacts.some((a) => a.name === expected)) {
        problems.push(`missing artifact ${expected}`);
      }
    }
    if (result.artifacts.some((a) => a.body.length === 0)) {
      problems.push('at least one artifact is empty');
    }

    if (problems.length > 0) {
      console.error('FAILED:');
      for (const problem of problems) console.error(`  ${problem}`);
      process.exitCode = 1;
      return;
    }
    console.log(`OK: ${result.artifacts.length} artifacts in ${outDir}`);
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
