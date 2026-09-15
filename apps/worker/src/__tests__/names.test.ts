import { describe, it, expect } from 'vitest';
import {
  resolveNameTemplate,
  sanitizeArtifactName,
  uniqueArtifactName,
} from '../names.js';

const BINDINGS = {
  index: 3,
  page: 2,
  row: { receipt: '8DX6T13140', paid: null },
};

describe('resolveNameTemplate', () => {
  it.each([
    { template: 'receipt-{{index}}', expected: 'receipt-3' },
    { template: 'p{{page}}-r{{index}}', expected: 'p2-r3' },
    { template: '{{row.receipt}}', expected: '8DX6T13140' },
    { template: '{{ row.receipt }}', expected: '8DX6T13140' },
    { template: '{{row.paid}}', expected: '' },
    { template: '{{row.missing}}', expected: '' },
    { template: '{{unknown}}', expected: '' },
    { template: 'plain', expected: 'plain' },
  ])('resolves $template', ({ template, expected }) => {
    expect(resolveNameTemplate(template, BINDINGS)).toBe(expected);
  });

  it('leaves an unbound variable empty', () => {
    expect(resolveNameTemplate('r-{{index}}-p{{page}}', {})).toBe('r--p');
  });

  it('never evaluates an expression', () => {
    expect(resolveNameTemplate('{{1+1}}', BINDINGS)).toBe('{{1+1}}');
  });
});

describe('sanitizeArtifactName', () => {
  it.each([
    { desc: 'lowercases', input: 'Receipt-A', expected: 'receipt-a' },
    { desc: 'replaces a slash', input: 'a/b', expected: 'a-b' },
    { desc: 'replaces a backslash', input: 'a\\b', expected: 'a-b' },
    { desc: 'strips unicode', input: 'reçu—2', expected: 're-u-2' },
    { desc: 'collapses dash runs', input: 'a   b', expected: 'a-b' },
    { desc: 'collapses dot runs', input: 'a..b', expected: 'a.b' },
    { desc: 'removes a traversal', input: '../../etc/passwd', expected: 'etc-passwd' },
    { desc: 'removes a leading slash', input: '/abs/path', expected: 'abs-path' },
    { desc: 'falls back for an empty name', input: '', expected: 'capture' },
    { desc: 'falls back for a name of separators', input: '---', expected: 'capture' },
    { desc: 'falls back for dots only', input: '..', expected: 'capture' },
    { desc: 'keeps allowed characters', input: 'a_b-c.d1', expected: 'a_b-c.d1' },
  ])('$desc', ({ input, expected }) => {
    expect(sanitizeArtifactName(input)).toBe(expected);
  });

  it('truncates to 120 characters', () => {
    const name = sanitizeArtifactName('a'.repeat(400));
    expect(name).toHaveLength(120);
  });

  it('leaves no trailing separator after it truncates', () => {
    const name = sanitizeArtifactName(`${'a'.repeat(119)}-b`);
    expect(name.endsWith('-')).toBe(false);
    expect(name).toHaveLength(119);
  });
});

describe('uniqueArtifactName', () => {
  it('suffixes a repeated name', () => {
    const used = new Map<string, number>();
    expect(uniqueArtifactName('receipt', '.png', used)).toBe('receipt.png');
    expect(uniqueArtifactName('receipt', '.png', used)).toBe('receipt-2.png');
    expect(uniqueArtifactName('receipt', '.png', used)).toBe('receipt-3.png');
  });

  it('keeps each extension separate', () => {
    const used = new Map<string, number>();
    expect(uniqueArtifactName('receipt', '.png', used)).toBe('receipt.png');
    expect(uniqueArtifactName('receipt', '.pdf', used)).toBe('receipt.pdf');
  });

  it('does not collide with a name that a user already claimed', () => {
    const used = new Map<string, number>();
    expect(uniqueArtifactName('receipt-2', '.png', used)).toBe('receipt-2.png');
    expect(uniqueArtifactName('receipt', '.png', used)).toBe('receipt.png');
    expect(uniqueArtifactName('receipt', '.png', used)).toBe('receipt-3.png');
  });
});
