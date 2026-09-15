#!/usr/bin/env node
// Manual acceptance test for Phase 9.
//
//   node scripts/manual/phase-9-courtreserve-fixture.mjs
//
// The real CourtReserve page needs the user's own session, so it cannot be an
// automated test. This script serves a CourtReserve-SHAPED fixture instead: a
// Kendo UI 2022.1 grid with .k-grid, .k-grid-content, tr.k-master-row, a
// .k-pager-wrap whose next arrow works and carries .k-state-disabled on the
// last page, a .k-tabstrip, and two date inputs.
//
// It then runs the SHIPPED definition file, definitions/courtreserve-receipts.json,
// with only the base URL and the auth mode overridden, and asserts the exact
// files on disk. That proves the structure of the definition that ships.
//
// It needs Chromium and nothing else. No Postgres, no Redis, no MinIO.
// Run `npx playwright install chromium` first when Chromium is missing.

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

// playwright is a dependency of the worker workspace, not of the repo root.
const requireFromWorker = createRequire(join(repoRoot, 'apps/worker/package.json'));
const { chromium } = requireFromWorker('playwright');

const DEFINITION_PATH = join(repoRoot, 'definitions/courtreserve-receipts.json');

const ROWS = [
  {
    page: 1,
    date: '01/12/2024',
    amount: '$40.00',
    paid: '01/12/2024',
    type: 'Card',
    receipt: '8DX6T13140',
  },
  {
    page: 1,
    date: '02/19/2024',
    amount: '$50.00',
    paid: '02/19/2024',
    type: 'Card',
    receipt: '9KL2P13141',
  },
  {
    page: 1,
    date: '03/04/2024',
    amount: '$60.00',
    paid: '03/05/2024',
    type: 'Cash',
    receipt: '3QW8R13142',
  },
  {
    page: 2,
    date: '05/02/2025',
    amount: '$70.00',
    paid: '05/02/2025',
    type: 'Card',
    receipt: '7ZY4M13143',
  },
  {
    page: 2,
    date: '06/11/2025',
    amount: '$80.00',
    paid: '06/11/2025',
    type: 'Card',
    receipt: '1AB5N13144',
  },
  {
    page: 2,
    date: '07/31/2025',
    amount: '$90.00',
    paid: '08/01/2025',
    type: 'Cash',
    receipt: '5CD9V13145',
  },
  {
    page: 3,
    date: '08/14/2026',
    amount: '$100.00',
    paid: '08/14/2026',
    type: 'Card',
    receipt: '2EF7X13146',
  },
  {
    page: 3,
    date: '09/01/2026',
    amount: '$110.00',
    paid: '09/02/2026',
    type: 'Cash',
    receipt: '6GH3Z13147',
  },
];

const TOTAL_PAGES = 3;

const problems = [];

function check(condition, message) {
  if (condition) console.log(`ok   ${message}`);
  else {
    problems.push(message);
    console.log(`FAIL ${message}`);
  }
}

/**
 * The Kendo 2022.1 markup, as closely as the public class names allow: the
 * header and the body live in two tables, the data rows carry k-master-row,
 * and the alternate rows carry k-alt.
 */
