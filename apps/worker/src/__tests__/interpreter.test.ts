import { describe, it, expect } from 'vitest';
import type { Limits, ScrapeConfig, Step } from '@scraper/shared';
import { runProgram, type RunScrapeOptions, type ScrapeResult } from '../interpreter.js';
import { FakeContext, textNode, type NodeSpec, type Route } from './fake-playwright.js';

const LIST_URL = 'https://site.test/list';
const PAGE_2_URL = 'https://site.test/list?page=2';

function receiptRow(date: string, amount: string, href: string): NodeSpec {
  return {
    text: `${date} ${amount}`,
    nodes: {
      'td.date': [textNode(date)],
      'td.amount': [textNode(amount)],
      'a.receipt': [{ text: 'Receipt', attrs: { href } }],
    },
  };
}

function receiptPage(label: string): Route {
  return () => ({ nodes: { h1: [textNode(`Receipt ${label}`)] } });
}

const RECEIPT_ROUTES: Record<string, Route> = {
  'https://site.test/receipt/1': receiptPage('1'),
  'https://site.test/receipt/2': receiptPage('2'),
  'https://site.test/receipt/3': receiptPage('3'),
  'https://site.test/receipt/4': receiptPage('4'),
};

/** Two pages of two rows, with a pager whose next control is disabled on page 2. */
function pagedSite(): FakeContext {
  const context: FakeContext = new FakeContext({
    ...RECEIPT_ROUTES,
    [LIST_URL]: () => ({
      nodes: {
        '#ready': [textNode('ok')],
        'tbody tr': [
          receiptRow('12/19/2025', '$40.00', '/receipt/1'),
          receiptRow('12/20/2025', '$50.00', '/receipt/2'),
        ],
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
        'tbody tr': [
          receiptRow('01/04/2026', '$60.00', '/receipt/3'),
          receiptRow('01/05/2026', '$70.00', '/receipt/4'),
        ],
        'a.next': [{ text: 'Next', attrs: { class: 'pager-link disabled' } }],
      },
    }),
  });
  return context;
}

function run(
  context: FakeContext,
  steps: Step[],
  extra: Partial<ScrapeConfig> = {},
  options?: RunScrapeOptions,
): Promise<ScrapeResult> {
  const config: ScrapeConfig = { steps, ...extra };
  return runProgram(context.asBrowserContext(), LIST_URL, config, options);
}

function firstPageLog(context: FakeContext): string[] {
  return context.allPages[0]?.log ?? [];
}

describe('goto', () => {
  it('uses the definition URL when the step names none', async () => {
    const context = pagedSite();
    await run(context, [{ op: 'goto' }]);
    expect(firstPageLog(context)).toContain(`goto:${LIST_URL}:load`);
  });

  it('uses the step URL and the requested waitUntil', async () => {
    const context = pagedSite();
    await run(context, [{ op: 'goto', url: PAGE_2_URL, waitUntil: 'networkidle' }]);
    expect(firstPageLog(context)).toContain(`goto:${PAGE_2_URL}:networkidle`);
  });
});

describe('waitFor', () => {
  it('waits for a page-level selector', async () => {
    const context = pagedSite();
    await run(context, [
      { op: 'goto' },
      { op: 'waitFor', selector: '#ready', state: 'attached' },
    ]);
    expect(firstPageLog(context)).toContain('waitForSelector:#ready:attached');
  });

  it('fails when the selector never matches', async () => {
    const context = pagedSite();
    await expect(
      run(context, [{ op: 'goto' }, { op: 'waitFor', selector: '#missing' }]),
    ).rejects.toThrow('#missing');
  });
});

