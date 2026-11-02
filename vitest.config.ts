import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup/isolate-home.ts'], globalSetup: ['tests/setup/live-build.ts'], testTimeout: 20000, hookTimeout: 60000 },
});
