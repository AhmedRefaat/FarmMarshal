/**
 * record-demo-fixture.mjs — capture the live API into a static fixture.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * GitHub Pages serves static files only: there is no place to run the Fastify
 * or Axum trail. To publish a working demo we replay *recorded* responses in
 * the browser (see src/demo/demoApi.ts) instead of re-implementing the server.
 *
 * Recording beats hand-writing a mock because the wire shapes stay exactly
 * what the real server produced — including the role-scoped differences, which
 * is why every persona is recorded separately.
 *
 * USAGE
 *   1. start the Node trail:  cd webapp/server-node && npm run dev
 *   2. run this script:       cd webapp/client && npm run record:demo
 *   3. commit src/demo/fixture.json
 *
 * Re-run it whenever the server seed or a response shape changes, otherwise
 * the published demo silently drifts from the real product.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.RECORD_API_URL ?? 'http://localhost:3000';
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/demo/fixture.json'
);

/** The accounts offered on the login screen. Demo passwords, not secrets. */
const PERSONAS = [
  ['owner@agri.com', 'pass123'],
  ['moderator@agri.com', 'pass123'],
  ['worker@agri.com', 'pass123'],
  ['worker2@agri.com', 'pass123'],
  ['expert1@agri.com', 'pass123'],
  ['expert2@agri.com', 'pass123'],
  ['admin@agri.com', 'admin123'],
];

/**
 * Record one GET. Non-2xx is recorded too: the demo must reproduce the same
 * 403 a worker gets on an owner-only endpoint, not pretend it succeeded.
 */
async function get(token, path, into) {
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  into[`GET ${path}`] = { status: res.status, body };
  return res.ok ? body : null;
}

async function recordPersona(email, password) {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`login failed for ${email}: ${login.status}`);
  const { token, user } = await login.json();

  const responses = {};
  const users = (await get(token, '/users', responses)) ?? [];
  for (const u of users) {
    await get(token, `/users/${u.id}/stats`, responses);
    // Query string built exactly as api.ts builds it — the demo router keys
    // on the raw path, so a difference of one character is a cache miss.
    await get(token, `/ratings?rateeId=${u.id}`, responses);
  }

  const tasks = (await get(token, '/tasks', responses)) ?? [];
  for (const t of tasks) {
    await get(token, `/tasks/${t.id}`, responses);
    await get(token, `/tasks/${t.id}/comments`, responses);
    await get(token, `/tasks/${t.id}/report`, responses);
  }

  const farms = (await get(token, '/farms', responses)) ?? [];
  const v2Farms = (await get(token, '/v2/farms', responses)) ?? [];
  await get(token, '/finances?farmId=', responses);
  await get(token, '/finances/summary', responses);
  for (const f of [...farms, ...v2Farms]) {
    await get(token, `/finances?farmId=${f.id}`, responses);
    await get(token, `/finances/summary?farmId=${f.id}`, responses);
    const issues =
      (await get(
        token,
        `/v2/issues?farmId=${encodeURIComponent(f.id)}`,
        responses
      )) ?? [];
    for (const i of issues) await get(token, `/v2/issues/${i.id}/events`, responses);
  }

  const consultations = (await get(token, '/v2/consultations', responses)) ?? [];
  for (const c of consultations) await get(token, `/v2/consultations/${c.id}`, responses);
  await get(token, '/v2/experts', responses);
  await get(token, '/v2/experts/me', responses);

  const inbox = (await get(token, '/v2/chat/inbox', responses)) ?? [];
  for (const c of inbox) await get(token, `/v2/chat/${c.id}/messages`, responses);

  return { user, responses };
}

const fixture = { recordedAt: Date.now(), api: API, personas: {} };
for (const [email, password] of PERSONAS) {
  process.stdout.write(`recording ${email} … `);
  fixture.personas[email] = await recordPersona(email, password);
  const n = Object.keys(fixture.personas[email].responses).length;
  process.stdout.write(`${n} responses\n`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(fixture, null, 0)}\n`, 'utf8');
console.log(`wrote ${OUT}`);
