import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@insurance/partner-sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
