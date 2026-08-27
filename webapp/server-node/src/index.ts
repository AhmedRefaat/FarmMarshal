/**
 * index.ts — COMPOSITION ROOT (Trail-2 server)
 * ===========================================================================
 * Wires everything: Fastify → CORS → multipart → static /uploads → WS plugin
 * → route modules → (listen, unless NO_LISTEN for tests).
 *
 * TWO ENTRY MODES:
 *   • `npm run dev` / `npm start`  → buildApp() + listen on :3000
 *   • automated tests (G1)         → import { buildApp() } and use app.inject()
 *     — no port binding, no network, fully deterministic.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/ARCHITECTURE_EVOLUTION_PLAN.md §1 (topology) · ADR-003/ADR-004
 *   - docs/LOGGING_GUIDE.md (LOG_LEVEL/LOG_FORMAT control incl. 'off')
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocketPlugin from '@fastify/websocket';
import { mkdirSync, createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import taskRoutes from './routes/tasks.js';
import commentRoutes from './routes/comments.js';
import ratingRoutes from './routes/ratings.js';
import farmFinanceRoutes from './routes/farmsFinance.js';
import googleAuthRoutes from './routes/googleAuth.js';
import v2Routes from './routes/v2.js'; // P0: issues/personas/entitlements/audit
import featureRoutes from './routes/features.js'; // P1–P7 feature surface
import { authenticate } from './auth.js';
import { getTask, listFarmMembers, updateTask } from './store.js';
import { makeLogger, logBootConfig } from './logger.js';
import { describeAuthSecret, resolveCorsOrigins } from './security/config.js';
import { MAX_UPLOAD_BYTES, validateUpload } from './security/uploads.js';
import {
  isCanonicalExtension,
  resolveContainedPath,
  signMediaTicket,
  verifyMediaTicket,
} from './security/media.js';

const log = makeLogger('http');

// Directory where uploaded media (audio comments, evidence photos) persists
// and is served, with authorization, at GET /uploads/<file>.
export const UPLOAD_DIR = resolve('uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Shared media writer (audio notes + photos) — one seam, one naming scheme.
 *
 * VAL-008: `ext` used to arrive from a client-controlled MIME substring and was
 * interpolated straight into a path. It is now checked against the extensions
 * the server itself is willing to write, and the resolved path is proven to
 * stay inside UPLOAD_DIR before anything is written.
 */
export async function saveMedia(data: Buffer, ext: string): Promise<string> {
  if (!isCanonicalExtension(ext)) {
    throw new Error(`refusing to store media with unsupported extension: ${ext}`);
  }
  const filename = `${randomUUID()}.${ext}`;
  const target = resolveContainedPath(UPLOAD_DIR, filename);
  if (!target) throw new Error('refusing to store media outside the upload directory');
  await writeFile(target, data);
  return `/uploads/${filename}`;
}

/**
 * buildApp() — assemble the fully-wired Fastify instance.
 * Separated from listening so tests can use fastify.inject() (G1 gap plan).
 */