describe('click', () => {
  it('clicks the first match', async () => {
    const context = pagedSite();
    await run(context, [{ op: 'goto' }, { op: 'click', selector: 'a.next' }]);
    expect(context.allPages[0]?.url()).toBe(PAGE_2_URL);
  });

  it('treats a missing optional target as a no-op', async () => {
    const context = pagedSite();
    await run(context, [
      { op: 'goto' },
      { op: 'click', selector: 'a.nope', optional: true },
    ]);
    expect(firstPageLog(context)).not.toContain('click');
  });

  it('fails on a missing target that is not optional', async () => {
    const context = pagedSite();
    await expect(
      run(context, [{ op: 'goto' }, { op: 'click', selector: 'a.nope' }]),
    ).rejects.toThrow();
  });

  it('makes a newTab page current until goBack closes it', async () => {
    const context = new FakeContext({
      ...RECEIPT_ROUTES,
      [LIST_URL]: () => ({
        nodes: {
          'button.receipt': [
            {
              text: 'Receipt',
              onClick: (_page, ctx) => {
                ctx.openPage('https://site.test/receipt/1');
              },
            },
          ],
        },
      }),
    });

    const result = await run(context, [
      { op: 'goto' },
      { op: 'click', selector: 'button.receipt', opens: 'newTab' },
      { op: 'capture', as: ['PNG'], name: 'popup' },
      { op: 'goBack' },
      { op: 'capture', as: ['PNG'], name: 'back' },
    ]);

    expect(result.artifacts.map((a) => a.body.toString('utf8'))).toEqual([
      'png:https://site.test/receipt/1',
      `png:${LIST_URL}`,
    ]);
    expect(context.allPages[1]?.closed).toBe(true);
  });
});

describe('fill', () => {
  const formSite = (): FakeContext =>
    new FakeContext({
      [LIST_URL]: () => ({
        nodes: { '#password': [textNode('')], '#from': [textNode('')] },
      }),
    });

  it('fills a literal value', async () => {
    const context = formSite();
    await run(context, [
      { op: 'goto' },
      { op: 'fill', selector: '#from', value: '05/02/2026' },
    ]);
    expect(firstPageLog(context)).toContain('fill:05/02/2026');
  });

  it('fills from a resolved secret', async () => {
    const context = formSite();
    await run(
      context,
      [{ op: 'goto' }, { op: 'fill', selector: '#password', valueFrom: 'court_pw' }],
      {},
      { secrets: { court_pw: 'hunter2' } },
    );
    expect(firstPageLog(context)).toContain('fill:hunter2');
  });

  it('throws AUTH_FAILED when the secret is absent', async () => {
    const context = formSite();
    await expect(
      run(context, [
        { op: 'goto' },
        { op: 'fill', selector: '#password', valueFrom: 'court_pw' },
      ]),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
});

describe('select, press and scroll', () => {
  it('selects an option', async () => {
    const context = pagedSite();
    await run(context, [
      { op: 'goto' },
      { op: 'select', selector: '#ready', value: '50' },
    ]);
    expect(firstPageLog(context)).toContain('select:50');
  });

  it('presses a key on the current page', async () => {
    const context = pagedSite();
    await run(context, [{ op: 'goto' }, { op: 'press', key: 'Enter' }]);
    expect(firstPageLog(context)).toContain('press:Enter');
  });

  it('scrolls an element into view', async () => {
    const context = pagedSite();
    await run(context, [
      { op: 'goto' },
      { op: 'scroll', to: 'element', selector: '#ready' },
    ]);
    expect(firstPageLog(context)).toContain('scrollIntoView');
  });

  it('scrolls to the bottom with a constant the repository owns', async () => {
    const context = pagedSite();
    await run(context, [{ op: 'goto' }, { op: 'scroll', to: 'bottom' }]);
    expect(firstPageLog(context)).toContain(
      'evaluate:window.scrollTo(0, document.body.scrollHeight)',
    );
  });
});

describe('extract', () => {
  const extractStep: Step = {
    op: 'extract',
    name: 'rows',
    rowSelector: 'tbody tr',
    fields: [
      { name: 'date', selector: 'td.date' },
      { name: 'amount', selector: 'td.amount' },
      { name: 'receipt', selector: 'a.receipt', attribute: 'href' },
      { name: 'absent', selector: 'td.absent' },
    ],
  };

  it('reads one row per match and emits one JSON artifact', async () => {
    const context = pagedSite();
    const result = await run(context, [{ op: 'goto' }, extractStep]);

    expect(result.datasets.rows).toEqual([
      { date: '12/19/2025', amount: '$40.00', receipt: '/receipt/1', absent: null },
      { date: '12/20/2025', amount: '$50.00', receipt: '/receipt/2', absent: null },
    ]);
    expect(result.artifacts.map((a) => a.name)).toEqual(['rows.json']);
  });

  it('emits a CSV artifact as well when emit asks for one', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      { ...extractStep, emit: ['JSON', 'CSV'] },
    ]);
    expect(result.artifacts.map((a) => a.name)).toEqual(['rows.json', 'rows.csv']);
    expect(result.artifacts[1]?.body.toString('utf8').split('\n')).toHaveLength(3);
  });

  it('reads one row from the scope when there is no rowSelector', async () => {
    const context = new FakeContext({
      [LIST_URL]: () => ({ nodes: { body: [{ nodes: { h1: [textNode('Balance')] } }] } }),
    });
    const result = await run(context, [
      { op: 'goto' },
      { op: 'extract', name: 'head', fields: [{ name: 'title', selector: 'h1' }] },
    ]);
    expect(result.datasets.head).toEqual([{ title: 'Balance' }]);
  });

  it('accumulates every page into one dataset and one file', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      { op: 'paginate', nextSelector: 'a.next', maxPages: 2, steps: [extractStep] },
    ]);
    expect(result.datasets.rows).toHaveLength(4);
    expect(result.artifacts.map((a) => a.name)).toEqual(['rows.json']);
    expect(JSON.parse(result.artifacts[0]!.body.toString('utf8'))).toHaveLength(4);
  });
});

