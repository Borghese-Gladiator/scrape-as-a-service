import type { Page } from 'playwright';

export interface ConsoleEntry {
  type: string;
  text: string;
}

export interface ScrapeDiagnostics {
  screenshot?: Buffer;
  html?: string;
  console?: unknown[];
}

export interface DiagnosticError extends Error {
  diagnostics?: ScrapeDiagnostics;
}

const MAX_CONSOLE_ENTRIES = 200;

/** Record page console output into a caller-owned array, with a hard cap. */
export function collectConsole(page: Page): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  page.on('console', (message) => {
    if (entries.length >= MAX_CONSOLE_ENTRIES) return;
    entries.push({ type: message.type(), text: message.text() });
  });
  return entries;
}

export function getDiagnostics(error: unknown): ScrapeDiagnostics | undefined {
  if (error instanceof Error) {
    return (error as DiagnosticError).diagnostics;
  }
  return undefined;
}

/**
 * Attach a failure screenshot, the page HTML, and the page console to the
 * error. Every capture is guarded, and so is the whole function: a diagnostics
 * failure must never replace or mask the error the caller is about to rethrow.
 */
export async function attachDiagnostics(
  error: unknown,
  page: Page | undefined,
  consoleEntries: unknown[] = [],
): Promise<unknown> {
  try {
    const diagnostics: ScrapeDiagnostics = { console: consoleEntries };

    if (page) {
      try {
        diagnostics.screenshot = await page.screenshot({ fullPage: true });
      } catch {
        // the page may already be gone; the console entries still help
      }
      try {
        diagnostics.html = await page.content();
      } catch {
        // same
      }
    }

    if (error instanceof Error) {
      (error as DiagnosticError).diagnostics = diagnostics;
    }
  } catch {
    // never let diagnostics capture change the outcome
  }
  return error;
}
