/// <reference types="vitest" />

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration for the FarmMarshal web client.
 *
 * Local development:
 *   base = "/"
 *
 * GitHub Pages:
 *   base = "/FarmMarshal/"
 *
 * The explicit VITE_BASE environment variable takes precedence.
 */
function resolveBasePath(): string {
  if (process.env.VITE_BASE) {
    return process.env.VITE_BASE;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

  if (!isGitHubActions || !repository) {
    return '/';
  }

  const repositoryName = repository.split('/')[1];

  // A repository named "<account>.github.io" is published at the domain root.
  if (repositoryName.endsWith('.github.io')) {
    return '/';
  }

  return `/${repositoryName}/`;
}

export default defineConfig({
  plugins: [react()],

  base: resolveBasePath(),

  server: {
    proxy: {
      /**
       * The Node server registers routes at the root:
       * /auth/login, /tasks, etc.
       *
       * The browser uses /api during local development, so the proxy removes
       * the /api prefix before forwarding the request.
       */
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },

      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
    environment: 'node',
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});