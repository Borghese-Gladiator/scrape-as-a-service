import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { ScrapeConfig } from '@scraper/shared';
import { assertSafeUrl } from '@scraper/shared';
import { createAuthSession, type AuthDeps } from './auth.js';
import { runProgram, type RunScrapeOptions, type ScrapeResult } from './interpreter.js';

export interface ScrapeDeps {
  allowCdp?: boolean;
  allowLocalProfile?: boolean;
  chromium?: AuthDeps['chromium'];
  saveSecret?: (name: string, value: string) => Promise<void>;
}

/**
 * Run a step program in the browser context that the auth mode asks for. The
 * SSRF guard is on here, because this is the only path the worker takes.
 */
export async function runScrape(
  browser: Browser,
  url: string,
  config: ScrapeConfig,
  options: RunScrapeOptions = {},
  deps: ScrapeDeps = {},
): Promise<ScrapeResult> {
  const record = config.record === true;
  const recordDir = record ? await mkdtemp(join(tmpdir(), 'scrape-rec-')) : undefined;
  const contextOptions = recordDir ? { recordVideo: { dir: recordDir } } : {};
  const runOptions: RunScrapeOptions = { assertUrl: assertSafeUrl, ...options };

  const session = await createAuthSession(config.auth, {
    browser,
    chromium: deps.chromium ?? chromium,
    allowCdp: deps.allowCdp ?? false,
    allowLocalProfile: deps.allowLocalProfile ?? false,
    secrets: runOptions.secrets ?? {},
    contextOptions,
    runLogin: async (context) => {
      if (config.auth?.mode !== 'login') return;
      await runProgram(context, url, { version: 2, steps: config.auth.steps }, runOptions);
    },
    ...(deps.saveSecret ? { saveSecret: deps.saveSecret } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const { context } = session;

  try {
    const result = await runProgram(context, url, config, runOptions);

    // context.close() flushes the video file, so read the path only after it.
    const video = record ? (context.pages()[0]?.video() ?? null) : null;
    await session.close();
    if (video) {
      result.artifacts.push({
        type: 'WEBM',
        name: 'recording.webm',
        body: await readFile(await video.path()),
        contentType: 'video/webm',
        stepIndex: 0,
      });
    }
    return result;
  } finally {
    await session.close().catch(() => {});
    if (recordDir) await rm(recordDir, { recursive: true, force: true }).catch(() => {});
  }
}