function listPage(pageNumber) {
  const rows = ROWS.filter((row) => row.page === pageNumber)
    .map(
      (row, index) => `
            <tr class="k-master-row${index % 2 === 1 ? ' k-alt' : ''}" role="row">
              <td role="gridcell">${row.date}</td>
              <td role="gridcell">${row.amount}</td>
              <td role="gridcell">${row.paid}</td>
              <td role="gridcell">${row.type}</td>
              <td role="gridcell"><a class="k-button k-button-solid-primary" href="/receipt/${row.receipt}">Receipt</a></td>
            </tr>`,
    )
    .join('');

  const prevDisabled = pageNumber === 1 ? ' k-state-disabled' : '';
  const nextDisabled = pageNumber === TOTAL_PAGES ? ' k-state-disabled' : '';
  const nextHref =
    pageNumber === TOTAL_PAGES
      ? ''
      : ` href="/Online/MyBalance/Index/13140?page=${pageNumber + 1}"`;

  const numbers = Array.from({ length: TOTAL_PAGES }, (_unused, i) => i + 1)
    .map((number) =>
      number === pageNumber
        ? `<span class="k-link k-state-selected">${number}</span>`
        : `<a class="k-link" href="/Online/MyBalance/Index/13140?page=${number}">${number}</a>`,
    )
    .join('');

  return `<!doctype html>
<html><head><title>Transaction(s) — page ${pageNumber}</title>
<script src="/Scripts/kendo/2022.1.301/cultures/kendo.culture.en-US.min.js"></script>
</head>
<body>
  <h2>Transaction(s)</h2>

  <div class="k-widget k-tabstrip" id="transaction-tabs">
    <ul class="k-tabstrip-items" role="tablist">
      <li class="k-item k-state-active" role="tab" aria-selected="true"><span class="k-link">Transaction Details</span></li>
      <li class="k-item" role="tab" aria-selected="false"><span class="k-link">Packages</span></li>
    </ul>
  </div>

  <div class="k-widget k-tabstrip" id="detail-tabs">
    <ul class="k-tabstrip-items" role="tablist">
      <li class="k-item" role="tab" aria-selected="false"><span class="k-link">Unpaid</span></li>
      <li class="k-item" role="tab" aria-selected="false"><span class="k-link">Paid</span></li>
      <li class="k-item k-state-active" role="tab" aria-selected="true"><span class="k-link">Payments</span></li>
      <li class="k-item" role="tab" aria-selected="false"><span class="k-link">Adjustments</span></li>
      <li class="k-item" role="tab" aria-selected="false"><span class="k-link">All</span></li>
    </ul>
  </div>

  <div class="date-range">
    <input id="StartDate" name="StartDate" class="k-input k-textbox" value="05/02/2026" placeholder="Start Date" />
    <input id="EndDate" name="EndDate" class="k-input k-textbox" value="07/31/2026" placeholder="End Date" />
  </div>

  <div class="k-widget k-grid" id="transactions-grid">
    <div class="k-grid-header">
      <table role="presentation">
        <thead><tr role="row">
          <th class="k-header">Date</th>
          <th class="k-header">Amount</th>
          <th class="k-header">Paid Date</th>
          <th class="k-header">Payment Type</th>
          <th class="k-header">&nbsp;</th>
        </tr></thead>
      </table>
    </div>
    <div class="k-grid-content">
      <table role="grid">
        <tbody>${rows}
        </tbody>
      </table>
    </div>
    <div class="k-pager-wrap k-grid-pager" id="transactions-pager">
      <a class="k-pager-nav k-link${prevDisabled}" title="Go to the previous page">&lt;</a>
      ${numbers}
      <a class="k-pager-nav k-link${nextDisabled}"${nextHref} title="Go to the next page">&gt;</a>
    </div>
  </div>
</body></html>`;
}

