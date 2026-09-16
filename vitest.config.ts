import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,apps}/**/src/**/__tests__/**/*.test.ts'],
    env: { LOG_LEVEL: 'silent' },
  },
});
