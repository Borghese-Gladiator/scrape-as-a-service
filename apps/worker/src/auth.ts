import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { AuthConfig } from '@scraper/shared';
import { StepError } from './interpreter.js';

export interface PlaywrightChromium {
  connectOverCDP(endpointUrl: string): Promise<Browser>;
  launchPersistentContext(
    userDataDir: string,
    options: Record<string, unknown>,
  ): Promise<BrowserContext>;
}

export interface AuthDeps {
  browser: Browser;
  chromium: PlaywrightChromium;
  allowCdp: boolean;
  allowLocalProfile: boolean;
  secrets: Record<string, string>;
  /** Extra `newContext` options, such as the WEBM recording directory. */
  contextOptions?: Record<string, unknown>;
  /** Replay the declarative login steps against a fresh context. */
  runLogin?: (context: BrowserContext) => Promise<void>;
  /** Write the session back to the named secret so the next run reuses it. */
  saveSecret?: (name: string, value: string) => Promise<void>;
  now?: () => number;
}

export interface AuthSession {
  context: BrowserContext;
  /** Release what this session created, and nothing that it did not. */
  close(): Promise<void>;
}

/**
 * Chrome holds a lock on a live profile, so the profile mode works on a copy.
 * These directories are caches: they are large and the session does not need
 * them.
 */
const PROFILE_SKIP = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Crashpad',
  'component_crx_cache',
  'extensions_crx_cache',
  'Service Worker',
]);

function authFailed(message: string): StepError {
  return new StepError('AUTH_FAILED', message);
}

interface StoredCookie {
  expires?: number;
}

interface StoredState {
  cookies?: StoredCookie[];
}

/**
 * A stored session counts as usable when at least one cookie has an expiry in
 * the future. A session cookie (-1) does not count: it dies with the browser
 * that created it, so it can never be replayed.
 */
export function isStoredStateFresh(raw: string, nowMs: number): boolean {
  let state: StoredState;
  try {
    state = JSON.parse(raw) as StoredState;
  } catch {
    return false;
  }
  const cookies = state.cookies ?? [];
  return cookies.some(
    (cookie) => typeof cookie.expires === 'number' && cookie.expires * 1000 > nowMs,
  );
}

function parseStorageState(raw: string, secretRef: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw authFailed(`secret ${secretRef} is not a Playwright storageState JSON blob`);
  }
}

async function copyChromeProfile(
  userDataDir: string,
  profileDirectory: string,
): Promise<string> {
  const info = await stat(userDataDir).catch(() => null);
  if (!info?.isDirectory()) {
    throw authFailed(`chrome user data directory not found: ${userDataDir}`);
  }
  const source = join(userDataDir, profileDirectory);
  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo?.isDirectory()) {
    throw authFailed(`chrome profile directory not found: ${source}`);
  }

  const target = await mkdtemp(join(tmpdir(), 'scrape-chrome-'));
  const localState = join(userDataDir, 'Local State');
  if (
    await stat(localState).then(
      () => true,
      () => false,
    )
  ) {
    await cp(localState, join(target, 'Local State'));
  }
  await cp(source, join(target, profileDirectory), {
    recursive: true,
    force: true,
    filter: (from) => !PROFILE_SKIP.has(basename(from)),
  });
  return target;
}

async function cdpSession(endpointUrl: string, deps: AuthDeps): Promise<AuthSession> {
  if (!deps.allowCdp) {
    throw authFailed('auth.mode=cdp needs ALLOW_CDP=true');
  }
  const connected = await deps.chromium.connectOverCDP(endpointUrl);
  const existing = connected.contexts()[0];
  const context = existing ?? (await connected.newContext(deps.contextOptions ?? {}));
  const ownsContext = existing === undefined;

  // The user launched this browser, so the session closes only what it opened.
  const preexisting = new Set<Page>(existing ? existing.pages() : []);
  return {
    context,
    async close() {
      if (ownsContext) {
        await context.close().catch(() => {});
        return;
      }
      for (const page of context.pages()) {
        if (!preexisting.has(page)) await page.close().catch(() => {});
      }
    },
  };
}

async function chromeProfileSession(
  auth: Extract<AuthConfig, { mode: 'chromeProfile' }>,
  deps: AuthDeps,
): Promise<AuthSession> {
  if (!deps.allowLocalProfile) {
    throw authFailed('auth.mode=chromeProfile needs ALLOW_LOCAL_PROFILE=true');
  }
  const profileDirectory = auth.profileDirectory ?? 'Default';
  const target = await copyChromeProfile(auth.userDataDir, profileDirectory);

  try {
    const context = await deps.chromium.launchPersistentContext(target, {
      ...(deps.contextOptions ?? {}),
      channel: 'chrome',
      args: [`--profile-directory=${profileDirectory}`],
    });
    return {
      context,
      async close() {
        await context.close().catch(() => {});
        await rm(target, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (err) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function loginSession(
  auth: Extract<AuthConfig, { mode: 'login' }>,
  deps: AuthDeps,
): Promise<AuthSession> {
  const now = deps.now ?? Date.now;
  const stored = auth.secretRef === undefined ? undefined : deps.secrets[auth.secretRef];

  if (stored !== undefined && isStoredStateFresh(stored, now())) {
    const context = await deps.browser.newContext({
      ...(deps.contextOptions ?? {}),
      storageState: parseStorageState(stored, auth.secretRef ?? '') as never,
    });
    return { context, close: () => context.close().catch(() => {}) };
  }

  const context = await deps.browser.newContext(deps.contextOptions ?? {});
  try {
    if (!deps.runLogin) {
      throw authFailed('auth.mode=login needs a login runner');
    }
    await deps.runLogin(context);
    if (auth.secretRef !== undefined && deps.saveSecret) {
      await deps.saveSecret(auth.secretRef, JSON.stringify(await context.storageState()));
    }
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
  return { context, close: () => context.close().catch(() => {}) };
}

/**
 * Build the browser context that the configured auth mode asks for. The caller
 * always releases the session through `close`, which closes only what the mode
 * created.
 */
export async function createAuthSession(
  auth: AuthConfig | undefined,
  deps: AuthDeps,
): Promise<AuthSession> {
  const mode = auth?.mode ?? 'none';

  if (mode === 'cdp') {
    return cdpSession((auth as Extract<AuthConfig, { mode: 'cdp' }>).endpointUrl, deps);
  }
  if (mode === 'chromeProfile') {
    return chromeProfileSession(
      auth as Extract<AuthConfig, { mode: 'chromeProfile' }>,
      deps,
    );
  }
  if (mode === 'login') {
    return loginSession(auth as Extract<AuthConfig, { mode: 'login' }>, deps);
  }

  if (mode === 'storageState') {
    const { secretRef } = auth as Extract<AuthConfig, { mode: 'storageState' }>;
    const raw = deps.secrets[secretRef];
    if (raw === undefined) {
      throw authFailed(`secret is not available: ${secretRef}`);
    }
    const context = await deps.browser.newContext({
      ...(deps.contextOptions ?? {}),
      storageState: parseStorageState(raw, secretRef) as never,
    });
    return { context, close: () => context.close().catch(() => {}) };
  }

  const context = await deps.browser.newContext(deps.contextOptions ?? {});
  return { context, close: () => context.close().catch(() => {}) };
}
