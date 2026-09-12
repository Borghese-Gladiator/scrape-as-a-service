import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext } from 'playwright';
import { ScrapeError, type ScrapeConfig, type ScrapeResult } from '@scraper/shared';

function needsRecording(config: ScrapeConfig): boolean {
  return config.artifacts.includes('WEBM');
}

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
  const recordDir = needsRecording(config)
    ? await mkdtemp(join(tmpdir(), 'scrape-rec-'))
    : undefined;
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
 * Execute a declarative scrape in an isolated browser context. No arbitrary JS
 * is evaluated in the page: extraction is driven purely by CSS selectors and
 * optional attribute reads.
 */
export async function runScrape(
  session: ScrapeSession,
  url: string,
  config: ScrapeConfig,
): Promise<ScrapeResult> {
  const recording = needsRecording(config);
  const { context } = session;
  const page = await context.newPage();

  try {
    try {
      await page.goto(url, { waitUntil: 'load' });
    } catch (err) {
      throw new ScrapeError('NAVIGATION_FAILED', `navigation to ${url} failed`, {
        cause: err,
      });
    }
    if (config.waitFor) {
      await page.waitForSelector(config.waitFor);
    }

    const rows = await extractRows(page, config);

    const result: ScrapeResult = { rows };

    if (config.artifacts.includes('HTML')) {
      result.html = await page.content();
    }
    if (config.artifacts.includes('PNG')) {
      result.screenshot = await page.screenshot({ fullPage: true });
    }

    const video = recording ? page.video() : null;
    await page.close();
    await context.close();

    if (video) {
      const videoPath = await video.path();
      result.recording = await readFile(videoPath);
    }

    return result;
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
}

async function extractRows(
  page: import('playwright').Page,
  config: ScrapeConfig,
): Promise<Record<string, string | null>[]> {
  const readField = async (
    scope: import('playwright').Locator,
    selector: string,
    attribute?: string,
  ): Promise<string | null> => {
    const el = scope.locator(selector).first();
    if ((await el.count()) === 0) return null;
    if (attribute) {
      return el.getAttribute(attribute);
    }
    return (await el.textContent())?.trim() ?? null;
  };

  if (config.rowSelector) {
    const rowLocators = page.locator(config.rowSelector);
    const count = await rowLocators.count();
    const rows: Record<string, string | null>[] = [];
    for (let i = 0; i < count; i += 1) {
      const rowScope = rowLocators.nth(i);
      const row: Record<string, string | null> = {};
      for (const field of config.fields) {
        row[field.name] = await readField(rowScope, field.selector, field.attribute);
      }
      rows.push(row);
    }
    return rows;
  }

  const row: Record<string, string | null> = {};
  for (const field of config.fields) {
    row[field.name] = await readField(page.locator('body'), field.selector, field.attribute);
  }
  return [row];
}