describe('capture', () => {
  it('captures each requested form of the current page', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      { op: 'capture', as: ['PNG', 'PDF', 'HTML'], name: 'page' },
    ]);
    expect(result.artifacts.map((a) => [a.type, a.name, a.contentType])).toEqual([
      ['PNG', 'page.png', 'image/png'],
      ['PDF', 'page.pdf', 'application/pdf'],
      ['HTML', 'page.html', 'text/html'],
    ]);
    expect(firstPageLog(context)).toContain('screenshot:true');
  });

  it('honours fullPage: false', async () => {
    const context = pagedSite();
    await run(context, [
      { op: 'goto' },
      { op: 'capture', as: ['PNG'], name: 'page', fullPage: false },
    ]);
    expect(firstPageLog(context)).toContain('screenshot:false');
  });

  it('suffixes a name that two steps resolve to', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      { op: 'capture', as: ['PNG'], name: 'page' },
      { op: 'capture', as: ['PNG'], name: 'page' },
    ]);
    expect(result.artifacts.map((a) => a.name)).toEqual(['page.png', 'page-2.png']);
  });

  it('records the index of the step that produced the artifact', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      { op: 'capture', as: ['PNG'], name: 'page' },
    ]);
    expect(result.artifacts[0]?.stepIndex).toBe(1);
  });
});

describe('forEach', () => {
  it('scopes nested steps to the row and binds index', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      {
        op: 'forEach',
        rowSelector: 'tbody tr',
        steps: [
          {
            op: 'extract',
            name: 'row',
            fields: [{ name: 'date', selector: 'td.date' }],
          },
          { op: 'capture', as: ['PNG'], name: 'r{{index}}-{{row.date}}' },
        ],
      },
    ]);
    expect(result.artifacts.filter((a) => a.type === 'PNG').map((a) => a.name)).toEqual([
      'r0-12-19-2025.png',
      'r1-12-20-2025.png',
    ]);
  });

  it('stops at max', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      {
        op: 'forEach',
        rowSelector: 'tbody tr',
        max: 1,
        steps: [{ op: 'capture', as: ['PNG'], name: 'r{{index}}' }],
      },
    ]);
    expect(result.artifacts.map((a) => a.name)).toEqual(['r0.png']);
  });
});

