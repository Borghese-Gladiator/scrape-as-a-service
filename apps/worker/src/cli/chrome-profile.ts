import type { PlaywrightChromium } from '../auth.js';

/**
 * Force `auth.mode=chromeProfile` to open a visible window.
 *
 * `launchPersistentContext` defaults to headless, and a bot filter treats a
 * headless Chrome as a robot. CourtReserve sits behind Cloudflare: a headless
 * request to the balance page returns "Attention Required! | Cloudflare",
 * while the same request from a headed browser returns the real page. The
 * profile mode is therefore useless headless.
 *
 * The `cdp` mode needs no wrapper, because it attaches to the window that the
 * user already opened.
 */
export function headedChromium(base: PlaywrightChromium): PlaywrightChromium {
  return {
    connectOverCDP: (endpointUrl) => base.connectOverCDP(endpointUrl),
    launchPersistentContext: (userDataDir, options) =>
      base.launchPersistentContext(userDataDir, { ...options, headless: false }),
  };
}
