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
      // Non-enumerable: a log serializer walks the enumerable properties of an
      // error, so a plain assignment prints the whole screenshot buffer byte by
      // byte on every failure.
      Object.defineProperty(error, 'diagnostics', {
        value: diagnostics,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // never let diagnostics capture change the outcome
  }
  return error;
}
