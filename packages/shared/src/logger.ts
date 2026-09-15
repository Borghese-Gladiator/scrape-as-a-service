import pino, { type Logger as PinoLogger } from 'pino';
import prettyStream from 'pino-pretty';

export type Logger = PinoLogger;

function resolveLevel(env: NodeJS.ProcessEnv): string {
  const value = env.LOG_LEVEL;
  return value === undefined || value === '' ? 'info' : value;
}

/**
 * Build a named logger. Development output goes through pino-pretty as a
 * destination stream rather than a transport, because a transport starts a
 * worker thread that outlives the test runner.
 */
export function createLogger(name: string, env: NodeJS.ProcessEnv = process.env): Logger {
  const options = { name, level: resolveLevel(env) };
  if (env.NODE_ENV === 'production') {
    return pino(options);
  }
  return pino(
    options,
    prettyStream({
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    }),
  );
}
