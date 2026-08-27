/**
 * auth.ts — CROSS-CUTTING: stateless token authentication
 * ---------------------------------------------------------------------------
 * Token format (dev-simple, HMAC-signed):
 *     base64url(payload).base64url(hmacSha256(payload, SECRET))
 * where payload = JSON {userId, role, exp}.
 *
 * Production upgrade path: swap issue/verify for jsonwebtoken or OAuth2 —
 * handlers only depend on `authenticate()` and `requireRole()`.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/TECH_COMPARISON_STUDY.md §C (stateless HMAC chosen over JWT dep
 *     for dev simplicity; swap seam documented above)
 *   - docs/V2_REQUIREMENTS_ANALYSIS.md §G0.1b (token carries primary role;
 *     full persona union resolved per-request in src/authz.ts)
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role, Session } from './types.js';
import { getUser } from './store.js';
import { resolveAuthSecret } from './security/config.js';

/**
 * Signing secret. SEC-H8: this used to fall back to a literal committed to the
 * repository, so any deployment that forgot to set AUTH_SECRET could have its
 * tokens forged by anyone with the source. resolveAuthSecret() now throws at
 * import time outside development/test, which fails the process start rather
 * than serving traffic with a publicly known key.
 */
const SECRET = resolveAuthSecret();

/** Tokens are valid for 7 days. */
const TTL_MS = 7 * 24 * 3600 * 1000;

/** base64url encode helper (URL-safe alphabet, no padding). */
const b64u = (s: string) => Buffer.from(s).toString('base64url');

/**
 * Issue a signed session token for a user.
 * @returns opaque token string for the Authorization header.
 */
export function issueToken(userId: string, role: Role | 'admin'): string {
  const payload = b64u(JSON.stringify({ userId, role, exp: Date.now() + TTL_MS }));
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * Verify a request's Bearer token and resolve it to a Session.
 * @returns Session or null when absent/tampered/expired.
 */
export function authenticate(request: FastifyRequest): Session | null {
  const header = request.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  // Constant-time signature comparison prevents timing attacks.
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session & { exp: number };
    if (session.exp < Date.now()) return null; // expired
    return { userId: session.userId, role: session.role };
  } catch {
    return null; // malformed payload
  }
}

/**
 * Fastify preHandler guard factory: rejects the request unless the caller is
 * authenticated AND holds one of `roles` (omit to allow any authenticated).
 *
 * Usage:  app.post('/ratings', { preHandler: requireRole('owner','moderator') }, handler)
 */
export function requireRole(...roles: Array<Role | 'admin'>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = authenticate(request);
    if (!session) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    // Re-check against live store so deleted users lose access immediately.
    if (!getUser(session.userId)) {
      await reply.code(401).send({ error: 'Unknown user' });
      return;
    }
    if (roles.length > 0 && !roles.includes(session.role)) {
      await reply.code(403).send({ error: 'Forbidden' });
      return;
    }
    // Expose the resolved session to the handler via request.session.
    (request as any).session = session;
  };
}
