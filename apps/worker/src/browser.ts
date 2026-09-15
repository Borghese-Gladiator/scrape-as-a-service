import type { Browser } from 'playwright';

export interface BrowserPool {
  get(): Promise<Browser>;
  close(): Promise<void>;
}

/**
 * One Chromium per worker process. A browser launch costs more than the short
 * scrapes this platform runs, so the browser outlives the job and each job
 * takes its own context instead. A browser that disconnected (a crash, an
 * out-of-memory kill) is relaunched on the next call.
 */
export function createBrowserPool(launch: () => Promise<Browser>): BrowserPool {
  let pending: Promise<Browser> | undefined;

  const get = async (): Promise<Browser> => {
    if (pending) {
      try {
        const browser = await pending;
        if (browser.isConnected()) return browser;
      } catch {
        // fall through and launch again
      }
    }
    pending = launch();
    return pending;
  };

  const close = async (): Promise<void> => {
    const current = pending;
    pending = undefined;
    if (!current) return;
    try {
      const browser = await current;
      if (browser.isConnected()) await browser.close();
    } catch {
      // a browser that never launched needs no close
    }
  };

  return { get, close };
}