describe('openLink', () => {
  it('opens the href in a new page, runs the nested steps, then closes it', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      {
        op: 'forEach',
        rowSelector: 'tbody tr',
        steps: [
          {
            op: 'openLink',
            selector: 'a.receipt',
            steps: [{ op: 'capture', as: ['PNG'], name: 'receipt-{{index}}' }],
          },
        ],
      },
    ]);

    expect(result.artifacts.map((a) => a.name)).toEqual([
      'receipt-0.png',
      'receipt-1.png',
    ]);
    expect(result.artifacts.map((a) => a.body.toString('utf8'))).toEqual([
      'png:https://site.test/receipt/1',
      'png:https://site.test/receipt/2',
    ]);
    expect(context.allPages.slice(1).every((page) => page.closed)).toBe(true);
  });

  it('reads a different attribute when the step names one', async () => {
    const context = new FakeContext({
      ...RECEIPT_ROUTES,
      [LIST_URL]: () => ({
        nodes: { 'button.r': [{ attrs: { 'data-href': '/receipt/3' } }] },
      }),
    });
    const result = await run(context, [
      { op: 'goto' },
      {
        op: 'openLink',
        selector: 'button.r',
        attribute: 'data-href',
        steps: [{ op: 'capture', as: ['HTML'], name: 'receipt' }],
      },
    ]);
    expect(result.artifacts[0]?.body.toString('utf8')).toBe(
      '<html>https://site.test/receipt/3</html>',
    );
  });

  it('throws when the attribute is absent', async () => {
    const context = new FakeContext({
      [LIST_URL]: () => ({ nodes: { 'a.r': [textNode('no href')] } }),
    });
    await expect(
      run(context, [
        { op: 'goto' },
        { op: 'openLink', selector: 'a.r', steps: [{ op: 'goBack' }] },
      ]),
    ).rejects.toMatchObject({ code: 'SELECTOR_NOT_FOUND' });
  });
});

describe('paginate', () => {
  it('walks every page up to maxPages', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      {
        op: 'paginate',
        nextSelector: 'a.next',
        maxPages: 5,
        steps: [
          {
            op: 'extract',
            name: 'rows',
            rowSelector: 'tbody tr',
            fields: [{ name: 'date', selector: 'td.date' }],
          },
          { op: 'capture', as: ['PNG'], name: 'page-{{page}}' },
        ],
      },
    ]);
    expect(result.artifacts.filter((a) => a.type === 'PNG').map((a) => a.name)).toEqual([
      'page-1.png',
      'page-2.png',
    ]);
    expect(result.datasets.rows).toHaveLength(4);
  });

  it('stops when the next control is disabled', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto', url: PAGE_2_URL },
      {
        op: 'paginate',
        nextSelector: 'a.next',
        maxPages: 5,
        steps: [{ op: 'capture', as: ['PNG'], name: 'page-{{page}}' }],
      },
    ]);
    expect(result.artifacts.map((a) => a.name)).toEqual(['page-1.png']);
  });

  it.each([
    { desc: 'a disabled attribute', attrs: { disabled: '' } },
    { desc: 'aria-disabled', attrs: { 'aria-disabled': 'true' } },
    { desc: 'a disabled class', attrs: { class: 'btn is-disabled' } },
  ])('treats $desc as the end of the pager', async ({ attrs }) => {
    const context = new FakeContext({
      [LIST_URL]: () => ({
        nodes: {
          'tbody tr': [receiptRow('a', 'b', '/receipt/1')],
          'a.next': [{ text: 'Next', attrs }],
        },
      }),
    });
    const result = await run(context, [
      { op: 'goto' },
      {
        op: 'paginate',
        nextSelector: 'a.next',
        maxPages: 9,
        steps: [{ op: 'capture', as: ['PNG'], name: 'page-{{page}}' }],
      },
    ]);
    expect(result.artifacts).toHaveLength(1);
  });

  it('stops when maxPages is reached', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      {
        op: 'paginate',
        nextSelector: 'a.next',
        maxPages: 1,
        steps: [{ op: 'capture', as: ['PNG'], name: 'page-{{page}}' }],
      },
    ]);
    expect(result.artifacts.map((a) => a.name)).toEqual(['page-1.png']);
  });

  it('stops when the page does not change', async () => {
    const context = new FakeContext({
      [LIST_URL]: () => ({
        nodes: {
          'tbody tr': [receiptRow('a', 'b', '/receipt/1')],
          'a.next': [{ text: 'Next' }],
        },
      }),
    });
    const result = await run(context, [
      { op: 'goto' },
      {
        op: 'paginate',
        nextSelector: 'a.next',
        maxPages: 50,
        steps: [
          {
            op: 'forEach',
            rowSelector: 'tbody tr',
            steps: [{ op: 'capture', as: ['PNG'], name: 'r{{index}}' }],
          },
        ],
      },
    ]);
    expect(result.artifacts.map((a) => a.name)).toEqual(['r0.png']);
  });
});

