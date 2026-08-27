/**
 * routes/googleAuth.ts — "Sign in with Google" for the webapp.
 * ---------------------------------------------------------------------------
 * Flow:
 *   1. Client signs in via Google (Firebase popup) and receives an id_token.
 *   2. POST /auth/google {idToken}
 *   3. Server VALIDATES the token with Google's tokeninfo endpoint
 *      (audience must match GOOGLE_CLIENT_ID), then finds-or-creates the
 *      local user and issues our standard HMAC session token.
 *
 * Production hardening: cache Google's JWKS and verify locally instead of
 * calling tokeninfo per request.
 */

import type { FastifyInstance } from 'fastify';
import type { Role } from '../types.js';
import { issueToken } from '../auth.js';
import { findUserByEmail, insertUser } from '../store.js';

/** Must match the OAuth client used by the web/mobile clients. */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com';

export default async function googleAuthRoutes(app: FastifyInstance) {
  app.post('/auth/google', async (request, reply) => {
    const { idToken } = request.body as { idToken?: string };
    if (!idToken) return reply.code(400).send({ error: 'idToken required' });

    // Ask Google who this token belongs to (validates signature+expiry too).
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) return reply.code(401).send({ error: 'Invalid Google token' });
    const info = (await res.json()) as any;

    // The token MUST have been issued for OUR app.
    if (info.aud !== GOOGLE_CLIENT_ID.replace('.apps.googleusercontent.com', '') &&
        info.aud !== GOOGLE_CLIENT_ID) {
      return reply.code(401).send({ error: 'Token audience mismatch' });
    }
    if (info.email_verified !== 'true' && info.email_verified !== true) {
      return reply.code(401).send({ error: 'Google email not verified' });
    }

    // Find-or-create the local profile. Google users start as workers;
    // an owner promotes them from the admin side.
    let user = findUserByEmail(info.email);
    if (!user) {
      user = insertUser({
        id: `u-google-${Date.now()}`,
        name: info.name ?? info.email,
        email: info.email,
        role: 'worker',
        createdAt: Date.now(),
      });
    }
    return {
      token: issueToken(user.id, user.role as Role),
      user,
    };
  });
}
