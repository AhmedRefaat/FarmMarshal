/**
 * security.test.ts — regression net for the Wave 0 security fixes.
 * ---------------------------------------------------------------------------
 * Every test here pins a specific finding from specs/Audit.md. If one of these
 * fails, a previously-fixed vulnerability has been reintroduced.
 *
 *   GAP-01 / SEC-C1  privilege escalation via public registration
 *   GAP-02 / SEC-C2  unauthenticated video creation
 *   SEC-C3           plaintext password storage
 *   SEC-C4           broken object-level authorization (BOLA/IDOR) on tasks
 *   SEC-H5/H8        CORS + signing-secret configuration fail-fast
 *   SEC-H6           upload content validation
 *   SEC-H7           credential brute-force throttling
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { listAudit } from '../src/store.js';
import { loginLimiter, registerLimiter } from '../src/security/rateLimit.js';
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from '../src/security/passwords.js';
import {
  INSECURE_LEGACY_SECRET,
  SecurityConfigError,
  resolveAuthSecret,
  resolveCorsOrigins,
} from '../src/security/config.js';
import {
  sanitizeFilename,
  validateUpload,
} from '../src/security/uploads.js';
import { resolvePublicRegistrationRole } from '../src/security/roles.js';

let app: Awaited<ReturnType<typeof buildApp>>;

/** Unique address per registration so tests never collide on the 409 path. */
let seq = 0;
const freshEmail = () => `reg-${Date.now()}-${seq++}@example.com`;
const GOOD_PASSWORD = 'Str0ngPassphrase';

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().token;
}

beforeAll(async () => {
  process.env.NO_LISTEN = '1';
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

// Limiters are process-wide singletons; clear them so one test's attempts do
// not throttle the next. The dedicated throttling test opts out of this.
beforeEach(() => {
  loginLimiter.clear();
  registerLimiter.clear();
});

// ===========================================================================
describe('GAP-01 / SEC-C1 — public registration cannot escalate privilege', () => {
  it('defaults to the worker role when none is supplied', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'No Role', email: freshEmail(), password: GOOD_PASSWORD },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe('worker');
  });

  it('accepts an explicit worker role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Worker', email: freshEmail(), password: GOOD_PASSWORD, role: 'worker' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe('worker');
  });

  // The original defect: {"role":"admin"} minted a platform administrator.
  it.each(['admin', 'owner', 'moderator'])('refuses the privileged role %s with 403', async (role) => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Escalator', email: freshEmail(), password: GOOD_PASSWORD, role },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().user).toBeUndefined();
  });

  it('rejects an unknown role with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Unknown', email: freshEmail(), password: GOOD_PASSWORD, role: 'superuser' },
    });
    expect(res.statusCode).toBe(400);
  });

  // Type-confusion payloads must not slip past a string comparison.
  it.each([[{ role: 'admin' }], [['admin']], [42], [true], [null]])(
    'rejects a non-string role payload %j',
    async (role) => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { name: 'Manipulated', email: freshEmail(), password: GOOD_PASSWORD, role },
      });
      // null is treated as "omitted" and yields the safe default; every other
      // shape is rejected outright. Neither may produce a privileged account.
      if (role === null) {
        expect(res.statusCode).toBe(201);
        expect(res.json().user.role).toBe('worker');
      } else {
        expect(res.statusCode).toBe(400);
      }
    },
  );

  it('rejects missing required fields with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: freshEmail(), password: GOOD_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed email with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bad Email', email: 'not-an-email', password: GOOD_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a duplicate identity with 409', async () => {
    const email = freshEmail();
    const first = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'First', email, password: GOOD_PASSWORD },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'Second', email, password: GOOD_PASSWORD },
    });
    expect(second.statusCode).toBe(409);
  });

  it('does not encode the role in the generated user id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'Id Shape', email: freshEmail(), password: GOOD_PASSWORD },
    });
    expect(res.json().user.id).not.toContain('worker');
  });

  it('classifies roles correctly at the unit level', () => {
    expect(resolvePublicRegistrationRole(undefined)).toEqual({ ok: true, role: 'worker' });
    expect(resolvePublicRegistrationRole('worker')).toEqual({ ok: true, role: 'worker' });
    expect(resolvePublicRegistrationRole('admin')).toMatchObject({ ok: false, status: 403 });
    expect(resolvePublicRegistrationRole('nope')).toMatchObject({ ok: false, status: 400 });
  });
});