function receiptPage(receipt) {
  const row = ROWS.find((candidate) => candidate.receipt === receipt);
  if (!row) return null;
  return `<!doctype html>
<html><head><title>Receipt ${receipt}</title></head>
<body>
  <button type="button">Home</button>
  <button type="button">Print</button>
  <div class="receipt-card">
    <h1>Receipt: #${receipt}</h1>
    <p class="member">Member #13140</p>
    <p class="line-item">Court booking</p>
    <p class="total">${row.amount}</p>
    <p class="type">${row.type}</p>
    <p class="stamp">${row.paid}</p>
  </div>
</body></html>`;
}

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/Online/MyBalance/Index/13140') {
      const raw = Number(url.searchParams.get('page') ?? '1');
      const pageNumber = Number.isFinite(raw) && raw >= 1 && raw <= TOTAL_PAGES ? raw : 1;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(listPage(pageNumber));
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
    if (url.pathname.startsWith('/Scripts/')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end('/* kendo culture stub */');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      done({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/**
 * Take the SHIPPED definition and change only what the fixture cannot provide:
 * the auth mode, because there is no logged-in Chrome here. Every selector and
 * every step stays exactly as it ships.
 */
function fixtureDefinition(shipped) {
  const config = structuredClone(shipped.config);
  config.auth = { mode: 'none' };
  return { name: shipped.name, config };
}

/** The names the definition's capture template must produce, in run order. */
function expectedCaptureNames() {
  const names = [];
  for (let pageNumber = 1; pageNumber <= TOTAL_PAGES; pageNumber += 1) {
    const rows = ROWS.filter((row) => row.page === pageNumber);
    for (const row of rows) {
      const index = ROWS.indexOf(row);
      const date = row.date.replace(/\//g, '-');
      names.push(`receipt-${pageNumber}-${index}-${date}`);
    }
  }
  return names;
}

/**
 * Prove that the discovery CLI names the real selectors. It runs against the
 * same fixture through real Playwright, so it also proves that Playwright can
 * serialize `collectDiscovery` and run it in the page.
 */
async function partOneDiscovery(workDir, baseUrl) {
  console.log('--- part 1: the discovery CLI');
  const { discover } = await import(join(repoRoot, 'apps/worker/dist/cli/discover.js'));
  const lines = [];
  const report = await discover(
    {
      url: `${baseUrl}/Online/MyBalance/Index/13140?page=1`,
      outPath: join(workDir, 'discovery-report.json'),
    },
    {
      launchBrowser: () => chromium.launch({ headless: true }),
      log: (line) => lines.push(line),
    },
  );

  check(report.grids.length === 1, `the report found 1 grid, got ${report.grids.length}`);
  check(
    report.grids[0]?.id === 'transactions-grid',
    `the grid id is transactions-grid, got ${report.grids[0]?.id}`,
  );
  check(
    JSON.stringify(report.grids[0]?.headers) ===
      JSON.stringify(['Date', 'Amount', 'Paid Date', 'Payment Type', '']),
    'the report read the five column headers',
  );
  check(
    report.grids[0]?.rowCount === 3,
    `the report counted 3 rows, got ${report.grids[0]?.rowCount}`,
  );
  check(
    report.rowControls.length === 1 && report.rowControls[0].text === 'Receipt',
    'the report found the Receipt control in the first row',
  );
  check(
    report.rowControls[0]?.href === '/receipt/8DX6T13140',
    `the report read the receipt href, got ${report.rowControls[0]?.href}`,
  );
  check(
    report.dateInputs.length === 2,
    `the report found 2 date inputs, got ${report.dateInputs.length}`,
  );
  check(
    report.tabStrips.length === 2 &&
      report.tabStrips[1].items.some((item) => item.text === 'Payments' && item.active),
    'the report found the Payments sub-tab and saw that it is active',
  );

  const text = lines.join('\n');
  check(
    text.includes('rowSelector: #transactions-grid tr.k-master-row'),
    'the printed report suggests the Kendo master row selector',
  );
  check(
    text.includes('a[title="Go to the next page"]'),
    'the printed report suggests the next arrow, not the previous one',
  );
  check(
    text.includes('courtreserve-receipts.json'),
    'the printed report recommends the openLink shape for an anchor with an href',
  );
  console.log(`part 1 wrote ${join(workDir, 'discovery-report.json')}`);
}

async function main() {
  // The script drives apps/worker/dist. A stale dist passes the wrong code and
  // reports a failure that the source does not hold, so build first.
  execFileSync('npx', ['tsc', '-b', 'apps/worker'], { cwd: repoRoot, stdio: 'inherit' });

  const shipped = JSON.parse(await readFile(DEFINITION_PATH, 'utf8'));
  console.log(`definition: ${DEFINITION_PATH}`);

  const { server, baseUrl } = await startFixtureServer();
  const workDir = await mkdtemp(join(tmpdir(), 'phase-9-courtreserve-'));
  const outDir = join(workDir, 'out');
  console.log(`fixture site: ${baseUrl}`);
  console.log(`output folder: ${outDir}`);

  try {
    await partOneDiscovery(workDir, baseUrl);

    console.log('');
    console.log('--- part 2: the shipped definition');
    const definitionPath = join(workDir, 'phase-9-fixture-definition.json');
    await writeFile(definitionPath, JSON.stringify(fixtureDefinition(shipped)), 'utf8');

    const { runLocal } = await import(
      join(repoRoot, 'apps/worker/dist/cli/run-local.js')
    );
    await runLocal(
      {
        definitionPath,
        outDir,
        // The only override: the fixture host, in place of app.courtreserve.com.
        url: `${baseUrl}/Online/MyBalance/Index/13140?page=1`,
        allowPrivateUrls: true,
      },
      {
        launchBrowser: () => chromium.launch({ headless: true }),
        log: (line) => console.log(line),
      },
    );

    const onDisk = (await readdir(outDir)).sort();
    const captures = expectedCaptureNames();
    const expected = [
      ...captures.map((name) => `${name}.png`),
      ...captures.map((name) => `${name}.pdf`),
      'receipts.json',
      'receipts.csv',
    ].sort();

    check(
      onDisk.length === expected.length,
      `expected ${expected.length} files on disk, found ${onDisk.length}`,
    );
    for (const name of expected) {
      check(onDisk.includes(name), `expected file on disk: ${name}`);
    }
    for (const name of onDisk) {
      check(expected.includes(name), `no unexpected file on disk: ${name}`);
    }

    const rows = JSON.parse(await readFile(join(outDir, 'receipts.json'), 'utf8'));
    check(
      rows.length === ROWS.length,
      `receipts.json holds ${ROWS.length} rows, got ${rows.length}`,
    );
    check(
      rows.every((row, i) => row.date === ROWS[i].date && row.amount === ROWS[i].amount),
      'receipts.json holds the date and the amount of every row, in page order',
    );
    check(
      rows.every(
        (row, i) => row.paidDate === ROWS[i].paid && row.paymentType === ROWS[i].type,
      ),
      'receipts.json holds the paid date and the payment type of every row',
    );

    const csv = await readFile(join(outDir, 'receipts.csv'), 'utf8');
    check(
      csv.split('\n').filter((line) => line.length > 0).length === ROWS.length + 1,
      'receipts.csv holds one header line and one line per row',
    );

    // The pager stopped on its own. A runaway pager would have revisited page 3
    // and produced a duplicate name with a -2 suffix.
    check(
      onDisk.every((name) => !/-2\.(png|pdf)$/.test(name)),
      'the pager stopped on the k-state-disabled arrow rather than looping',
    );
  } finally {
    server.close();
    if (problems.length === 0) await rm(workDir, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(
    `\nOK: the shipped definition produced ${expectedCaptureNames().length * 2 + 2} files`,
  );
}

await main();