export async function buildApp() {
  const app = Fastify({
    // LOG_LEVEL=off disables framework logging entirely (kill-switch parity
    // with src/logger.ts). Otherwise info, or debug when explicitly asked.
    logger:
      (process.env.LOG_LEVEL ?? 'info') === 'off'
        ? false
        : { level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info' },
  });

  // SEC-H5: `origin: true` reflected (and therefore trusted) ANY origin, so a
  // hostile page could call the API with the browser's credentials. Development
  // keeps the permissive behaviour for Vite/LAN devices; every other
  // environment must supply an explicit CORS_ORIGINS allow-list or fail to boot.
  await app.register(cors, { origin: resolveCorsOrigins(), credentials: true });

  // SEC-H6: multipart had no limits, so a single request could exhaust memory
  // and disk. Bound file size, file count, and field size at the parser.
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 64 * 1024 },
  });

  // Uploaded media is user-controlled content served to authenticated callers
  // only. @fastify/static is deliberately NOT used: 8.3.0 carries advisories
  // for path traversal and for guard bypass via non-canonical paths, so the
  // plugin is removed from the request path rather than fronted by a guard the
  // advisory says is bypassable.
  app.get('/uploads/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const { ticket } = request.query as { ticket?: string };
    const correlationId = (request as any).correlationId;

    const path = resolveContainedPath(UPLOAD_DIR, name);
    if (!path) {
      log.warn('media request rejected: non-canonical name', { correlationId });
      return reply.code(404).send({ error: 'Not found' });
    }

    const session = authenticate(request);
    const authorized = !!session || (!!ticket && verifyMediaTicket(name, ticket));
    if (!authorized) {
      log.warn('media request denied: unauthenticated', { correlationId });
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const info = await stat(path);
      if (!info.isFile()) return reply.code(404).send({ error: 'Not found' });
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }

    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Content-Disposition', 'inline');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(createReadStream(path));
  });

  /**
   * Mint a short-lived ticket for one stored object, so `<img>` and `<Image>`
   * tags — which cannot carry an Authorization header — have a supported way
   * to render media without the directory being public.
   */
  app.post('/media/ticket', async (request, reply) => {
    const session = authenticate(request);
    if (!session) return reply.code(401).send({ error: 'Unauthorized' });
    const { url } = (request.body ?? {}) as { url?: string };
    const name = (url ?? '').replace(/^\/uploads\//, '');
    if (!resolveContainedPath(UPLOAD_DIR, name)) {
      return reply.code(400).send({ error: 'url must reference a stored upload' });
    }
    return { url: `/uploads/${name}?ticket=${signMediaTicket(name)}` };
  });

  await app.register(websocketPlugin);        // P1 chat push channel (/ws)

  // Correlation id on every request so a denial can be traced across logs
  // without any request content being recorded.
  app.addHook('onRequest', async (request) => {
    (request as any).correlationId = randomUUID();
  });

  // Baseline response hardening for every route (no new dependency).
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    reply.header('X-Correlation-Id', (request as any).correlationId ?? '');
    return payload;
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(taskRoutes);
  await app.register(commentRoutes, { saveAudio: (d: Buffer) => saveMedia(d, 'webm') });
  await app.register(ratingRoutes);
  await app.register(farmFinanceRoutes); // R4/R5: farms + financial ledger
  await app.register(googleAuthRoutes);  // Google Sign-In token exchange
  await app.register(v2Routes);          // P0 surface
  await app.register(featureRoutes);     // P1–P7 surface

  /**
   * Evidence-photo upload (P0 mobile migration + R1 geo-evidence).
   * Multipart file → /uploads/{uuid}.jpg → URL (+ optional shutter GPS)
   * written onto the task. Idempotent per attempt (new file each retry).
   */
  app.post('/tasks/:id/photos', async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { kind?: string };
    if (q.kind !== 'before' && q.kind !== 'after') {
      log.warn('photo upload rejected: bad kind', { id, kind: q.kind });
      return reply.code(400).send({ error: "kind must be 'before' or 'after'" });
    }
    const session = authenticate(request);
    if (!session) {
      log.warn('photo upload rejected: unauthenticated', { id });
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const task = getTask(id);
    if (!task) {
      log.warn('photo upload rejected: unknown task', { id, by: session.userId });
      return reply.code(404).send({ error: 'Task not found' });
    }
    // Tenant isolation: the caller must belong to the task's farm before any
    // role-level reasoning. Without this a moderator from another farm could
    // overwrite evidence on work they have nothing to do with.
    const inFarm = listFarmMembers(session.userId).some((m) => m.farmId === task.farmId);
    if (!inFarm) {
      log.warn('photo upload denied (tenant)', { id, by: session.userId });
      return reply.code(404).send({ error: 'Task not found' });
    }
    if (session.role === 'worker' && task.workerId !== session.userId) {
      log.warn('photo upload denied (ownership)', { id, by: session.userId });
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const file = await (request as any).file();
    if (!file) {
      log.warn('photo upload rejected: missing file', { id, by: session.userId });
      return reply.code(400).send({ error: 'multipart file required' });
    }

    // SEC-H6: the stored extension used to come from the client-declared MIME
    // type, letting a caller choose the suffix of a file written into a
    // statically served directory. The extension is now derived from an
    // allow-list and the bytes must match the declared type.
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      log.warn('photo upload rejected: over size limit', { id, by: session.userId });
      return reply.code(413).send({ error: 'file exceeds the upload size limit' });
    }
    const check = validateUpload(file.mimetype, buffer);
    if (!check.ok) {
      log.warn('photo upload rejected: content validation', {
        id,
        by: session.userId,
        declared: file.mimetype,
        reason: check.error,
      });
      return reply.code(check.status).send({ error: check.error });
    }
    if (!check.extension.match(/^(jpg|png|webp)$/)) {
      return reply.code(415).send({ error: 'evidence photos must be JPEG, PNG or WebP' });
    }
    const url = await saveMedia(buffer, check.extension);
    // R1: optional shutter-time GPS fields ride along in the multipart body.
    const lat = parseFloat(file.fields?.lat?.value ?? '');
    const lng = parseFloat(file.fields?.lng?.value ?? '');
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
    updateTask(id, {
      ...(q.kind === 'before'
        ? { beforePhotoUrl: url, ...(hasGeo ? { beforePhotoLat: lat, beforePhotoLng: lng } : {}) }
        : { afterPhotoUrl: url, ...(hasGeo ? { afterPhotoLat: lat, afterPhotoLng: lng } : {}) }),
    });
    log.info('evidence photo stored', { taskId: id, kind: q.kind, geoAttached: hasGeo });
    return { url };
  });

  // Health probe for uptime checks / container orchestration.
  app.get('/health', async () => ({ ok: true }));

  return app;
}

// ---------------------------------------------------------------------------
// CLI entry: build + listen. Skipped under vitest (NO_LISTEN=1) so importing
// this module never binds a port during automated route tests.
// ---------------------------------------------------------------------------
if (process.env.NO_LISTEN !== '1') {
  logBootConfig();
  // Provenance and validity only — the secret itself is never logged. An
  // 'ephemeral-development' source means tokens do not survive a restart.
  log.info('auth signing configuration', describeAuthSecret());
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}
