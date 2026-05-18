import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT: 'false'
    },
    globals: true,
    fileParallelism: false,
    testTimeout: 15000
  }
});
