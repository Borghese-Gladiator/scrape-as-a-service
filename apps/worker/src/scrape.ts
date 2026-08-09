import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import type { ScrapeConfig, ScrapeResult } from '@scraper/shared';

function needsRecording(config: ScrapeConfig): boolean {
  return config.artifacts.includes('WEBM');
}

/**
 * Execute a declarative scrape in an isolated browser context. No arbitrary JS
 * is evaluated in the page: extraction is driven purely by CSS selectors and
 * optional attribute reads.
 */
export async function runScrape(
  browser: Browser,
  url: string,
  config: ScrapeConfig,
): Promise<ScrapeResult> {
  const recording = needsRecording(config);
  let recordDir: string | undefined;
  if (recording) {
    recordDir = await mkdtemp(join(tmpdir(), 'scrape-rec-'));
  }

  const context = await browser.newContext(
    recordDir ? { recordVideo: { dir: recordDir } } : {},
  );
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'load' });
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
    await context.close().catch(() => {});
    if (recordDir) await rm(recordDir, { recursive: true, force: true }).catch(() => {});
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
