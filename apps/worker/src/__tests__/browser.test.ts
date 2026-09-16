import { describe, it, expect, vi } from 'vitest';
import type { Browser } from 'playwright';
import { createBrowserPool } from '../browser.js';

function fakeBrowser(connected = true) {
  const state = { connected };
  return {
    isConnected: () => state.connected,
    close: vi.fn(async () => {
      state.connected = false;
    }),
    disconnect: () => {
      state.connected = false;
    },
  };
}

describe('createBrowserPool', () => {
  it('launches once and hands the same browser to every caller', async () => {
    const browser = fakeBrowser();
    const launch = vi.fn(async () => browser as unknown as Browser);
    const pool = createBrowserPool(launch);

    const [first, second] = await Promise.all([pool.get(), pool.get()]);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('relaunches after the browser disconnects', async () => {
    const first = fakeBrowser();
    const second = fakeBrowser();
    const launch = vi
      .fn<[], Promise<Browser>>()
      .mockResolvedValueOnce(first as unknown as Browser)
      .mockResolvedValueOnce(second as unknown as Browser);
    const pool = createBrowserPool(launch);

    expect(await pool.get()).toBe(first);
    first.disconnect();

    expect(await pool.get()).toBe(second);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('closes the browser on shutdown and forgets it', async () => {
    const browser = fakeBrowser();
    const launch = vi.fn(async () => browser as unknown as Browser);
    const pool = createBrowserPool(launch);

    await pool.get();
    await pool.close();

    expect(browser.close).toHaveBeenCalledTimes(1);
    await pool.close();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('retries the launch after a failed launch', async () => {
    const browser = fakeBrowser();
    const launch = vi
      .fn<[], Promise<Browser>>()
      .mockRejectedValueOnce(new Error('no chromium'))
      .mockResolvedValueOnce(browser as unknown as Browser);
    const pool = createBrowserPool(launch);

    await expect(pool.get()).rejects.toThrow('no chromium');
    expect(await pool.get()).toBe(browser);
  });
});
