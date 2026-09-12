import { describe, it, expect } from 'vitest';
import { createLogger } from '../logger.js';

describe('createLogger', () => {
  it.each([
    ['debug', 'debug'],
    ['warn', 'warn'],
    ['', 'info'],
    [undefined, 'info'],
  ])('reads LOG_LEVEL=%s as %s', (logLevel, expected) => {
    const env = (logLevel === undefined ? {} : { LOG_LEVEL: logLevel }) as NodeJS.ProcessEnv;
    expect(createLogger('api', env).level).toBe(expected);
  });

  it('binds the name and carries child fields', () => {
    const logger = createLogger('worker', { LOG_LEVEL: 'silent' });
    const child = logger.child({ runId: 'run-1', attemptId: 'att-1', definitionId: 'def-1' });

    expect(child.bindings()).toMatchObject({
      name: 'worker',
      runId: 'run-1',
      attemptId: 'att-1',
      definitionId: 'def-1',
    });
  });
});