describe('GAP-01 — role elevation is admin-only and audited', () => {
  it('refuses elevation attempted by a non-admin', async () => {
    const email = freshEmail();
    const reg = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'Self Promoter', email, password: GOOD_PASSWORD },
    });
    const { token, user } = reg.json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}/role`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows an admin to elevate and writes an audit record', async () => {
    const email = freshEmail();
    const reg = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'Promotable', email, password: GOOD_PASSWORD },
    });
    const target = reg.json().user;
    const adminToken = await login('admin@agri.com', 'admin123');

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'moderator' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('moderator');

    const entry = listAudit().find(
      (a) => a.action === 'user.role.changed' && a.targetId === target.id,
    );
    expect(entry).toBeDefined();
    expect(entry!.detail).toMatchObject({ from: 'worker', to: 'moderator' });
  });

  it('rejects an unknown role even from an admin', async () => {
    const adminToken = await login('admin@agri.com', 'admin123');
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/u-worker/role',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'root' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown target user', async () => {
    const adminToken = await login('admin@agri.com', 'admin123');
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/u-does-not-exist/role',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'worker' },
    });
    expect(res.statusCode).toBe(404);
  });

  // Tokens embed the role at issue time; requireRole re-reads the live user,
  // so a demotion must take effect immediately on an already-issued token.
  it('honours a demotion on a token issued before the change', async () => {
    const email = freshEmail();
    const reg = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'Demote Me', email, password: GOOD_PASSWORD },
    });
    const { token, user } = reg.json();
    const adminToken = await login('admin@agri.com', 'admin123');

    await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}/role`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'moderator' },
    });
    // The stale worker token must not be able to act as a moderator.
    const create = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'x', workerId: 'u-worker', lat: 30, lng: 31 },
    });
    expect([401, 403]).toContain(create.statusCode);
  });
});

