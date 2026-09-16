import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { main, runLocal } from '../cli/run-local.js';
import { FakeContext, textNode, type NodeSpec, type Route } from './fake-playwright.js';

const LIST_URL = 'https://fixture.test/list?page=1';
const PAGE_2_URL = 'https://fixture.test/list?page=2';

const ROWS = [
  { page: 1, receipt: '8DX6T13140', amount: '$40.00' },
  { page: 1, receipt: '9KL2P13141', amount: '$50.00' },
  { page: 2, receipt: '7ZY4M13143', amount: '$70.00' },
  { page: 2, receipt: '1AB5N13144', amount: '$80.00' },
];

/** The Phase 2 fixture site: two pages of two rows, each row with a receipt. */
function receiptRow(receipt: string, amount: string): NodeSpec {
  return {
    text: `${receipt} ${amount}`,
    nodes: {
      'td.amount': [textNode(amount)],
      'td.receipt-no': [textNode(receipt)],
      'a.receipt': [{ text: 'Receipt', attrs: { href: `/receipt/${receipt}` } }],
    },
  };
}

function receiptRoutes(): Record<string, Route> {
  const routes: Record<string, Route> = {};
  for (const row of ROWS) {
    routes[`https://fixture.test/receipt/${row.receipt}`] = () => ({
      nodes: { h1: [textNode(`Receipt ${row.receipt}`)] },
    });
  }
  return routes;
}

function fixtureSite(): FakeContext {
  return new FakeContext({
    ...receiptRoutes(),
    [LIST_URL]: () => ({
      nodes: {
        'table tbody tr': ROWS.filter((row) => row.page === 1).map((row) =>
          receiptRow(row.receipt, row.amount),
        ),
        'a.next': [
          {
            text: 'Next',
            attrs: { href: '/list?page=2' },
            onClick: (page) => page.navigate(PAGE_2_URL),
          },
        ],
      },
    }),
    [PAGE_2_URL]: () => ({
      nodes: {
        'table tbody tr': ROWS.filter((row) => row.page === 2).map((row) =>
          receiptRow(row.receipt, row.amount),
        ),
        'a.next': [{ text: 'Next', attrs: { class: 'pager disabled' } }],
      },
    }),
  });
}

function fakeBrowser(context: FakeContext): Browser {
  return {
    newContext: async () => context.asBrowserContext(),
    close: async () => {},
  } as unknown as Browser;
}

const CONFIG = {
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
};

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'run-local-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeDefinition(body: unknown): Promise<string> {
  const path = join(workDir, 'definition.json');
  await writeFile(path, JSON.stringify(body), 'utf8');
  return path;
}

describe('runLocal', () => {
  it('writes every artifact of the fixture site into the output folder', async () => {
    const definitionPath = await writeDefinition({ url: LIST_URL, config: CONFIG });
    const outDir = join(workDir, 'out');
    const lines: string[] = [];

    const result = await runLocal(
      { definitionPath, outDir, allowPrivateUrls: true },
      {
        launchBrowser: async () => fakeBrowser(fixtureSite()),
        log: (line) => lines.push(line),
      },
    );

    const expected = [
      'receipt-p1-r0-8dx6t13140.png',
      'receipt-p1-r1-9kl2p13141.png',
      'receipt-p2-r2-7zy4m13143.png',
      'receipt-p2-r3-1ab5n13144.png',
      'row.json',
      'rows.csv',
      'rows.json',
    ];
    expect((await readdir(outDir)).sort()).toEqual(expected);
    expect(result.files.map((file) => file.name).sort()).toEqual(expected);
    expect(lines[lines.length - 1]).toBe(`wrote 7 artifact(s) to ${outDir}`);

    const rows = JSON.parse(await readFile(join(outDir, 'rows.json'), 'utf8'));
    expect(rows.map((row: { receipt: string }) => row.receipt)).toEqual(
      ROWS.map((row) => row.receipt),
    );
  });

  it('accepts a bare config file with --url', async () => {
    const definitionPath = await writeDefinition(CONFIG);
    const outDir = join(workDir, 'out');

    const result = await runLocal(
      { definitionPath, outDir, url: LIST_URL, allowPrivateUrls: true },
      { launchBrowser: async () => fakeBrowser(fixtureSite()), log: () => {} },
    );

    expect(result.url).toBe(LIST_URL);
    expect(result.files).toHaveLength(7);
  });
});

describe('run-local main', () => {
  it('returns 0 and writes the artifacts for a valid invocation', async () => {
    const definitionPath = await writeDefinition({ url: LIST_URL, config: CONFIG });
    const outDir = join(workDir, 'out');

    const code = await main(
      ['--definition', definitionPath, '--out', outDir, '--allow-private'],
      { launchBrowser: async () => fakeBrowser(fixtureSite()), log: () => {} },
    );

    expect(code).toBe(0);
    expect(await readdir(outDir)).toHaveLength(7);
  });

  it.each([
    { desc: 'no --out flag', argv: ['--definition', 'x.json'], code: 2 },
    { desc: 'no --definition flag', argv: ['--out', 'folder'], code: 2 },
  ])('returns $code for $desc', async ({ argv, code }) => {
    const exit = await main(argv, {
      launchBrowser: async () => fakeBrowser(fixtureSite()),
      log: () => {},
    });
    expect(exit).toBe(code);
  });

  it.each([
    {
      desc: 'a definition file that is not there',
      build: async () => join(workDir, 'absent.json'),
    },
    {
      desc: 'a config that the validator rejects',
      build: () => writeDefinition({ url: LIST_URL, config: { steps: [] } }),
    },
    {
      desc: 'a definition that carries no url',
      build: () => writeDefinition({ config: CONFIG }),
    },
  ])('returns 1 for $desc', async ({ build }) => {
    const definitionPath = await build();

    const code = await main(
      ['--definition', definitionPath, '--out', join(workDir, 'out')],
      {
        launchBrowser: async () => fakeBrowser(fixtureSite()),
        log: () => {},
      },
    );

    expect(code).toBe(1);
  });

  it('returns 1 and reports the step error code when a selector is missing', async () => {
    const definitionPath = await writeDefinition({
      url: LIST_URL,
      config: {
        steps: [{ op: 'goto' }, { op: 'waitFor', selector: 'table#absent' }],
      },
    });

    const code = await main(
      ['--definition', definitionPath, '--out', join(workDir, 'out')],
      {
        launchBrowser: async () => fakeBrowser(fixtureSite()),
        log: () => {},
      },
    );

    expect(code).toBe(1);
  });
});
