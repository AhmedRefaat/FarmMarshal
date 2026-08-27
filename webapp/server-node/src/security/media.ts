/**
 * security/media.ts — safe resolution and access control for stored media.
 *
 * Addresses:
 *   SEC-H03 / VAL-009 — `/uploads/*` was served by a static plugin with no
 *     authorization, so anyone holding or guessing a URL read evidence photos,
 *     expert qualification documents and chat media.
 *   DEP-01 / VAL-019 — `@fastify/static@8.3.0` carries advisories for path
 *     traversal and for route-guard bypass via non-canonical URL paths. Serving
 *     media from our own handler removes that code from the request path
 *     entirely instead of relying on a guard the advisory says can be bypassed.
 *   VAL-008 — the stored extension was derived from a client-supplied MIME
 *     substring and interpolated into a filesystem path.
 *
 * Wave 0 keeps the public URL shape (`/uploads/<name>`) so nothing silently
 * disappears; what changes is that the request must now carry either a Bearer
 * token or a short-lived, path-bound ticket minted by the server.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { ALLOWED_UPLOAD_TYPES } from './uploads.js';
import { resolveAuthSecret } from './config.js';

/**
 * The only shape `saveMedia()` produces: a UUID plus a canonical extension.
 * Anchored, so no separator, traversal segment, NUL byte or encoded variant
 * can satisfy it.
 */
const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z0-9]{2,5})$/;

/** Extensions the server itself is willing to write, derived from the allow-list. */
export const CANONICAL_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.values(ALLOWED_UPLOAD_TYPES),
);

export function isCanonicalExtension(ext: string): boolean {
  return CANONICAL_EXTENSIONS.has(ext);
}

/**
 * A name is safe only if it matches the generated shape AND carries an
 * extension the upload allow-list actually produces. The shape alone is not
 * enough: `<uuid>.exe` satisfies the pattern but is not something this server
 * ever wrote, so serving it would mean serving an unexpected artifact.
 */
export function isSafeStoredName(name: string): boolean {
  const match = STORED_NAME.exec(name);
  return match !== null && isCanonicalExtension(match[1]);
}

/**
 * Resolve `name` inside `dir` and prove the result did not escape.
 * The containment assertion is deliberately kept even though the name has
 * already been pattern-matched: it is the invariant that actually matters, and
 * it holds on Windows where `\` is also a separator.
 *
 * @returns the absolute path, or null when the name is unsafe or escapes.
 */
export function resolveContainedPath(dir: string, name: string): string | null {
  if (!isSafeStoredName(name)) return null;
  const root = resolve(dir);
  const candidate = resolve(root, name);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

/** Media tickets are deliberately short-lived; they travel in URLs. */
export const MEDIA_TICKET_TTL_MS = 5 * 60 * 1000;

function ticketSignature(name: string, expiresAt: number): string {
  return createHmac('sha256', resolveAuthSecret())
    .update(`${name}:${expiresAt}`)
    .digest('base64url');
}

/**
 * Mint a ticket authorising ONE stored file until `expiresAt`.
 * Bound to the filename, so a ticket for one object cannot fetch another.
 */
export function signMediaTicket(name: string, now = Date.now()): string {
  const expiresAt = now + MEDIA_TICKET_TTL_MS;
  return `${expiresAt}.${ticketSignature(name, expiresAt)}`;
}

/** Verify a ticket against the name being requested. */
export function verifyMediaTicket(name: string, ticket: string, now = Date.now()): boolean {
  const [rawExpiry, signature] = ticket.split('.');
  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (expiresAt < now) return false;
  const expected = ticketSignature(name, expiresAt);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
