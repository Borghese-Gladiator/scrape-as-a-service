import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScrapeConfig, type Step } from '@scraper/shared';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function load(name: string) {
  return JSON.parse(readFileSync(join(repoRoot, 'definitions', name), 'utf8'));
}

const OPEN_LINK = load('courtreserve-receipts.json');
const NEW_TAB = load('courtreserve-receipts-newtab.json');

/** Walk the whole tree, so a nested step is reachable by op. */
function flatten(steps: Step[]): Step[] {
  return steps.flatMap((step) => {
    if (step.op === 'forEach' || step.op === 'openLink' || step.op === 'paginate') {
      return [step, ...flatten(step.steps)];
    }
    return [step];
  });
}

function stepsOf(file: { config: unknown }): Step[] {
  return validateScrapeConfig(file.config).steps;
}

describe.each([
  { name: 'courtreserve-receipts.json', file: OPEN_LINK },
  { name: 'courtreserve-receipts-newtab.json', file: NEW_TAB },
])('$name', ({ file }) => {
  it('passes the config validator and carries the target URL', () => {
    const config = validateScrapeConfig(file.config);

    expect(config.version).toBe(2);
    expect(file.url).toBe(
      'https://app.courtreserve.com/Online/MyBalance/Index/13140?page=details',
    );
  });

  it('reuses the session rather than logging in', () => {
    expect(validateScrapeConfig(file.config).auth).toEqual({
      mode: 'cdp',
      endpointUrl: 'http://localhost:9222',
    });
  });

  it('clicks the Payments sub-tab before it reads the table', () => {
    const steps = flatten(stepsOf(file));
    const tab = steps.find(
      (step) => step.op === 'click' && /Payments/.test(step.selector),
    );

    expect(tab).toBeDefined();
    // The tab selector is an unverified default, so a miss must not fail the run.
    expect(tab).toMatchObject({ optional: true });
  });

  it('fills both date inputs with the range that the file documents', () => {
    const fills = flatten(stepsOf(file)).filter((step) => step.op === 'fill');

    expect(fills.map((step) => (step as Extract<Step, { op: 'fill' }>).value)).toEqual([
      file._dates.start,
      file._dates.end,
    ]);
    expect(fills).toHaveLength(2);
  });

  it('paginates over rows and extracts the four row fields', () => {
    const steps = flatten(stepsOf(file));
    const paginate = steps.find((step) => step.op === 'paginate');
    const forEach = steps.find((step) => step.op === 'forEach');
    const extract = steps.find((step) => step.op === 'extract');

    expect(paginate).toBeDefined();
    expect(forEach).toBeDefined();
    expect(
      (extract as Extract<Step, { op: 'extract' }>).fields.map((f) => f.name),
    ).toEqual(['date', 'amount', 'paidDate', 'paymentType']);
  });

  it('captures each receipt as PNG and PDF under a templated name', () => {
    const capture = flatten(stepsOf(file)).find(
      (step) => step.op === 'capture',
    ) as Extract<Step, { op: 'capture' }>;

    expect(capture.as).toEqual(['PNG', 'PDF']);
    expect(capture.name).toBe('receipt-{{page}}-{{index}}-{{row.date}}');
  });
});

describe('the two receipt shapes', () => {
  it('differ only in how they reach the receipt page', () => {
    const openLink = flatten(stepsOf(OPEN_LINK));
    const newTab = flatten(stepsOf(NEW_TAB));

    expect(openLink.some((step) => step.op === 'openLink')).toBe(true);
    expect(openLink.some((step) => step.op === 'goBack')).toBe(false);

    expect(newTab.some((step) => step.op === 'openLink')).toBe(false);
    expect(newTab.some((step) => step.op === 'click' && step.opens === 'newTab')).toBe(
      true,
    );
    expect(newTab.some((step) => step.op === 'goBack')).toBe(true);
  });

  it('use the same selectors for the table, the pager and the receipt control', () => {
    const selectorsOf = (steps: Step[]) =>
      flatten(steps)
        .map((step) => ('selector' in step ? step.selector : null))
        .filter((value): value is string => value !== null)
        .filter((value) => !value.includes('Date'));

    expect(new Set(selectorsOf(stepsOf(OPEN_LINK)))).toEqual(
      new Set(selectorsOf(stepsOf(NEW_TAB))),
    );
  });
});
