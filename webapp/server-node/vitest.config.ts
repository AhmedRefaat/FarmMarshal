/**
 * vitest.config.ts — server-node test configuration.
 *
 * WHY THE `._*` EXCLUDE EXISTS
 * ----------------------------
 * The working tree was populated from macOS and contains AppleDouble resource
 * forks (`._routes.test.ts`, `._api.test.ts`, …). Vitest's default glob matched
 * them as test files and esbuild aborted with `Unexpected "\x00"` on their
 * binary content, so the suite exited non-zero even though every real test
 * passed. Excluding them is what makes a CI gate possible at all; deleting the
 * ~83k stray files is tracked separately as a deliberate, reviewable cleanup.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
    environment: 'node',
    // src/index.ts calls app.listen() at import time unless NO_LISTEN=1. The
    // test files set it in beforeAll, which runs AFTER the import and therefore
    // never took effect — the suite bound port 3000 for real and failed with
    // EADDRINUSE whenever a dev server or a second run was live. Setting it here
    // guarantees it is present before any module is evaluated.
    env: { NO_LISTEN: '1', NODE_ENV: 'test' },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types.ts'],
      // Security-critical modules are held to a higher bar than the codebase
      // average; the global numbers are raised wave by wave as coverage lands.
      thresholds: {
        statements: 60,
        lines: 60,
        functions: 60,
        branches: 60,
        'src/security/**': {
          statements: 90,
          lines: 90,
          functions: 90,
          branches: 85,
        },
      },
    },
  },
});
