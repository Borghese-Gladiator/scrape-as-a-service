import { describe, it, expect } from 'vitest';
import {
  authForOptions,
  DEFAULT_CHROME_USER_DATA_DIR,
  DiscoverError,
  formatReport,
  suggestions,
} from '../cli/discover.js';
import type { DiscoveryReport } from '../cli/discover-script.js';

function report(overrides: Partial<DiscoveryReport> = {}): DiscoveryReport {
  return {
    url: 'https://app.courtreserve.com/Online/MyBalance/Index/13140?page=details',
    title: 'Transaction(s)',
    grids: [
      {
        tag: 'table',
        id: '',
        classes: ['layout'],
        headers: ['Menu'],
        rowSelector: 'tr',
        rowCount: 1,
      },
      {
        tag: 'div',
        id: 'transactions-grid',
        classes: ['k-widget', 'k-grid'],
        headers: ['Date', 'Amount', 'Paid Date', 'Payment Type', ''],
        rowSelector: 'tr.k-master-row',
        rowCount: 10,
      },
    ],
    rowControls: [
      {
        gridIndex: 1,
        tag: 'a',
        text: 'Receipt',
        id: '',
        classes: ['k-button'],
        href: '/Online/Receipt/Index/8DX6T13140',
        target: '_blank',
        hasHandler: false,
        newTab: true,
      },
    ],
    pagers: [
      {
        tag: 'div',
        id: 'transactions-pager',
        classes: ['k-pager-wrap'],
        controls: [
          {
            tag: 'a',
            text: '<',
            id: '',
            classes: ['k-pager-nav', 'k-state-disabled'],
            title: 'Go to the previous page',
            ariaLabel: null,
            disabled: true,
          },
          {
            tag: 'a',
            text: '>',
            id: '',
            classes: ['k-pager-nav'],
            title: 'Go to the next page',
            ariaLabel: null,
            disabled: false,
          },
        ],
      },
    ],
    tabStrips: [],
    dateInputs: [],
    ...overrides,
  };
}

function suggestionFor(input: DiscoveryReport, field: string) {
  return suggestions(input).find((entry) => entry.field === field);
}

describe('suggestions', () => {
  it('picks the grid with the most rows and names its Kendo row selector', () => {
    const row = suggestionFor(report(), 'rowSelector');

    expect(row?.selector).toBe('#transactions-grid tr.k-master-row');
    expect(row?.evidence).toContain('10 data row(s)');
    expect(row?.evidence).toContain('Date | Amount | Paid Date | Payment Type');
  });

  it('falls back to the .k-grid class when the grid carries no id', () => {
    const input = report();
    input.grids[1]!.id = '';

    expect(suggestionFor(input, 'rowSelector')?.selector).toBe('.k-grid tr.k-master-row');
  });

  it('names the next arrow by its title and reports the evidence', () => {
    const next = suggestionFor(report(), 'nextSelector');

    expect(next?.selector).toBe('#transactions-pager a[title="Go to the next page"]');
    expect(next?.evidence).toContain('Go to the next page');
  });

  it('recommends the openLink shape for an anchor that carries a real href', () => {
    const control = suggestionFor(report(), 'receipt control');

    expect(control?.selector).toBe('a.k-button');
    expect(control?.evidence).toContain('courtreserve-receipts.json');
    expect(control?.evidence).toContain('it opens a new tab');
  });

  it.each([
    { desc: 'a javascript: href', href: 'javascript:void(0)' },
    { desc: 'no href at all', href: null },
  ])('recommends the click/newTab shape for $desc', ({ href }) => {
    const input = report();
    input.rowControls[0]!.href = href;
    input.rowControls[0]!.hasHandler = true;

    const control = suggestionFor(input, 'receipt control');
    expect(control?.evidence).toContain('courtreserve-receipts-newtab.json');
    expect(control?.evidence).toContain('handler');
  });

  it('prefers the control whose text says Receipt over the first control in the row', () => {
    const input = report();
    input.rowControls.unshift({
      gridIndex: 1,
      tag: 'a',
      text: 'Details',
      id: '',
      classes: ['k-link'],
      href: '/details',
      target: null,
      hasHandler: false,
      newTab: false,
    });

    expect(suggestionFor(input, 'receipt control')?.selector).toBe('a.k-button');
  });

  it('says the user is probably logged out when no grid holds a row', () => {
    const input = report({ grids: [], rowControls: [], pagers: [] });

    expect(suggestionFor(input, 'rowSelector')).toMatchObject({
      selector: null,
      evidence: expect.stringContaining('logged in'),
    });
  });

  it('reports a missing next arrow rather than inventing one', () => {
    const input = report({ pagers: [] });

    expect(suggestionFor(input, 'nextSelector')).toMatchObject({ selector: null });
  });
});

describe('formatReport', () => {
  it('prints every section, the row control href, and the suggestions', () => {
    const lines: string[] = [];
    formatReport(report(), (line) => lines.push(line));
    const text = lines.join('\n');

    expect(text).toContain('grids (2)');
    expect(text).toContain('controls in the first data row (1)');
    expect(text).toContain('pagers (1)');
    expect(text).toContain('tab strips (0)');
    expect(text).toContain('date inputs (0)');
    expect(text).toContain('"/Online/Receipt/Index/8DX6T13140"');
    expect(text).toContain('rowSelector: #transactions-grid tr.k-master-row');
  });
});

describe('authForOptions', () => {
  it('builds a cdp auth from the endpoint', () => {
    expect(authForOptions({ url: 'https://x.test', cdpEndpoint: 'http://localhost:9222' })).toEqual({
      mode: 'cdp',
      endpointUrl: 'http://localhost:9222',
    });
  });

  it('defaults the profile mode to the macOS Chrome directory', () => {
    expect(authForOptions({ url: 'https://x.test', useProfile: true })).toEqual({
      mode: 'chromeProfile',
      userDataDir: DEFAULT_CHROME_USER_DATA_DIR,
    });
  });

  it('falls back to no auth, which shows the login page for a private site', () => {
    expect(authForOptions({ url: 'https://x.test' })).toEqual({ mode: 'none' });
  });

  it('refuses both session modes at once', () => {
    expect(() =>
      authForOptions({ url: 'https://x.test', cdpEndpoint: 'http://localhost:9222', useProfile: true }),
    ).toThrow(DiscoverError);
  });
});
