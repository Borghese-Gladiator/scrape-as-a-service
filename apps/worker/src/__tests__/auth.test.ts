import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AuthConfig } from '@scraper/shared';
import { createAuthSession, isStoredStateFresh, type AuthDeps } from '../auth.js';
import { FakeContext } from './fake-playwright.js';

const NOW = Date.UTC(2026, 8, 12);

function freshState(): string {
  return JSON.stringify({
    cookies: [{ name: 'session', value: 'abc', expires: NOW / 1000 + 3600 }],
    origins: [],
  });
}

function staleState(): string {
  return JSON.stringify({
    cookies: [{ name: 'session', value: 'abc', expires: NOW / 1000 - 3600 }],
    origins: [],
  });
}

interface Harness {
  deps: AuthDeps;
  newContext: ReturnType<typeof vi.fn>;
  connectOverCDP: ReturnType<typeof vi.fn>;
  launchPersistentContext: ReturnType<typeof vi.fn>;
  cdpContexts: FakeContext[];
}

function harness(overrides: Partial<AuthDeps> = {}): Harness {
  const newContext = vi.fn(async () => new FakeContext().asBrowserContext());
  const cdpContexts: FakeContext[] = [];
  const connectOverCDP = vi.fn(async () => ({
    contexts: () => cdpContexts.map((context) => context.asBrowserContext()),
    newContext,
  }));
  const launchPersistentContext = vi.fn(async () => new FakeContext().asBrowserContext());

  const deps: AuthDeps = {
    browser: { newContext } as never,
    chromium: { connectOverCDP, launchPersistentContext } as never,
    allowCdp: false,
    allowLocalProfile: false,
    secrets: {},
    now: () => NOW,
    ...overrides,
  };
  return { deps, newContext, connectOverCDP, launchPersistentContext, cdpContexts };
}

const profileDirs: string[] = [];

async function chromeProfileFixture(profile = 'Default'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fake-chrome-'));
  profileDirs.push(dir);
  await writeFile(join(dir, 'Local State'), '{}');
  await mkdir(join(dir, profile), { recursive: true });
  await writeFile(join(dir, profile, 'Cookies'), 'cookie-db');
  await mkdir(join(dir, profile, 'Cache'), { recursive: true });
  await writeFile(join(dir, profile, 'Cache', 'big-blob'), 'x'.repeat(1000));
  return dir;
}

