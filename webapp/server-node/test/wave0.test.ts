/**
 * wave0.test.ts — acceptance tests for the Wave 0 emergency remediation.
 * ---------------------------------------------------------------------------
 * Each block pins one confirmed critical finding. A failure here means a
 * contained vulnerability has been reopened.
 *
 *   SEC-C01  hardcoded signing secret / token forgery
 *   SEC-C02  unauthorized chat-message listing
 *   SEC-C03  translation path bypass (also provider-cost abuse)
 *   SEC-C04  unscoped finance reads
 *   SEC-C05  caller-controlled farm finance writes
 *   VAL-008  upload path traversal
 *   VAL-009  unauthenticated upload serving
 *
 * No test in this file contains a real secret value. The only literal secret
 * material is the BURNED development literal, which exists solely to prove it
 * is now rejected everywhere.
 */

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp, saveMedia } from '../src/index.js';
import { MockTranslator, createConversation, listMessages, messageInLang, sendMessage } from '../src/chat.js';
import {
  INSECURE_LEGACY_SECRET,
  PLACEHOLDER_SECRETS,
  SecurityConfigError,
  describeAuthSecret,
  resolveAuthSecret,
} from '../src/security/config.js';
import {
  resolveContainedPath,
  signMediaTicket,
  verifyMediaTicket,
} from '../src/security/media.js';

let app: Awaited<ReturnType<typeof buildApp>>;

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().token;
}

let ownerToken: string;
let workerToken: string;
let modToken: string;

beforeAll(async () => {
  process.env.NO_LISTEN = '1';
  app = await buildApp();
  ownerToken = await login('owner@agri.com', 'pass123');
  workerToken = await login('worker@agri.com', 'pass123');
  modToken = await login('moderator@agri.com', 'pass123');
});
afterAll(async () => {
  await app.close();
});

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

// ===========================================================================
// SEC-C01 — signing secret must be operator-supplied and fail closed
// ===========================================================================
describe('SEC-C01 — authentication secret configuration', () => {
  it('startup fails when the auth secret is missing outside development', () => {
    for (const env of ['production', 'staging']) {
      expect(() => resolveAuthSecret(env, undefined)).toThrow(SecurityConfigError);
      expect(() => resolveAuthSecret(env, '')).toThrow(SecurityConfigError);
      expect(() => resolveAuthSecret(env, '    ')).toThrow(SecurityConfigError);
    }
  });

  it('startup fails for known placeholder values in EVERY environment', () => {
    for (const placeholder of PLACEHOLDER_SECRETS) {
      for (const env of ['production', 'staging', 'development', 'test']) {
        expect(() => resolveAuthSecret(env, placeholder)).toThrow(SecurityConfigError);
        // Case and padding must not defeat the deny-list.
        expect(() => resolveAuthSecret(env, `  ${placeholder.toUpperCase()}  `)).toThrow(
          SecurityConfigError,
        );
      }
    }
  });

  it('startup fails for short or low-entropy values', () => {
    expect(() => resolveAuthSecret('production', 'short')).toThrow(SecurityConfigError);
    // 40 chars but only two distinct symbols.
    expect(() => resolveAuthSecret('production', 'ab'.repeat(20))).toThrow(SecurityConfigError);
  });

  it('a valid secret permits startup and is returned verbatim', () => {
    const supplied = 'K7q2Zx9Lm4Rt8Wn3Yb6Vc1Hd5Jf0Gp2Sa';
    expect(resolveAuthSecret('production', supplied)).toBe(supplied);
  });

  it('no usable hardcoded fallback remains; development mints a random key', () => {
    const dev = resolveAuthSecret('development', undefined);
    expect(dev).not.toBe(INSECURE_LEGACY_SECRET);
    expect(dev.length).toBeGreaterThanOrEqual(32);
  });

  it('tokens forged with the burned literal are rejected', async () => {
    const payload = Buffer.from(
      JSON.stringify({ userId: 'u-admin', role: 'admin', exp: Date.now() + 3_600_000 }),
    ).toString('base64url');
    const sig = createHmac('sha256', INSECURE_LEGACY_SECRET).update(payload).digest('base64url');

    const res = await app.inject({
      method: 'GET',
      url: '/finances',
      headers: bearer(`${payload}.${sig}`),
    });
    expect(res.statusCode).toBe(401);
  });

  it('stale tokens signed with a previous key are rejected after rotation', async () => {
    // Rotation = the signing key changes. Simulate by signing with a different
    // strong key than the running process uses.
    const previousKey = 'R3t7Yu1Iop4Asd8Fgh2Jkl6Zxc0Vbn5Mq';
    const payload = Buffer.from(
      JSON.stringify({ userId: 'u-owner', role: 'owner', exp: Date.now() + 3_600_000 }),
    ).toString('base64url');
    const sig = createHmac('sha256', previousKey).update(payload).digest('base64url');

    const res = await app.inject({
      method: 'GET',
      url: '/finances',
      headers: bearer(`${payload}.${sig}`),
    });
    expect(res.statusCode).toBe(401);
  });

  it('the boot description never exposes the secret value', () => {
    const described = describeAuthSecret('production', 'K7q2Zx9Lm4Rt8Wn3Yb6Vc1Hd5Jf0Gp2Sa');
    const serialized = JSON.stringify(described);
    expect(serialized).not.toContain('K7q2Zx9');
    expect(described).toMatchObject({ source: 'environment', env: 'production' });
    expect(typeof described.length).toBe('number');
  });
});

