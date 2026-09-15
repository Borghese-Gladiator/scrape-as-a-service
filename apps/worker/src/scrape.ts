import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext } from 'playwright';
import type { ScrapeConfig } from '@scraper/shared';
import { runProgram, type RunScrapeOptions, type ScrapeResult } from './interpreter.js';
import { attachDiagnostics, collectConsole, type ConsoleEntry } from './diagnostics.js';

export interface ScrapeSession {
  context: BrowserContext;
  recordDir?: string;
}

/**
 * The context and its temporary recording directory are opened and closed by
 * the caller, not by runScrape, so that a caller that abandons a scrape (a run
 * timeout) can still release the context.
 */
export async function openScrapeSession(
  browser: Browser,
  config: ScrapeConfig,
): Promise<ScrapeSession> {
  const recordDir =
    config.record === true ? await mkdtemp(join(tmpdir(), 'scrape-rec-')) : undefined;
  const context = await browser.newContext(
    recordDir ? { recordVideo: { dir: recordDir } } : {},
  );
  return recordDir ? { context, recordDir } : { context };
}

export async function closeScrapeSession(session: ScrapeSession): Promise<void> {
  await session.context.close().catch(() => {});
  if (session.recordDir) {
    await rm(session.recordDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Run a step program in an isolated browser context. Phase 4 replaces
 * `browser.newContext()` here with the three auth modes.
 */
export async function runScrape(
  session: ScrapeSession,
  url: string,
  config: ScrapeConfig,
  options?: RunScrapeOptions,
): Promise<ScrapeResult> {
  const { context } = session;
  const record = config.record === true;
  const consoleByPage: ConsoleEntry[][] = [];
  context.on('page', (page) => consoleByPage.push(collectConsole(page)));

  try {
    const result = await runProgram(context, url, config, options);

    // context.close() flushes the video file, so read the path only after it.
    const video = record ? (context.pages()[0]?.video() ?? null) : null;
    await context.close();
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
  } catch (err) {
    const page = context.pages().at(-1);
    throw await attachDiagnostics(err, page, consoleByPage.flat());
  }
}
