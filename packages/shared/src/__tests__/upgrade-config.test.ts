import { describe, it, expect } from 'vitest';
import {
  upgradeScrapeConfig,
  validateScrapeConfig,
  type ArtifactType,
} from '../scrape-config.js';

const FIELDS = [
  { name: 'title', selector: 'td.title' },
  { name: 'href', selector: 'a', attribute: 'href' },
];

function v1(artifacts: ArtifactType[], extra: Record<string, unknown> = {}): unknown {
  return { fields: FIELDS, artifacts, ...extra };
}

describe('upgradeScrapeConfig', () => {
  it('maps the full v1 shape onto a step program', () => {
    expect(
      upgradeScrapeConfig(
        v1(['JSON', 'CSV', 'PNG', 'HTML'], {
          waitFor: '#ready',
          rowSelector: 'table tr',
        }),
      ),
    ).toEqual({
      version: 2,
      upgradedFrom: 1,
      steps: [
        { op: 'goto' },
        { op: 'waitFor', selector: '#ready' },
        {
          op: 'extract',
          name: 'rows',
          rowSelector: 'table tr',
          fields: FIELDS,
          emit: ['JSON', 'CSV'],
        },
        { op: 'capture', as: ['PNG', 'HTML'], name: 'page' },
      ],
    });
  });

  it('omits the waitFor step and the rowSelector when v1 omits them', () => {
    const config = upgradeScrapeConfig(v1(['JSON']));
    expect(config.steps).toEqual([
      { op: 'goto' },
      { op: 'extract', name: 'rows', fields: FIELDS, emit: ['JSON'] },
    ]);
  });

  it.each([
    {
      type: 'JSON' as const,
      expected: { emit: ['JSON'], captures: [], record: undefined },
    },
    {
      type: 'CSV' as const,
      expected: { emit: ['CSV'], captures: [], record: undefined },
    },
    {
      type: 'PNG' as const,
      expected: { emit: ['JSON'], captures: ['PNG'], record: undefined },
    },
    {
      type: 'HTML' as const,
      expected: { emit: ['JSON'], captures: ['HTML'], record: undefined },
    },
    { type: 'WEBM' as const, expected: { emit: ['JSON'], captures: [], record: true } },
  ])('maps the v1 artifact type $type', ({ type, expected }) => {
    const config = upgradeScrapeConfig(v1([type]));
    const extract = config.steps.find((step) => step.op === 'extract');
    const capture = config.steps.find((step) => step.op === 'capture');
    expect(extract?.op === 'extract' ? extract.emit : undefined).toEqual(expected.emit);
    expect(capture?.op === 'capture' ? capture.as : []).toEqual(expected.captures);
    expect(config.record).toBe(expected.record);
  });

  it('rejects a v2 input', () => {
    expect(() =>
      upgradeScrapeConfig({ version: 2, steps: [{ op: 'goBack' }] }),
    ).toThrow();
  });

  it.each([
    { desc: 'empty fields', input: { fields: [], artifacts: ['JSON'] } },
    { desc: 'an unknown artifact type', input: { fields: FIELDS, artifacts: ['EXE'] } },
    { desc: 'PDF, which v1 never had', input: { fields: FIELDS, artifacts: ['PDF'] } },
    {
      desc: 'a field without a selector',
      input: { fields: [{ name: 'a' }], artifacts: [] },
    },
  ])('rejects $desc', ({ input }) => {
    expect(() => upgradeScrapeConfig(input)).toThrow();
  });
});

describe('validateScrapeConfig backward compatibility', () => {
  it('upgrades a v1 input and always returns v2', () => {
    const config = validateScrapeConfig(v1(['JSON', 'PNG'], { waitFor: '#ready' }));
    expect(config.version).toBe(2);
    expect(config.upgradedFrom).toBe(1);
    expect(config.steps.map((step) => step.op)).toEqual([
      'goto',
      'waitFor',
      'extract',
      'capture',
    ]);
  });

  it('is stable when it runs over its own output', () => {
    const once = validateScrapeConfig(v1(['JSON', 'CSV', 'PNG', 'WEBM']));
    expect(validateScrapeConfig(once)).toEqual(once);
  });
});