// ===========================================================================
// SEC-C02 / SEC-C03 — chat membership is enforced before data and before spend
// ===========================================================================
describe('SEC-C02 / SEC-C03 — chat authorization', () => {
  async function newConversation(token: string, memberIds: string[]) {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/chat/conversations',
      headers: bearer(token),
      payload: { kind: 'group', memberIds, title: 'wave0' },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it('a non-member cannot list conversation messages', async () => {
    const conv = await newConversation(modToken, ['u-worker']);
    const res = await app.inject({
      method: 'GET',
      url: `/v2/chat/${conv.id}/messages`,
      headers: bearer(ownerToken), // owner was never added
    });
    expect(res.statusCode).toBe(404); // non-enumerating: same as "no such id"
    expect(JSON.stringify(res.json())).not.toContain('forbidden');
  });

  it('an unknown conversation id is indistinguishable from a forbidden one', async () => {
    const conv = await newConversation(modToken, ['u-worker']);
    const denied = await app.inject({
      method: 'GET',
      url: `/v2/chat/${conv.id}/messages`,
      headers: bearer(ownerToken),
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/v2/chat/does-not-exist/messages',
      headers: bearer(ownerToken),
    });
    expect(denied.statusCode).toBe(missing.statusCode);
    expect(denied.body).toBe(missing.body);
  });

  it('an authorized member can read the intended conversation', async () => {
    const conv = await newConversation(modToken, ['u-worker']);
    await app.inject({
      method: 'POST',
      url: `/v2/chat/${conv.id}/messages`,
      headers: bearer(modToken),
      payload: { type: 'text', text: 'hello team' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v2/chat/${conv.id}/messages`,
      headers: bearer(workerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('a non-member cannot use the alternate (translation) retrieval path', async () => {
    const conv = await newConversation(modToken, ['u-worker']);
    const sent = await app.inject({
      method: 'POST',
      url: `/v2/chat/${conv.id}/messages`,
      headers: bearer(modToken),
      payload: { type: 'text', text: 'confidential' },
    });
    const messageId = sent.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/v2/chat/messages/${messageId}/translate`,
      headers: bearer(ownerToken),
      payload: { targetLang: 'ar' },
    });
    expect(res.statusCode).toBe(404);
    // The message body must not leak through the error path.
    expect(res.body).not.toContain('confidential');
  });

  it('an unauthorized request never reaches the paid translation provider', async () => {
    const conv = await newConversation(modToken, ['u-worker']);
    const sent = await app.inject({
      method: 'POST',
      url: `/v2/chat/${conv.id}/messages`,
      headers: bearer(modToken),
      payload: { type: 'text', text: 'billable text' },
    });
    const messageId = sent.json().id;

    const spy = vi.spyOn(MockTranslator, 'translate');
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/v2/chat/messages/${messageId}/translate`,
        headers: bearer(ownerToken),
        payload: { targetLang: 'ar' },
      });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('membership is enforced at the module boundary, not only at the route', () => {
    const conv = createConversation({ kind: 'direct', memberIds: ['m1', 'm2'], createdBy: 'm1' });
    expect(() => listMessages(conv.id, 'outsider')).toThrow();
    expect(() => listMessages(conv.id, 'm1')).not.toThrow();
  });

  it('translation is member-gated at the module boundary too', async () => {
    const conv = createConversation({ kind: 'direct', memberIds: ['m3', 'm4'], createdBy: 'm3' });
    const msg = await sendMessage({
      conversationId: conv.id,
      senderId: 'm3',
      senderName: 'M3',
      type: 'text',
      text: 'hello',
    });
    await expect(messageInLang(msg.id, 'ar', 'outsider')).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(messageInLang(msg.id, 'ar', 'm4')).resolves.toBeTruthy();
  });
});

// ===========================================================================
// SEC-C04 / SEC-C05 — finance tenant boundaries
// ===========================================================================
describe('SEC-C04 / SEC-C05 — finance tenant authorization', () => {
  const OTHER_FARM = 'f-other-tenant';

  it('a user cannot read another farm\'s finances', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/finances?farmId=${OTHER_FARM}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('a user cannot read another farm\'s finance summary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/finances/summary?farmId=${OTHER_FARM}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('an unscoped read returns only the caller\'s farms', async () => {
    const directory = await app.inject({ method: 'GET', url: '/farms', headers: bearer(ownerToken) });
    const mine = new Set((directory.json() as Array<{ id: string }>).map((f) => f.id));

    const res = await app.inject({ method: 'GET', url: '/finances', headers: bearer(ownerToken) });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ farmId: string }>;
    expect(rows.length).toBeGreaterThan(0);
    // Every row belongs to a farm the caller is actually bound to.
    expect(rows.every((r) => mine.has(r.farmId))).toBe(true);
    expect(rows.some((r) => r.farmId === OTHER_FARM)).toBe(false);
  });

  it('a user cannot write to another farm\'s ledger', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/finances',
      headers: bearer(ownerToken),
      payload: { farmId: OTHER_FARM, type: 'expense', category: 'seeds', amount: 10 },
    });
    expect(res.statusCode).toBe(403);

    // Nothing was appended anywhere the caller can observe.
    const after = await app.inject({ method: 'GET', url: '/finances', headers: bearer(ownerToken) });
    expect((after.json() as any[]).some((r) => r.farmId === OTHER_FARM)).toBe(false);
  });

  it('a caller cannot create ownership through request-body manipulation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/finances',
      headers: bearer(workerToken), // worker: no financial write anywhere
      payload: {
        farmId: 'f-1',
        type: 'income',
        category: 'harvest_sale',
        amount: 999,
        createdById: 'u-owner', // attempt to impersonate
        ownerId: 'u-worker',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('the recorded author is the authenticated actor, not the body value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/finances',
      headers: bearer(modToken),
      payload: {
        farmId: 'f-1',
        type: 'expense',
        category: 'fuel',
        amount: 250,
        createdById: 'u-owner',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().createdById).toBe('u-mod');
  });

  it('an authorized finance operation still works end to end', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/finances',
      headers: bearer(ownerToken),
      payload: { farmId: 'f-1', type: 'expense', category: 'labor', amount: 320, note: 'ok' },
    });
    expect(created.statusCode).toBe(201);

    const summary = await app.inject({
      method: 'GET',
      url: '/finances/summary?farmId=f-1',
      headers: bearer(ownerToken),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().totalExpense).toBeGreaterThan(0);
  });

  it('a worker holds no finance read access', async () => {
    const res = await app.inject({ method: 'GET', url: '/finances', headers: bearer(workerToken) });
    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated finance access is refused', async () => {
    const res = await app.inject({ method: 'GET', url: '/finances' });
    expect(res.statusCode).toBe(401);
  });

  it('the farm directory exposes only the caller\'s farms', async () => {
    const worker = await app.inject({ method: 'GET', url: '/farms', headers: bearer(workerToken) });
    expect(worker.statusCode).toBe(200);
    const workerFarms = (worker.json() as Array<{ id: string }>).map((f) => f.id);

    const owner = await app.inject({ method: 'GET', url: '/farms', headers: bearer(ownerToken) });
    const ownerFarms = (owner.json() as Array<{ id: string }>).map((f) => f.id);

    // The worker sees his own assignments and nothing more: strictly fewer
    // farms than the owner of the same tenant, and never a farm he is not in.
    expect(workerFarms).toContain('f-1');
    expect(workerFarms.length).toBeLessThan(ownerFarms.length);
    expect(workerFarms).not.toContain(OTHER_FARM);
    expect(workerFarms.every((id) => ownerFarms.includes(id))).toBe(true);
  });
});

// ===========================================================================
// VAL-008 / VAL-009 / DEP-01 — upload storage and serving
// ===========================================================================
describe('VAL-008 / VAL-009 — upload containment and authorized serving', () => {
  const TRAVERSAL = [
    '../secrets.env',
    '..\\secrets.env',
    'a/../../etc/passwd',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    '%2e%2e%2fsecrets.env',
    '..%5csecrets.env',
    'ok.png\u0000.txt',
    '....//secrets.env',
    '.',
    '..',
  ];

  it('path traversal attempts are rejected before any filesystem access', () => {
    for (const candidate of TRAVERSAL) {
      expect(resolveContainedPath('uploads', candidate), candidate).toBeNull();
    }
  });

  it('only canonical stored names resolve', () => {
    expect(resolveContainedPath('uploads', '3f2504e0-4f89-41d3-9a0c-0305e82c3301.png')).not.toBeNull();
    expect(resolveContainedPath('uploads', 'not-a-uuid.png')).toBeNull();
    expect(resolveContainedPath('uploads', '3f2504e0-4f89-41d3-9a0c-0305e82c3301.exe')).toBeNull();
  });

  it('saveMedia refuses a non-canonical extension', async () => {
    await expect(saveMedia(Buffer.from('x'), 'php')).rejects.toThrow();
    await expect(saveMedia(Buffer.from('x'), '../../evil')).rejects.toThrow();
  });

  it('unauthorized upload retrieval is rejected', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/uploads/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png',
    });
    expect(res.statusCode).toBe(401);
  });

  it('a traversal request on the serving route is rejected without leaking', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/uploads/..%2F..%2Fpackage.json',
      headers: bearer(ownerToken),
    });
    expect([400, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain('dependencies');
  });

  it('a legitimate stored asset is retrievable by an authenticated caller', async () => {
    // 1x1 transparent PNG (valid magic bytes for the allow-list).
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const url = await saveMedia(png, 'png');
    const name = url.replace('/uploads/', '');

    const res = await app.inject({ method: 'GET', url, headers: bearer(ownerToken) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");

    // And via a short-lived, path-bound ticket (for <img>/<Image> which cannot
    // send an Authorization header).
    const ticket = signMediaTicket(name);
    const viaTicket = await app.inject({ method: 'GET', url: `${url}?ticket=${ticket}` });
    expect(viaTicket.statusCode).toBe(200);
  });

  it('a media ticket is bound to one file and expires', () => {
    const a = '3f2504e0-4f89-41d3-9a0c-0305e82c3301.png';
    const b = '3f2504e0-4f89-41d3-9a0c-0305e82c3302.png';
    const now = Date.now();
    const ticket = signMediaTicket(a, now);

    expect(verifyMediaTicket(a, ticket, now)).toBe(true);
    expect(verifyMediaTicket(b, ticket, now)).toBe(false); // not transferable
    expect(verifyMediaTicket(a, ticket, now + 10 * 60 * 1000)).toBe(false); // expired
    expect(verifyMediaTicket(a, 'forged.deadbeef', now)).toBe(false);
    expect(verifyMediaTicket(a, '', now)).toBe(false);
  });
});

// ===========================================================================
// Cross-cutting: logs and responses must stay free of secret material
// ===========================================================================
describe('Wave 0 — no secret material in observable output', () => {
  it('security logging emits a correlation id and no secret value', async () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (chunk: any, ...rest: any[]) => {
      written.push(String(chunk));
      return original(chunk, ...rest);
    };
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/finances?farmId=f-other-tenant',
        headers: bearer(ownerToken),
      });
      expect(res.statusCode).toBe(403);
      expect(res.headers['x-correlation-id']).toBeTruthy();
    } finally {
      (process.stdout as any).write = original;
    }

    const combined = written.join('\n');
    expect(combined).not.toContain(INSECURE_LEGACY_SECRET);
    expect(combined).not.toContain(ownerToken);
    expect(combined).not.toMatch(/Bearer\s+\S+/);
    expect(combined).not.toContain('AUTH_SECRET=');
  });
});
