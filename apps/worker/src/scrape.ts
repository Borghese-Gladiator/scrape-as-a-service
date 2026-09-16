import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { ScrapeConfig } from '@scraper/shared';
import { assertSafeUrl } from '@scraper/shared';
import { createAuthSession, type AuthDeps } from './auth.js';
import { runProgram, type RunScrapeOptions, type ScrapeResult } from './interpreter.js';
import { attachDiagnostics, collectConsole, type ConsoleEntry } from './diagnostics.js';

export interface ScrapeSession {
  context: BrowserContext;
  close(): Promise<void>;
  recordDir?: string;
}

export interface OpenSessionDeps {
  secrets?: Record<string, string>;
  allowCdp?: boolean;
  allowLocalProfile?: boolean;
  chromium?: AuthDeps['chromium'];
  saveSecret?: (name: string, value: string) => Promise<void>;
  now?: () => number;
}

/**
 * Build the browser context the configured auth mode asks for, and its
 * temporary recording directory. Both are opened and closed by the caller,
 * not by runScrape, so that a caller that abandons a scrape (a run timeout)
 * can still release them.
 */
export async function openScrapeSession(
  browser: Browser,
  url: string,
  config: ScrapeConfig,
  deps: OpenSessionDeps = {},
): Promise<ScrapeSession> {
  const recordDir =
    config.record === true ? await mkdtemp(join(tmpdir(), 'scrape-rec-')) : undefined;
  const contextOptions = recordDir ? { recordVideo: { dir: recordDir } } : {};

  const authSession = await createAuthSession(config.auth, {
    browser,
    chromium: deps.chromium ?? chromium,
    allowCdp: deps.allowCdp ?? false,
    allowLocalProfile: deps.allowLocalProfile ?? false,
    secrets: deps.secrets ?? {},
    contextOptions,
    runLogin: async (context) => {
      if (config.auth?.mode !== 'login') return;
      await runProgram(
        context,
        url,
        { steps: config.auth.steps },
        {
          secrets: deps.secrets,
          now: deps.now,
        },
      );
    },
    ...(deps.saveSecret ? { saveSecret: deps.saveSecret } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });

  return recordDir
    ? { context: authSession.context, close: authSession.close, recordDir }
    : { context: authSession.context, close: authSession.close };
}

export async function closeScrapeSession(session: ScrapeSession): Promise<void> {
  await session.close().catch(() => {});
  if (session.recordDir) {
    await rm(session.recordDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Run a step program in the browser context that the auth mode asks for. The
 * SSRF guard is on here, because this is the only path the worker takes.
 */
export async function runScrape(
  session: ScrapeSession,
  url: string,
  config: ScrapeConfig,
  options: RunScrapeOptions = {},
): Promise<ScrapeResult> {
  const { context } = session;
  const record = config.record === true;
  const runOptions: RunScrapeOptions = { assertUrl: assertSafeUrl, ...options };
  const consoleByPage: ConsoleEntry[][] = [];
  context.on('page', (page) => consoleByPage.push(collectConsole(page)));

  try {
    const result = await runProgram(context, url, config, runOptions);

    // Closing the session flushes the video file, so read the path only after it.
    const video = record ? (context.pages()[0]?.video() ?? null) : null;
    if (video) {
      await session.close();
      result.artifacts.push({
        type: 'WEBM',
        name: 'recording.webm',
        body: await readFile(await video.path()),
        contentType: 'video/webm',
        stepIndex: 0,
      });
    }
    return result;
  } catch (err) {
    const page = context.pages().at(-1);
    throw await attachDiagnostics(err, page, consoleByPage.flat());
  }
}
