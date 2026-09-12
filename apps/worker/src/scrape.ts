import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import type { ScrapeConfig } from '@scraper/shared';
import { runProgram, type RunScrapeOptions, type ScrapeResult } from './interpreter.js';

/**
 * Run a step program in an isolated browser context. Phase 4 replaces
 * `browser.newContext()` here with the three auth modes.
 */
export async function runScrape(
  browser: Browser,
  url: string,
  config: ScrapeConfig,
  options?: RunScrapeOptions,
): Promise<ScrapeResult> {
  const record = config.record === true;
  const recordDir = record ? await mkdtemp(join(tmpdir(), 'scrape-rec-')) : undefined;
  const context = await browser.newContext(
    recordDir ? { recordVideo: { dir: recordDir } } : {},
  );

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
  } finally {
    await context.close().catch(() => {});
    if (recordDir) await rm(recordDir, { recursive: true, force: true }).catch(() => {});
  }
}