describe('paginate wrapping forEach wrapping openLink', () => {
  it('captures every receipt on every page with a stable index', async () => {
    const context = pagedSite();
    const result = await run(context, [
      { op: 'goto' },
      {
        op: 'paginate',
        nextSelector: 'a.next',
        maxPages: 5,
        steps: [
          {
            op: 'forEach',
            rowSelector: 'tbody tr',
            steps: [
              {
                op: 'extract',
                name: 'rows',
                fields: [{ name: 'date', selector: 'td.date' }],
                emit: ['JSON', 'CSV'],
              },
              {
                op: 'openLink',
                selector: 'a.receipt',
                steps: [
                  {
                    op: 'capture',
                    as: ['PNG'],
                    name: 'p{{page}}-r{{index}}-{{row.date}}',
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    expect(result.artifacts.filter((a) => a.type === 'PNG').map((a) => a.name)).toEqual([
      'p1-r0-12-19-2025.png',
      'p1-r1-12-20-2025.png',
      'p2-r2-01-04-2026.png',
      'p2-r3-01-05-2026.png',
    ]);
    expect(result.datasets.rows).toHaveLength(4);
    expect(result.artifacts.map((a) => a.name).slice(-2)).toEqual([
      'rows.json',
      'rows.csv',
    ]);
  });
});

describe('goBack', () => {
  it('navigates back when only one page is open', async () => {
    const context = pagedSite();
    await run(context, [{ op: 'goto' }, { op: 'goBack' }]);
    expect(firstPageLog(context)).toContain('goBack');
  });
});

describe('limits', () => {
  async function expectLimit(steps: Step[], limits: Limits, options?: RunScrapeOptions) {
    await expect(run(pagedSite(), steps, { limits }, options)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
  }

  it('enforces maxSteps', async () => {
    await expectLimit([{ op: 'goto' }, { op: 'goBack' }, { op: 'goBack' }], {
      maxSteps: 2,
    });
  });

  it('enforces maxPages', async () => {
    await expectLimit([{ op: 'goto' }, { op: 'goto' }, { op: 'goto' }], { maxPages: 2 });
  });

  it('enforces maxArtifacts', async () => {
    await expectLimit(
      [
        { op: 'goto' },
        { op: 'capture', as: ['PNG'], name: 'a' },
        { op: 'capture', as: ['PNG'], name: 'b' },
      ],
      { maxArtifacts: 1 },
    );
  });

  it('enforces maxDurationMs with the injected clock', async () => {
    let clock = 0;
    await expectLimit(
      [{ op: 'goto' }, { op: 'goBack' }, { op: 'goBack' }],
      { maxDurationMs: 150 },
      {
        now: () => {
          clock += 100;
          return clock;
        },
      },
    );
  });

  it('names the limit that it broke', async () => {
    await expect(
      run(pagedSite(), [{ op: 'goto' }, { op: 'goBack' }], { limits: { maxSteps: 1 } }),
    ).rejects.toThrow('maxSteps');
  });
});