// ===========================================================================
describe('SEC-C3 — passwords are hashed, never stored in plaintext', () => {
  it('produces a salted, self-describing scrypt hash', async () => {
    const hash = await hashPassword(GOOD_PASSWORD);
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain(GOOD_PASSWORD);
    expect(await verifyPassword(GOOD_PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('uses a distinct salt per hash', async () => {
    const [a, b] = await Promise.all([hashPassword(GOOD_PASSWORD), hashPassword(GOOD_PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it.each([
    '',
    'plaintext',
    'scrypt$notanumber$8$1$c2FsdA==$aGFzaA==',
    'scrypt$32768$8$1$$',
    'scrypt$99999999$8$1$c2FsdA==$aGFzaA==',
  ])('returns false for the malformed stored value %j instead of throwing', async (stored) => {
    await expect(verifyPassword(GOOD_PASSWORD, stored)).resolves.toBe(false);
  });

  it('enforces a minimum password policy at registration', async () => {
    expect(validatePasswordPolicy('short1')).toBeTruthy();
    expect(validatePasswordPolicy('alllettersonly')).toBeTruthy();
    expect(validatePasswordPolicy(GOOD_PASSWORD)).toBeNull();

    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'Weak', email: freshEmail(), password: 'abc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lets a newly registered user log in with the hashed credential', async () => {
    const email = freshEmail();
    await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'Round Trip', email, password: GOOD_PASSWORD },
    });
    const token = await login(email, GOOD_PASSWORD);
    expect(token).toBeTruthy();
  });

  it('returns an identical 401 body for an unknown user and a wrong password', async () => {
    const unknown = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'nobody@example.com', password: GOOD_PASSWORD },
    });
    const wrong = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'worker@agri.com', password: 'definitely-wrong' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.body).toBe(wrong.body);
  });
});

// ===========================================================================
describe('SEC-C4 — object-level authorization on tasks', () => {
  /** A registered user who belongs to no farm must see no tenant data at all. */
  async function outsiderToken(): Promise<string> {
    const email = freshEmail();
    const reg = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'Outsider', email, password: GOOD_PASSWORD },
    });
    return reg.json().token;
  }

  it('returns an empty list to a user with no farm membership', async () => {
    const token = await outsiderToken();
    const res = await app.inject({
      method: 'GET', url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('hides an individual task from a non-member (404, not 403, to avoid probing)', async () => {
    const token = await outsiderToken();
    const res = await app.inject({
      method: 'GET', url: '/tasks/t-1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('blocks a non-member from driving another farm task through its state machine', async () => {
    const token = await outsiderToken();
    const res = await app.inject({
      method: 'PATCH', url: '/tasks/t-2/status',
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'start' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('blocks a non-member from attaching evidence to another farm task', async () => {
    const token = await outsiderToken();
    const res = await app.inject({
      method: 'POST', url: '/tasks/t-2/photos?kind=before',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect([404, 400]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(200);
  });

  it('stamps a server-derived farmId on newly created tasks', async () => {
    const mod = await login('moderator@agri.com', 'pass123');
    const res = await app.inject({
      method: 'POST', url: '/tasks',
      headers: { authorization: `Bearer ${mod}` },
      payload: { title: 'Scoped task', workerId: 'u-worker', lat: 30.05, lng: 31.23 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().farmId).toBe('f-1');
  });

  it('refuses to place a task in a farm the creator does not belong to', async () => {
    const mod = await login('moderator@agri.com', 'pass123');
    const res = await app.inject({
      method: 'POST', url: '/tasks',
      headers: { authorization: `Bearer ${mod}` },
      payload: { title: 'Cross tenant', workerId: 'u-worker', lat: 30, lng: 31, farmId: 'f-other' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to assign a worker who is not a member of the farm', async () => {
    const mod = await login('moderator@agri.com', 'pass123');
    const res = await app.inject({
      method: 'POST', url: '/tasks',
      headers: { authorization: `Bearer ${mod}` },
      payload: { title: 'Foreign worker', workerId: 'u-admin', lat: 30, lng: 31 },
    });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    { lat: 999, lng: 31 },
    { lat: 30, lng: 999 },
    { lat: 'x', lng: 31 },
  ])('rejects out-of-range or non-numeric coordinates %j', async (coords) => {
    const mod = await login('moderator@agri.com', 'pass123');
    const res = await app.inject({
      method: 'POST', url: '/tasks',
      headers: { authorization: `Bearer ${mod}` },
      payload: { title: 'Bad geo', workerId: 'u-worker', ...coords },
    });
    expect(res.statusCode).toBe(400);
  });

  it('does not expose other users’ emails to an unprivileged caller', async () => {
    const wrk = await login('worker@agri.com', 'pass123');
    const res = await app.inject({
      method: 'GET', url: '/users',
      headers: { authorization: `Bearer ${wrk}` },
    });
    expect(res.statusCode).toBe(200);
    for (const u of res.json()) expect(u.email).toBeUndefined();
  });

  it('still exposes emails to a privileged caller', async () => {
    const owner = await login('owner@agri.com', 'pass123');
    const res = await app.inject({
      method: 'GET', url: '/users',
      headers: { authorization: `Bearer ${owner}` },
    });
    expect(res.json().some((u: { email?: string }) => !!u.email)).toBe(true);
  });
});

// ===========================================================================
describe('GAP-02 / SEC-C2 — video creation requires authentication', () => {
  it('rejects an unauthenticated POST /v2/videos with 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v2/videos',
      payload: { farmId: 'f-1', areaTag: 'north' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.statusCode).not.toBe(201);
  });

  it('rejects a caller who is not a member of the target farm', async () => {
    const email = freshEmail();
    const reg = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'Video Outsider', email, password: GOOD_PASSWORD },
    });
    const res = await app.inject({
      method: 'POST', url: '/v2/videos',
      headers: { authorization: `Bearer ${reg.json().token}` },
      payload: { farmId: 'f-1' },
    });
    expect([401, 402, 403]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(201);
  });

  it('never attributes an upload to a client-supplied identity', async () => {
    const owner = await login('owner@agri.com', 'pass123');
    const res = await app.inject({
      method: 'POST', url: '/v2/videos',
      headers: { authorization: `Bearer ${owner}` },
      payload: { farmId: 'f-1', uploadedBy: 'u-someone-else', sourceDeviceId: 'dev-x' },
    });
    if (res.statusCode === 201) {
      expect(res.json().uploadedBy).toBe('u-owner');
    } else {
      // A plan without the video_platform entitlement returns 402; either way
      // the unauthenticated 201 path is gone.
      expect(res.statusCode).toBe(402);
    }
  });
});

// ===========================================================================
describe('SEC-H7 — credential endpoints are throttled', () => {
  it('returns 429 with Retry-After after repeated failed logins', async () => {
    loginLimiter.clear();
    let last = 0;
    for (let i = 0; i < 15; i += 1) {
      const res = await app.inject({
        method: 'POST', url: '/auth/login',
        payload: { email: 'worker@agri.com', password: `wrong-${i}` },
      });
      last = res.statusCode;
      if (last === 429) {
        expect(res.headers['retry-after']).toBeDefined();
        break;
      }
    }
    expect(last).toBe(429);
    loginLimiter.clear();
  });

  it('clears the counter after a successful login', async () => {
    loginLimiter.clear();
    await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'worker@agri.com', password: 'wrong' },
    });
    const ok = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'worker@agri.com', password: 'pass123' },
    });
    expect(ok.statusCode).toBe(200);
  });
});

// ===========================================================================
describe('SEC-H8 / SEC-H5 — configuration fails fast outside development', () => {
  // Wave 0 removed the hardcoded development fallback entirely: development now
  // mints a random per-process key instead of returning a value that is
  // readable in the source tree.
  it('mints an ephemeral development key rather than a published literal', () => {
    const dev = resolveAuthSecret('development', undefined);
    expect(dev).not.toBe(INSECURE_LEGACY_SECRET);
    expect(dev.length).toBeGreaterThanOrEqual(32);
    expect(resolveAuthSecret('test', undefined)).toBe(dev); // stable within a process
  });

  it('refuses to start in production without AUTH_SECRET', () => {
    expect(() => resolveAuthSecret('production', undefined)).toThrow(SecurityConfigError);
  });

  it('refuses a blank or whitespace-only secret in production', () => {
    expect(() => resolveAuthSecret('production', '')).toThrow(SecurityConfigError);
    expect(() => resolveAuthSecret('production', '   ')).toThrow(SecurityConfigError);
  });

  it('refuses the published development secret in EVERY environment', () => {
    expect(() => resolveAuthSecret('production', INSECURE_LEGACY_SECRET)).toThrow(SecurityConfigError);
    expect(() => resolveAuthSecret('development', INSECURE_LEGACY_SECRET)).toThrow(SecurityConfigError);
  });

  it('refuses a short production secret', () => {
    expect(() => resolveAuthSecret('production', 'tooshort')).toThrow(SecurityConfigError);
  });

  it('accepts a strong production secret', () => {
    const strong = 'K7q2Zx9Lm4Rt8Wn3Yb6Vc1Hd5Jf0Gp2Sa';
    expect(resolveAuthSecret('production', strong)).toBe(strong);
  });

  it('requires an explicit CORS allow-list in production', () => {
    expect(() => resolveCorsOrigins('production', undefined)).toThrow(SecurityConfigError);
    expect(resolveCorsOrigins('production', 'https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(resolveCorsOrigins('development', undefined)).toBe(true);
  });

  it('applies baseline security headers to every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

// ===========================================================================
describe('SEC-H6 — upload content validation', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]);

  it('accepts a well-formed PNG and returns a server-chosen extension', () => {
    expect(validateUpload('image/png', PNG)).toEqual({ ok: true, extension: 'png' });
  });

  it('accepts a well-formed JPEG and normalises the extension', () => {
    expect(validateUpload('image/jpeg', JPEG)).toEqual({ ok: true, extension: 'jpg' });
  });

  it('rejects a type that is not on the allow-list with 415', () => {
    expect(validateUpload('application/x-msdownload', PNG)).toMatchObject({ ok: false, status: 415 });
    expect(validateUpload('text/html', PNG)).toMatchObject({ ok: false, status: 415 });
    expect(validateUpload(undefined, PNG)).toMatchObject({ ok: false, status: 415 });
  });

  // The original defect: the extension came from the declared MIME type, so a
  // caller could pick the suffix of a file written into a served directory.
  it('rejects content whose bytes contradict the declared type', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(validateUpload('image/png', html)).toMatchObject({ ok: false, status: 415 });
  });

  it('rejects an empty upload with 400', () => {
    expect(validateUpload('image/png', Buffer.alloc(0))).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects an oversized upload with 413', () => {
    expect(validateUpload('image/png', PNG, 4)).toMatchObject({ ok: false, status: 413 });
  });

  it('strips traversal and separators from a caller-supplied filename', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('..');
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFilename('a\\b.png')).not.toContain('\\');
    expect(sanitizeFilename('')).toBe('upload');
    expect(sanitizeFilename(undefined)).toBe('upload');
  });
});
