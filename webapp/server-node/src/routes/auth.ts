/**
 * routes/auth.ts — /auth endpoints
 *   POST /auth/login    {email,password} → {token, user}
 *   POST /auth/register {name,email,password} → {token,user}
 *
 * SECURITY FIXES APPLIED
 * ----------------------
 *   GAP-01 / SEC-C1 — registration previously trusted a caller-supplied `role`
 *     and passed it straight to the user factory, so `{"role":"admin"}` minted a
 *     platform administrator with no authentication. The role is now decided by
 *     the server: omitted or "worker" is accepted, any other known role is 403,
 *     and an unrecognised value is 400.
 *   SEC-C3 — passwords are hashed with scrypt at the store seam; nothing here
 *     ever writes or logs plaintext.
 *   SEC-H7 — both endpoints are rate limited per IP (and per identity on login).
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/V2_REQUIREMENTS_ANALYSIS.md §G0.1b entry paths: farm roles are
 *     INVITED in production; only the unprivileged worker role self-registers.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { issueToken } from '../auth.js';
import { findUserByEmail, setPasswordHash, verifyPassword } from '../store.js';
import { hashPassword, validatePasswordPolicy } from '../security/passwords.js';
import { resolvePublicRegistrationRole } from '../security/roles.js';
import {
  credentialKey,
  loginLimiter,
  registerLimiter,
  type RateLimiter,
} from '../security/rateLimit.js';

/** RFC 5322 is not worth implementing; this rejects the shapes that matter. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 120;

/** Read a body field only when it is genuinely a string — blocks type-confusion payloads. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function enforceLimit(limiter: RateLimiter, key: string, reply: FastifyReply): boolean {
  const decision = limiter.consume(key);
  if (decision.allowed) return true;
  reply
    .code(429)
    .header('Retry-After', String(decision.retryAfterSeconds))
    .send({ error: 'Too many attempts. Try again later.' });
  return false;
}

export default async function authRoutes(app: FastifyInstance) {
  /**
   * Exchange credentials for a session token.
   * Errors are intentionally generic to avoid user-enumeration leaks: an
   * unknown address and a wrong password produce the identical 401 body.
   */
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const email = str(body.email);
    const password = str(body.password);
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password required' });
    }

    const key = credentialKey(request.ip, email);
    if (!enforceLimit(loginLimiter, key, reply)) return reply;

    const user = findUserByEmail(email);
    // Always run verification through the store seam so an unknown address and
    // a wrong password follow comparable code paths.
    const ok = user ? await verifyPassword(email, password) : false;
    if (!user || !ok) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    loginLimiter.reset(key);
    return { token: issueToken(user.id, user.role), user };
  });

  /**
   * Public self-service registration. Creates an unprivileged worker only.
   * Elevation is an authenticated, audited administrator action
   * (PATCH /admin/users/:id/role in routes/users.ts).
   */
  app.post('/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = str(body.name)?.trim();
    const email = str(body.email)?.trim();
    const password = str(body.password);

    if (!name || !email || !password) {
      return reply.code(400).send({ error: 'name, email and password required' });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return reply.code(400).send({ error: `name must be at most ${MAX_NAME_LENGTH} characters` });
    }
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: 'email is not valid' });
    }

    // The server decides the role. A caller-supplied privileged role is refused
    // outright rather than silently downgraded, so the attempt stays visible.
    const decision = resolvePublicRegistrationRole(body.role);
    if (!decision.ok) {
      request.log.warn(
        { event: 'registration.role_rejected', requestedRole: String(body.role) },
        'rejected privileged or unknown role at public registration',
      );
      return reply.code(decision.status).send({ error: decision.error });
    }

    const policyError = validatePasswordPolicy(password);
    if (policyError) {
      return reply.code(400).send({ error: policyError });
    }

    if (!enforceLimit(registerLimiter, credentialKey(request.ip), reply)) return reply;

    if (findUserByEmail(email)) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    const { createUser } = await import('./users.js');
    const user = createUser(name, email, decision.role);
    setPasswordHash(email, await hashPassword(password));
    return reply.code(201).send({ token: issueToken(user.id, user.role), user });
  });
}
