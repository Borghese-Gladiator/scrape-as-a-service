import { describe, it, expect, vi } from 'vitest';
import { headedChromium } from '../cli/chrome-profile.js';

function fake() {
  return {
    connectOverCDP: vi.fn(async () => ({}) as never),
    launchPersistentContext: vi.fn(async () => ({}) as never),
  };
}

describe('headedChromium', () => {
  it('forces a visible window, because Cloudflare blocks a headless one', async () => {
    const base = fake();
    await headedChromium(base).launchPersistentContext('/tmp/profile', {
      channel: 'chrome',
    });

    expect(base.launchPersistentContext).toHaveBeenCalledWith('/tmp/profile', {
      channel: 'chrome',
      headless: false,
    });
  });

  it('overrides a headless option that the caller asked for', async () => {
    const base = fake();
    await headedChromium(base).launchPersistentContext('/tmp/profile', {
      headless: true,
    });

    expect(base.launchPersistentContext).toHaveBeenCalledWith('/tmp/profile', {
      headless: false,
    });
  });

  it('leaves the cdp path untouched, because it reuses the user window', async () => {
    const base = fake();
    await headedChromium(base).connectOverCDP('http://localhost:9222');

    expect(base.connectOverCDP).toHaveBeenCalledWith('http://localhost:9222');
  });
});
