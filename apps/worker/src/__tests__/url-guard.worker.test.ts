import { describe, it, expect, vi } from 'vitest';
import type { Step } from '@scraper/shared';
import { runProgram } from '../interpreter.js';
import { FakeContext, textNode, type Route } from './fake-playwright.js';

const LIST_URL = 'https://site.test/list';
const RECEIPT_URL = 'https://site.test/receipt/1';

function site(): FakeContext {
  const receipt: Route = () => ({ nodes: { h1: [textNode('Receipt 1')] } });
  return new FakeContext({
    [RECEIPT_URL]: receipt,
    [LIST_URL]: () => ({
      nodes: { 'a.receipt': [{ text: 'Receipt', attrs: { href: '/receipt/1' } }] },
    }),
  });
}

function run(steps: Step[], assertUrl: (url: string) => Promise<void>) {
  return runProgram(site().asBrowserContext(), LIST_URL, { version: 2, steps }, { assertUrl });
}

describe('the interpreter applies the URL guard', () => {
  it.each([
    { desc: 'goto with no url', steps: [{ op: 'goto' } as Step], expected: [LIST_URL] },
    {
      desc: 'goto with an explicit url',
      steps: [{ op: 'goto', url: RECEIPT_URL } as Step],
      expected: [RECEIPT_URL],
    },
    {
      desc: 'openLink',
      steps: [
        { op: 'goto' } as Step,
        { op: 'openLink', selector: 'a.receipt', steps: [{ op: 'goBack' }] } as Step,
      ],
      expected: [LIST_URL, RECEIPT_URL],
    },
  ])('checks every target of $desc', async ({ steps, expected }) => {
    const assertUrl = vi.fn(async () => {});
    await run(steps, assertUrl);
    expect(assertUrl.mock.calls.map(([url]) => url)).toEqual(expected);
  });

  it.each([
    { desc: 'goto', steps: [{ op: 'goto' } as Step] },
    {
      desc: 'openLink',
      steps: [
        { op: 'goto' } as Step,
        { op: 'openLink', selector: 'a.receipt', steps: [{ op: 'goBack' }] } as Step,
      ],
    },
  ])('stops the run when the guard rejects a $desc target', async ({ steps }) => {
    const assertUrl = vi.fn(async (url: string) => {
      if (url.includes('receipt') || steps.length === 1) throw new Error('URL_NOT_ALLOWED');
    });
    await expect(run(steps, assertUrl)).rejects.toThrow('URL_NOT_ALLOWED');
  });
});