afterEach(async () => {
  for (const dir of profileDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('mode none', () => {
  it.each([
    { desc: 'no auth at all', auth: undefined },
    { desc: 'an explicit none', auth: { mode: 'none' } as AuthConfig },
  ])('opens a plain context for $desc', async ({ auth }) => {
    const h = harness();
    await createAuthSession(auth, h.deps);
    expect(h.newContext).toHaveBeenCalledWith({});
  });

  it('passes the recording options through', async () => {
    const h = harness({ contextOptions: { recordVideo: { dir: '/tmp/rec' } } });
    await createAuthSession({ mode: 'none' }, h.deps);
    expect(h.newContext).toHaveBeenCalledWith({ recordVideo: { dir: '/tmp/rec' } });
  });
});

describe('mode storageState', () => {
  it('passes the parsed blob to newContext', async () => {
    const h = harness({ secrets: { court_session: freshState() } });
    await createAuthSession({ mode: 'storageState', secretRef: 'court_session' }, h.deps);
    expect(h.newContext).toHaveBeenCalledWith({ storageState: JSON.parse(freshState()) });
  });

  it('throws AUTH_FAILED when the secret is absent', async () => {
    const h = harness();
    await expect(
      createAuthSession({ mode: 'storageState', secretRef: 'court_session' }, h.deps),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('throws AUTH_FAILED when the secret is not JSON', async () => {
    const h = harness({ secrets: { court_session: 'not json' } });
    await expect(
      createAuthSession({ mode: 'storageState', secretRef: 'court_session' }, h.deps),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
});

describe('mode cdp', () => {
  const auth: AuthConfig = { mode: 'cdp', endpointUrl: 'http://127.0.0.1:9222' };

  it('throws AUTH_FAILED when ALLOW_CDP is off', async () => {
    const h = harness();
    await expect(createAuthSession(auth, h.deps)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(h.connectOverCDP).not.toHaveBeenCalled();
  });

  it('connects to the endpoint and reuses the first existing context', async () => {
    const existing = new FakeContext();
    const h = harness({ allowCdp: true });
    h.cdpContexts.push(existing);

    const session = await createAuthSession(auth, h.deps);

    expect(h.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9222');
    expect(h.newContext).not.toHaveBeenCalled();
    expect(session.context).toBe(existing.asBrowserContext());
  });

  it('closes only the pages that the run opened', async () => {
    const existing = new FakeContext();
    const userPage = await existing.newPage();
    const h = harness({ allowCdp: true });
    h.cdpContexts.push(existing);

    const session = await createAuthSession(auth, h.deps);
    const runPage = await existing.newPage();
    await session.close();

    expect(userPage.closed).toBe(false);
    expect(runPage.closed).toBe(true);
  });

  it('opens a context when the browser has none', async () => {
    const h = harness({ allowCdp: true });
    await createAuthSession(auth, h.deps);
    expect(h.newContext).toHaveBeenCalledWith({});
  });
});

describe('mode chromeProfile', () => {
  it('throws AUTH_FAILED when ALLOW_LOCAL_PROFILE is off', async () => {
    const h = harness();
    const auth: AuthConfig = { mode: 'chromeProfile', userDataDir: '/nowhere' };
    await expect(createAuthSession(auth, h.deps)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(h.launchPersistentContext).not.toHaveBeenCalled();
  });

  it.each([
    { desc: 'the default profile', profile: undefined, expected: 'Default' },
    { desc: 'a named profile', profile: 'Profile 1', expected: 'Profile 1' },
  ])('launches a persistent context on a copy of $desc', async ({ profile, expected }) => {
    const userDataDir = await chromeProfileFixture(expected);
    const h = harness({ allowLocalProfile: true });
    const auth = {
      mode: 'chromeProfile' as const,
      userDataDir,
      ...(profile ? { profileDirectory: profile } : {}),
    };

    const session = await createAuthSession(auth, h.deps);

    expect(h.launchPersistentContext).toHaveBeenCalledTimes(1);
    const [copyDir, options] = h.launchPersistentContext.mock.calls[0]!;
    expect(copyDir).not.toBe(userDataDir);
    expect(options).toMatchObject({
      channel: 'chrome',
      args: [`--profile-directory=${expected}`],
    });
    expect(await readdir(copyDir as string)).toContain(expected);
    expect(await readdir(join(copyDir as string, expected))).toEqual(['Cookies']);

    await session.close();
    await expect(readdir(copyDir as string)).rejects.toThrow();
  });

  it('throws AUTH_FAILED when the profile directory is missing', async () => {
    const userDataDir = await chromeProfileFixture('Default');
    const h = harness({ allowLocalProfile: true });
    await expect(
      createAuthSession({ mode: 'chromeProfile', userDataDir, profileDirectory: 'Gone' }, h.deps),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
});

describe('mode login', () => {
  const steps = [{ op: 'fill' as const, selector: '#pw', valueFrom: 'court_pw' }];

  it('reuses a stored session that is still fresh', async () => {
    const runLogin = vi.fn(async () => {});
    const saveSecret = vi.fn(async () => {});
    const h = harness({ secrets: { court_session: freshState() }, runLogin, saveSecret });

    await createAuthSession({ mode: 'login', secretRef: 'court_session', steps }, h.deps);

    expect(runLogin).not.toHaveBeenCalled();
    expect(saveSecret).not.toHaveBeenCalled();
    expect(h.newContext).toHaveBeenCalledWith({ storageState: JSON.parse(freshState()) });
  });

  it.each([
    { desc: 'the stored session expired', secrets: { court_session: staleState() } },
    { desc: 'there is no stored session', secrets: {} },
  ])('replays the login steps when $desc', async ({ secrets }) => {
    const saved = JSON.stringify({ cookies: [{ name: 'new', expires: 1 }] });
    const runLogin = vi.fn(async () => {});
    const saveSecret = vi.fn(async () => {});
    const h = harness({
      secrets,
      runLogin,
      saveSecret,
      browser: {
        newContext: vi.fn(async () => ({
          storageState: async () => JSON.parse(saved),
          pages: () => [],
          close: async () => {},
        })),
      } as never,
    });

    await createAuthSession({ mode: 'login', secretRef: 'court_session', steps }, h.deps);

    expect(runLogin).toHaveBeenCalledTimes(1);
    expect(saveSecret).toHaveBeenCalledWith('court_session', saved);
  });

  it('runs the login steps but saves nothing when no secretRef is set', async () => {
    const runLogin = vi.fn(async () => {});
    const saveSecret = vi.fn(async () => {});
    const h = harness({ runLogin, saveSecret });

    await createAuthSession({ mode: 'login', steps }, h.deps);

    expect(runLogin).toHaveBeenCalledTimes(1);
    expect(saveSecret).not.toHaveBeenCalled();
  });
});

describe('isStoredStateFresh', () => {
  it.each([
    { desc: 'a cookie that expires later', raw: freshState(), fresh: true },
    { desc: 'a cookie that already expired', raw: staleState(), fresh: false },
    { desc: 'a session cookie', raw: JSON.stringify({ cookies: [{ expires: -1 }] }), fresh: false },
    { desc: 'no cookie at all', raw: JSON.stringify({ cookies: [] }), fresh: false },
    { desc: 'a value that is not JSON', raw: 'not json', fresh: false },
  ])('says $desc is fresh=$fresh', ({ raw, fresh }) => {
    expect(isStoredStateFresh(raw, NOW)).toBe(fresh);
  });
});
