import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LIMITS,
  LIMIT_CAPS,
  isV1Config,
  resolveLimits,
  validateScrapeConfig,
  type Step,
} from '../scrape-config.js';

function withSteps(steps: unknown[]): unknown {
  return { version: 2, steps };
}

const VALID_STEPS: Array<{ op: string; step: Step }> = [
  {
    op: 'goto',
    step: { op: 'goto', url: 'https://example.com', waitUntil: 'networkidle' },
  },
  {
    op: 'waitFor',
    step: { op: 'waitFor', selector: '#ready', timeoutMs: 500, state: 'attached' },
  },
  {
    op: 'click',
    step: { op: 'click', selector: 'a.next', opens: 'newTab', optional: true },
  },
  { op: 'fill', step: { op: 'fill', selector: '#from', value: '05/02/2026' } },
  { op: 'select', step: { op: 'select', selector: 'select#page', value: '50' } },
  { op: 'press', step: { op: 'press', key: 'Enter' } },
  { op: 'scroll', step: { op: 'scroll', to: 'element', selector: '#footer' } },
  {
    op: 'extract',
    step: {
      op: 'extract',
      name: 'rows',
      rowSelector: 'table tbody tr',
      fields: [{ name: 'date', selector: 'td:nth-child(1)' }],
      emit: ['JSON', 'CSV'],
    },
  },
  {
    op: 'capture',
    step: { op: 'capture', as: ['PNG', 'PDF'], name: 'r-{{index}}', fullPage: false },
  },
  {
    op: 'forEach',
    step: { op: 'forEach', rowSelector: 'tr', max: 10, steps: [{ op: 'goBack' }] },
  },
  {
    op: 'openLink',
    step: {
      op: 'openLink',
      selector: 'a',
      attribute: 'data-href',
      steps: [{ op: 'goBack' }],
    },
  },
  {
    op: 'paginate',
    step: {
      op: 'paginate',
      nextSelector: 'a.next',
      maxPages: 3,
      steps: [{ op: 'goBack' }],
    },
  },
  { op: 'goBack', step: { op: 'goBack' } },
];

describe('validateScrapeConfig v2 accept', () => {
  it.each(VALID_STEPS)('accepts a valid $op step', ({ step }) => {
    expect(validateScrapeConfig(withSteps([step]))).toEqual({
      version: 2,
      steps: [step],
    });
  });

  it('keeps auth, limits and record', () => {
    const config = validateScrapeConfig({
      version: 2,
      auth: { mode: 'storageState', secretRef: 'courtreserve' },
      steps: [{ op: 'goto' }],
      limits: { maxPages: 5 },
      record: true,
    });
    expect(config.auth).toEqual({ mode: 'storageState', secretRef: 'courtreserve' });
    expect(config.limits).toEqual({ maxPages: 5 });
    expect(config.record).toBe(true);
  });

  it('drops keys that the schema does not define', () => {
    const config = validateScrapeConfig({
      version: 2,
      steps: [{ op: 'goBack', script: 'alert(1)' }],
      onLoad: 'alert(1)',
    });
    expect(config.steps).toEqual([{ op: 'goBack' }]);
    expect(config).not.toHaveProperty('onLoad');
  });
});

describe('validateScrapeConfig v2 reject', () => {
  it.each([
    { desc: 'unknown op', step: { op: 'evaluate', code: 'alert(1)' } },
    { desc: 'goto with a non-string url', step: { op: 'goto', url: 7 } },
    { desc: 'waitFor without a selector', step: { op: 'waitFor' } },
    { desc: 'click without a selector', step: { op: 'click', opens: 'newTab' } },
    {
      desc: 'click with an unknown opens',
      step: { op: 'click', selector: 'a', opens: 'window' },
    },
    {
      desc: 'fill with both value and valueFrom',
      step: { op: 'fill', selector: '#p', value: 'a', valueFrom: 'b' },
    },
    {
      desc: 'fill with neither value nor valueFrom',
      step: { op: 'fill', selector: '#p' },
    },
    { desc: 'select without a value', step: { op: 'select', selector: 'select' } },
    { desc: 'press without a key', step: { op: 'press' } },
    {
      desc: 'scroll to element without a selector',
      step: { op: 'scroll', to: 'element' },
    },
    { desc: 'extract without fields', step: { op: 'extract', name: 'rows', fields: [] } },
    {
      desc: 'extract with a bad emit',
      step: {
        op: 'extract',
        name: 'r',
        fields: [{ name: 'a', selector: 'b' }],
        emit: ['PNG'],
      },
    },
    {
      desc: 'capture with a non-capture type',
      step: { op: 'capture', as: ['WEBM'], name: 'x' },
    },
    { desc: 'capture without a name', step: { op: 'capture', as: ['PNG'] } },
    {
      desc: 'forEach without nested steps',
      step: { op: 'forEach', rowSelector: 'tr', steps: [] },
    },
    {
      desc: 'openLink without nested steps',
      step: { op: 'openLink', selector: 'a', steps: [] },
    },
    {
      desc: 'paginate without maxPages',
      step: { op: 'paginate', nextSelector: 'a', steps: [{ op: 'goBack' }] },
    },
    {
      desc: 'a nested step that is malformed',
      step: { op: 'forEach', rowSelector: 'tr', steps: [{ op: 'nope' }] },
    },
  ])('rejects $desc', ({ step }) => {
    expect(() => validateScrapeConfig(withSteps([step]))).toThrow();
  });

  it.each([
    { desc: 'a non-object', input: 'steps' },
    { desc: 'a wrong version', input: { version: 3, steps: [{ op: 'goBack' }] } },
    { desc: 'an empty step list', input: { version: 2, steps: [] } },
    {
      desc: 'an unknown auth mode',
      input: { version: 2, steps: [{ op: 'goBack' }], auth: { mode: 'oauth' } },
    },
  ])('rejects $desc', ({ input }) => {
    expect(() => validateScrapeConfig(input)).toThrow();
  });
});

describe('limits', () => {
  it.each([
    ['maxDurationMs' as const],
    ['maxSteps' as const],
    ['maxPages' as const],
    ['maxArtifacts' as const],
  ])('clamps %s to its hard cap', (key) => {
    const config = validateScrapeConfig({
      version: 2,
      steps: [{ op: 'goBack' }],
      limits: { [key]: LIMIT_CAPS[key] * 10 },
    });
    expect(config.limits?.[key]).toBe(LIMIT_CAPS[key]);
  });

  it('rejects a non-positive limit', () => {
    expect(() =>
      validateScrapeConfig({
        version: 2,
        steps: [{ op: 'goBack' }],
        limits: { maxPages: 0 },
      }),
    ).toThrow();
  });

  it('fills missing limits from the defaults', () => {
    expect(resolveLimits(undefined)).toEqual(DEFAULT_LIMITS);
    expect(resolveLimits({ maxPages: 3 })).toEqual({ ...DEFAULT_LIMITS, maxPages: 3 });
  });
});

describe('isV1Config', () => {
  it.each([
    {
      desc: 'a config with no version',
      input: { fields: [], artifacts: [] },
      expected: true,
    },
    { desc: 'a v2 config', input: { version: 2, steps: [] }, expected: false },
    { desc: 'a non-object', input: 'x', expected: false },
  ])('returns $expected for $desc', ({ input, expected }) => {
    expect(isV1Config(input)).toBe(expected);
  });
});
