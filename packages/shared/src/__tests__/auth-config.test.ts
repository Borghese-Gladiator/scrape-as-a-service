import { describe, it, expect } from 'vitest';
import { collectSecretRefs, validateScrapeConfig, type ScrapeConfig } from '../scrape-config.js';

function withAuth(auth: unknown): unknown {
  return { version: 2, auth, steps: [{ op: 'goto' }] };
}

describe('auth validation', () => {
  it.each([
    { desc: 'none', auth: { mode: 'none' } },
    { desc: 'storageState', auth: { mode: 'storageState', secretRef: 'court_session' } },
    { desc: 'cdp', auth: { mode: 'cdp', endpointUrl: 'http://127.0.0.1:9222' } },
    { desc: 'chromeProfile', auth: { mode: 'chromeProfile', userDataDir: '/u/Chrome' } },
    {
      desc: 'chromeProfile with a named profile',
      auth: { mode: 'chromeProfile', userDataDir: '/u/Chrome', profileDirectory: 'Profile 1' },
    },
    {
      desc: 'login',
      auth: {
        mode: 'login',
        secretRef: 'court_session',
        steps: [{ op: 'fill', selector: '#pw', valueFrom: 'court_pw' }],
      },
    },
  ])('accepts the $desc mode', ({ auth }) => {
    expect(validateScrapeConfig(withAuth(auth)).auth).toEqual(auth);
  });

  it.each([
    { desc: 'an unknown mode', auth: { mode: 'sudo' } },
    { desc: 'storageState with no secretRef', auth: { mode: 'storageState' } },
    { desc: 'cdp with no endpointUrl', auth: { mode: 'cdp' } },
    { desc: 'chromeProfile with no userDataDir', auth: { mode: 'chromeProfile' } },
    { desc: 'login with no steps', auth: { mode: 'login' } },
    { desc: 'login with empty steps', auth: { mode: 'login', steps: [] } },
    {
      desc: 'login with an unknown verb',
      auth: { mode: 'login', steps: [{ op: 'evaluate', code: 'alert(1)' }] },
    },
  ])('rejects $desc', ({ auth }) => {
    expect(() => validateScrapeConfig(withAuth(auth))).toThrow();
  });
});

describe('collectSecretRefs', () => {
  it('returns nothing for a config that needs no secret', () => {
    const config: ScrapeConfig = { version: 2, steps: [{ op: 'goto' }] };
    expect(collectSecretRefs(config)).toEqual([]);
  });

  it.each([
    {
      desc: 'a storageState reference',
      auth: { mode: 'storageState', secretRef: 'court_session' } as const,
      expected: ['court_session'],
    },
    {
      desc: 'a login reference and its nested fills',
      auth: {
        mode: 'login',
        secretRef: 'court_session',
        steps: [
          { op: 'fill', selector: '#user', valueFrom: 'court_user' },
          { op: 'fill', selector: '#pw', valueFrom: 'court_pw' },
        ],
      } as const,
      expected: ['court_session', 'court_user', 'court_pw'],
    },
  ])('finds $desc', ({ auth, expected }) => {
    const config = validateScrapeConfig({ version: 2, auth, steps: [{ op: 'goto' }] });
    expect(collectSecretRefs(config).sort()).toEqual([...expected].sort());
  });

  it('walks every nesting level of the step program', () => {
    const config = validateScrapeConfig({
      version: 2,
      steps: [
        { op: 'fill', selector: '#top', valueFrom: 'top' },
        {
          op: 'paginate',
          nextSelector: 'a.next',
          maxPages: 2,
          steps: [
            {
              op: 'forEach',
              rowSelector: 'tr',
              steps: [
                {
                  op: 'openLink',
                  selector: 'a',
                  steps: [{ op: 'fill', selector: '#deep', valueFrom: 'deep' }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(collectSecretRefs(config).sort()).toEqual(['deep', 'top']);
  });

  it('reports each name once', () => {
    const config = validateScrapeConfig({
      version: 2,
      steps: [
        { op: 'fill', selector: '#a', valueFrom: 'pw' },
        { op: 'fill', selector: '#b', valueFrom: 'pw' },
      ],
    });
    expect(collectSecretRefs(config)).toEqual(['pw']);
  });
});
