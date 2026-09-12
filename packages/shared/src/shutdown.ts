export const SHUTDOWN_TIMEOUT_MS = 15_000;

export interface ShutdownOptions {
  timeoutMs?: number;
  onSignal?: (signal: NodeJS.Signals) => void;
  exit?: (code: number) => void;
}

/**
 * Run `close` once on the first SIGTERM or SIGINT, then exit 0. A later signal
 * is ignored so a second Ctrl-C cannot start a second teardown. The timer exits
 * anyway when `close` hangs, so a stuck pool or browser cannot hold the process.
 */
export function onShutdown(
  close: () => Promise<void>,
  options: ShutdownOptions = {},
): void {
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let closing = false;

  const handler = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    options.onSignal?.(signal);

    const timer = setTimeout(() => exit(0), timeoutMs);
    timer.unref();

    close()
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('shutdown failed:', err);
      })
      .finally(() => {
        clearTimeout(timer);
        exit(0);
      });
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}
