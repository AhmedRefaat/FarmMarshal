/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config.
 * /api and /uploads are proxied to the Node trail (:3000) during dev so the
 * SPA can use same-origin relative URLs (no CORS headaches in dev).
 *
 * The `._*` test exclude keeps macOS AppleDouble resource forks out of test
 * collection; esbuild aborts on their binary content with `Unexpected "\x00"`,
 * which made the suite exit non-zero even when every real test passed.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The server registers routes at the root (/auth/login, /tasks, …),
      // so the client's /api namespace has to be stripped before forwarding.
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/uploads': 'http://localhost:3000',
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
    environment: 'node',
  },
});
