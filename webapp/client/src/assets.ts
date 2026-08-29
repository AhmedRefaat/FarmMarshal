/**
 * assets.ts — resolve a file from public/ against the deploy sub-path.
 * ---------------------------------------------------------------------------
 * A bare '/images/x.jpg' only works when the app is served from the domain
 * root. GitHub Pages puts a project site under '/<repo>/', and Vite does NOT
 * rewrite absolute public paths for you — only `import.meta.env.BASE_URL`
 * knows where the bundle actually lives.
 */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
