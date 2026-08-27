/**
 * routes/features.ts — P1–P7 API surface under /v2
 * ===========================================================================
 * Every route: authz guard → entitlement gate where plan-gated → domain call
 * → typed error mapping. Sections cite requirement IDs. Logging per LOGGING_GUIDE.
 *
 * P1  /v2/chat/*            conversations, messages, pins, reactions, translate, inbox
 * P1  /ws                   WebSocket push for new messages (REST polling fallback)
 * P2  /v2/devices*, /v2/water/*    telemetry ingest, valve control, summaries, leak scan
 * P3  /v2/solar/*           panel reports, dust status, cleaning requests, weather
 * P4  /v2/videos*, /v2/schedules   upload lifecycle, annotations, farm events
 * P5  /v2/trees*            registry, QR/relative/GPS resolution, lifecycle
 * P6  /v2/experts*, /v2/consultations*   Uber-style marketplace
 * P7  /v2/cases*, /v2/quizzes*           learner academy
 *
 * GUARD PATTERN (every route follows ONE of three shapes):
 *   requirePermission(action[, farmResolver])  → RBAC via authz matrix
 *   + requireEntitlement(key[, farmResolver])  → plan gating (ADR-012)
 *   Domain errors map to HTTP in mapChatError/mapAgriError/mapCommunityError.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - V2_REQUIREMENTS_ANALYSIS.md §F1–§F7 (one section per block below)
 *   - ARCHITECTURE_EVOLUTION_PLAN.md §8 (this file implements that contract)
 *   - SUBSCRIPTION_AND_PAYMENTS_DESIGN.md §2 (402 upsell contract)
 *   - ROBOT_INTEGRATION_SPEC.md §4 (video upload/completion contract)
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { hasFarmAccess, requirePermission } from '../authz.js';
import type { ActorContext as AC } from '../authz.js';
import { authenticate } from '../auth.js';
import { requireEntitlement } from '../entitlements.js';
import { audit } from '../audit.js';
import { saveMedia } from '../index.js';
import { advanceIssue, StageError } from '../issues.js';
import { makeLogger } from '../logger.js';
import { validateUpload } from '../security/uploads.js';

import {
  assertMember,
  ChatError,
  createConversation,
  listMessages,
  listReactions,
  messageInLang,
  react,
  sendMessage,
  setPin,
} from '../chat.js';
import {
  AgriError,
  addTreeEvent,
  classifyDust,
  detectNightFlowLeaks,
  generateDailyReports,
  raiseCleaningRequests,
  raiseLeakIssues,
  recommendTreeStatus,
  requestValveChange,
  resolveTree,
  waterSummary,
} from '../agri.js';
import {
  CommunityError,
  addQuestion,
  annotateVideo,
  applyAsExpert,
  chooseResponse,
  completeVideo,
  createQuiz,
  createSchedule,
  gradeAttempt,
  listAnnotations,
  listSchedules,
  postConsultation,
  publishCaseFromIssue,
  publishQuiz,
  rateResponse,
  registerVideo,
  respondToConsultation,
  reviewVerification,
  splitBounty,
} from '../community.js';
import {
  academyStore,
  getDevice,
  getIssueById,
  listFarmMembers,
  getTreeByQr,
  listDevices,
  listPanelReports,
  listTelemetry,
  marketStore,
  recordTelemetry,
  treeStore,
  upsertDevice,
  upsertPanel,
  videoStore,
} from '../store.js';
import { chatStore } from '../store.js';

const log = makeLogger('features');

// ---------------------------------------------------------------------------
// Live WS registry (P1). Production: Redis pub/sub across instances.
// ---------------------------------------------------------------------------
const liveSockets = new Map<string, Set<WebSocket>>(); // userId -> sockets

function pushToUser(userId: string, payload: unknown) {
  for (const sock of liveSockets.get(userId) ?? []) {
    try {
      sock.send(JSON.stringify(payload));
    } catch {
      /* dead socket — cleaned up on close */
    }
  }
}

export default async function featureRoutes(app: FastifyInstance) {
  // ================================================================== P1 CHAT
  app.post('/v2/chat/conversations', { preHandler: requirePermission() }, async (request, reply) => {
    const b = request.body as any;
    try {
      log.info('conversation requested', { kind: b.kind ?? 'direct', by: (request as any).session.userId });
      const conv = createConversation({
        kind: b.kind ?? 'direct',
        memberIds: [...new Set([...(b.memberIds ?? []), (request as any).session.userId])],
        createdBy: (request as any).session.userId,
        title: b.title,
        farmId: b.farmId,
        consultationId: b.consultationId,
      });
      return reply.code(201).send(conv);
    } catch (e) {
      return mapChatError(e, reply);
    }
  });

  /**
   * EXPERT INBOX (F3): threads enriched with farm→area→worker context so the
   * serving expert instantly knows who/where each conversation belongs to.
   */
  app.get('/v2/chat/inbox', { preHandler: requirePermission() }, async (request) => {
    const me = (request as any).session.userId as string;
    return [...chatStore.conversations.values()]
      .filter((c) => c.memberIds.includes(me))
      .map((c) => {
        const msgs = listMessages(c.id, me);
        return {
          ...c,
          lastMessageAt: msgs.at(-1)?.createdAt ?? c.createdAt,
          unreadHint: msgs.filter((m) => m.senderId !== me).length, // v1 heuristic
          pinned: msgs.filter((m) => m.pinned).length,
        };
      })
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  });

  app.post('/v2/chat/:id/messages', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as any;
    try {
      const msg = await sendMessage({
        conversationId: id,
        senderId: (request as any).session.userId,
        senderName: (request as any).session.userId, // profiles join later
        type: b.type ?? 'text',
        originalText: b.text,
        mediaUrl: b.mediaUrl,
        durationS: b.durationS,
        replyToId: b.replyToId,
        idempotencyKey: b.idempotencyKey,
      });
      // Live push to every OTHER member (sender gets REST response).
      const conv = chatStore.conversations.get(id)!;
      for (const m of conv.memberIds) if (m !== msg.senderId) pushToUser(m, { event: 'message', message: msg });
      return reply.code(201).send(msg);
    } catch (e) {
      return mapChatError(e, reply);
    }
  });

  // SEC-C02: the caller's identity is passed through so listMessages() can
  // assert membership. Denials are mapped non-enumeratively (404, matching the
  // convention used for tasks) so the endpoint cannot confirm that a
  // conversation id exists.
  app.get('/v2/chat/:id/messages', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = (request as any).session.userId as string;
    try {
      const msgs = listMessages(id, me);
      const reactions = listReactions(msgs.map((m) => m.id));
      return msgs.map((m) => ({ ...m, reactions: reactions[m.id] ?? [] }));
    } catch (e) {
      return mapChatReadError(e, reply, request);
    }
  });

  /** Translate one message into the CALLER's language (cached per language). */
  app.post('/v2/chat/messages/:messageId/translate', { preHandler: requirePermission() }, async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    const { targetLang } = request.body as { targetLang?: string };
    const me = (request as any).session.userId as string;
    try {
      // SEC-C03: messageInLang() asserts membership before reaching the paid
      // translation provider, so an unauthorized caller cannot bill us.
      return await messageInLang(messageId, targetLang ?? 'en', me);
    } catch (e) {
      return mapChatReadError(e, reply, request);
    }
  });

  /**
   * ADR-022 universal evidence capture — CHAT variant: worker/expert takes a
   * photo or video in the app and shares it directly in the thread.
   * Multipart {file, type?, durationS?} → /uploads/{uuid}.ext → media message.
   */
  app.post('/v2/chat/:id/media', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = (request as any).session;
    // Authorize BEFORE reading or storing any bytes: a non-member must not be
    // able to write into the upload directory at all.
    try {
      assertMember(id, session.userId);
    } catch (e) {
      return mapChatReadError(e, reply, request);
    }
    const file = await (request as any).file();
    if (!file) return reply.code(400).send({ error: 'multipart file required' });
    const stored = await readValidatedUpload(file, reply, request);
    if (!stored) return reply;
    const url = await saveMedia(stored.buffer, stored.extension);
    try {
      const msg = await sendMessage({
        conversationId: id,
        senderId: session.userId,
        senderName: session.userId,
        type: stored.mimeType.startsWith('video') ? 'video' : 'photo',
        mediaUrl: url,
        durationS: Number(file.fields?.durationS?.value ?? '') || undefined,
        idempotencyKey: file.fields?.idempotencyKey?.value,
      });
      const conv = chatStore.conversations.get(id)!;
      for (const m of conv.memberIds) {
        if (m !== msg.senderId) pushToUser(m, { event: 'message', message: msg });
      }
      log.info('chat media shared', { conversationId: id, type: msg.type });
      return reply.code(201).send(msg);
    } catch (e) {
      return mapChatError(e, reply);
    }
  });

  /**
   * ADR-022 universal evidence store: any authenticated user uploads a field
   * photo/video artifact and gets its URL back. Used by issue reporting,
   * chat media, inspection evidence — one endpoint, one audit shape.
   */
  app.post('/v2/evidence', { preHandler: requirePermission() }, async (request, reply) => {
    const file = await (request as any).file();
    if (!file) return reply.code(400).send({ error: 'multipart file required' });
    const stored = await readValidatedUpload(file, reply, request);
    if (!stored) return reply;
    const url = await saveMedia(stored.buffer, stored.extension);
    log.info('evidence artifact stored', { by: (request as any).session.userId });
    return reply.code(201).send({ url });
  });

  /**
   * Mobile convenience: advance DETECTED→INSPECTED carrying uploaded evidence
   * URLs in one round-trip (farm role resolved exactly like /stage).
   */
  app.post('/v2/issues/:id/advance-with-evidence', { preHandler: requirePermission('issue.advance', (r) => ({ farmId: getIssueById((r.params as any)?.id)?.farmId })) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { note?: string; evidence?: Record<string, unknown> };
    const actor = (request as any).actor as AC;
    let label = 'worker';
    if (actor.personas.includes('admin')) label = 'admin';
    else {
      const issue = getIssueById(id);
      if (issue && actor.ownedFarmIds.has(issue.farmId)) label = 'owner';
      else {
        const m = listFarmMembers(actor.userId).find((x) => x.farmId === issue?.farmId);
        label = m?.roleInFarm ?? label;
      }
    }
    try {
      const result = advanceIssue(id, 'inspected', actor, label, { note: b.note, evidence: b.evidence });
      return result.issue;
    } catch (e) {
      if (e instanceof StageError) {
        const code = e.code === 'forbidden' ? 403 : e.code === 'bad_stage' ? 409 : 400;
        return reply.code(code).send({ error: e.message, code: e.code });
      }
      throw e;
    }
    function ok_wrap(v: unknown) { return v; }
  });

  app.patch('/v2/chat/messages/:messageId/pin', { preHandler: requirePermission() }, async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    const { pinned } = request.body as { pinned: boolean };
    try {
      return setPin(messageId, (request as any).session.userId, !!pinned);
    } catch (e) {
      return mapChatError(e, reply);
    }
  });

  app.put('/v2/chat/messages/:messageId/react', { preHandler: requirePermission() }, async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    const { emoji } = request.body as { emoji: string };
    try {
      react(messageId, (request as any).session.userId, emoji);
      return { ok: true };
    } catch (e) {
      return mapChatError(e, reply);
    }
  });

  // ============================================================ P1 WEBSOCKET
  /**
   * Push channel. Auth via ?token= (browser WS cannot set headers).
   * Clients that cannot hold a WS fall back to polling GET messages — both
   * transports deliver identical payloads (ADR-011 resilience principle).
   */
  app.get('/ws', { websocket: true }, (socket, request) => {
    const q = request.query as { token?: string };
    const session = q.token ? fakeRequestAuth(q.token) : null;
    if (!session) {
      socket.close(4001, 'unauthorized');
      return;
    }
    const uid = session.userId;
    log.info('ws connected', { userId: uid });
    if (!liveSockets.has(uid)) liveSockets.set(uid, new Set());
    liveSockets.get(uid)!.add(socket);
    socket.on('close', () => {
      liveSockets.get(uid)?.delete(socket);
      log.debug('ws closed', { userId: uid });
    });
    // Heartbeat ping keeps intermediaries from idling the connection out.
    const hb = setInterval(() => {
      try { socket.ping(); } catch { clearInterval(hb); }
    }, 30_000);
    socket.on('close', () => clearInterval(hb));
  });

  // ============================================================== P2 WATER
  /** Device registry (admin provisions; HAL adapters own vendor specifics). */
  app.post('/v2/devices', { preHandler: requirePermission('flag.manage') }, async (request, reply) => {
    const b = request.body as any;
    if (!b?.farmId || !b?.type || !b?.label) return reply.code(400).send({ error: 'farmId, type, label required' });
    return reply.code(201).send(upsertDevice({
      id: `dev-${randomUUID()}`, farmId: b.farmId, type: b.type, vendor: b.vendor,
      label: b.label, status: 'offline', metadata: b.metadata, createdAt: Date.now(),
    }));
  });
  app.get('/v2/devices', { preHandler: requirePermission('device.view') }, async (request) => {
    const q = request.query as { farmId?: string };
    const devices = listDevices(q.farmId);
    // Tenancy: without an explicit farmId, show ONLY farms the caller belongs to.
    const actor = (request as any).actor;
    return devices.filter((d) => hasFarmAccess(actor, d.farmId));
  });

  /**
   * Telemetry INGEST — HTTP backfill path (ADR-005: production MQTT bridge
   * calls this internally after validation; devices never hit it directly).
   */
  app.post('/v2/devices/:id/telemetry', { preHandler: requirePermission('flag.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDevice(id)) return reply.code(404).send({ error: 'device not found' });
    const b = request.body as { readings?: Array<{ at?: number; metrics: Record<string, number> }> };
    let n = 0;
    for (const r of b.readings ?? []) {
      recordTelemetry({ deviceId: id, at: r.at ?? Date.now(), metrics: r.metrics });
      n++;
    }
    log.info('telemetry ingested', { deviceId: id, count: n });
    return { accepted: n };
  });

  app.get('/v2/water/summary', { preHandler: requirePermission('device.view') }, async (request, reply) => {
    const q = request.query as { deviceId?: string; from?: string; to?: string };
    const dev = getDevice(q.deviceId!);
    const actor = (request as any).actor;
    if (!dev || !hasFarmAccess(actor, dev.farmId)) {
      return reply.code(404).send({ error: 'device not found' }); // 404 hides existence from outsiders
    }
    const to = Number(q.to ?? Date.now());
    const from = Number(q.from ?? to - 86400_000);
    return waterSummary(q.deviceId!, from, to);
  });

  /**
   * VALVE CONTROL (F1): moderator+ only (worker denied), mandatory reason,
   * full audit trail. Plan-gated by water_iot.
   */
  app.post(
    '/v2/devices/:id/valve',
    { preHandler: [requirePermission('valve.control', (r) => ({ farmId: getDevice((r.params as any)?.id)?.farmId })), requireEntitlement('water_iot', (r) => getDevice((r.params as any)?.id)?.farmId)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const b = request.body as { action?: 'open' | 'close'; reason?: string };
      if (b.action !== 'open' && b.action !== 'close') return reply.code(400).send({ error: "action must be open|close" });
      try {
        const cmd = requestValveChange({
          deviceId: id, action: b.action, requestedBy: (request as any).session.userId, reason: b.reason ?? '',
        });
        audit({
          actorId: (request as any).session.userId, persona: (request as any).session.role,
          action: 'valve.command', targetType: 'device', targetId: id,
          detail: { cmdId: cmd.id, action: b.action, reason: b.reason },
        });
        return reply.code(201).send(cmd);
      } catch (e) {
        return mapAgriError(e, reply);
      }
    }
  );

  /** Leak rule scan — also callable by the nightly scheduler. */
  app.post('/v2/water/leak-scan', { preHandler: requirePermission('device.view') }, async () => {
    const raised = raiseLeakIssues();
    return { suspectsFound: detectNightFlowLeaks().length, issuesRaised: raised };
  });

  // ============================================================== P3 SOLAR
  app.post('/v2/solar/panels', { preHandler: requirePermission('flag.manage'), }, async (request, reply) => {
    const b = request.body as any;
    if (!b?.farmId || !b?.stringId || !b?.nameplateKwp) return reply.code(400).send({ error: 'farmId, stringId, nameplateKwp required' });
    return reply.code(201).send(upsertPanel({ id: `panel-${randomUUID()}`, farmId: b.farmId, stringId: b.stringId, nameplateKwp: Number(b.nameplateKwp), installDate: b.installDate }));
  });

  app.get('/v2/solar/reports', { preHandler: requirePermission('device.view'), }, async (request, reply) => {
    const q = request.query as { farmId?: string; date?: string };
    const actor = (request as any).actor;
    if (!hasFarmAccess(actor, q.farmId)) return reply.code(403).send({ error: 'Forbidden' });
    return listPanelReports(q.farmId!, q.date);
  });

  /** Nightly job entry: energy map in → reports + dust flags + cleaning issues. */
  app.post('/v2/solar/daily-job', { preHandler: requirePermission('flag.manage') }, async (request, reply) => {
    const b = request.body as { farmId?: string; date?: string; cloudPct?: number; energyByPanel?: Record<string, number> };
    if (!b.farmId || !b.date) return reply.code(400).send({ error: 'farmId and date required' });
    const reports = generateDailyReports(b.farmId, b.date, b.energyByPanel ?? {}, b.cloudPct ?? 0);
    const cleaning = raiseCleaningRequests(b.farmId, b.date);
    return { reportsGenerated: reports.length, flagged: reports.filter((r) => r.dustStatus !== 'ok').length, cleaningIssuesRaised: cleaning };
  });

  // ============================================================== P5 TREES
  app.post('/v2/trees', { preHandler: requirePermission('issue.create') }, async (request, reply) => {
    const b = request.body as any;
    if (!b?.farmId || !b?.qrCode || !b?.speciesCode || !b?.plantedAt) {
      return reply.code(400).send({ error: 'farmId, qrCode, speciesCode, plantedAt required' });
    }
    if (getTreeByQr(b.qrCode)) return reply.code(409).send({ error: 'qrCode already registered' });
    const t = { id: `tr-${randomUUID()}`, farmId: b.farmId, sector: b.sector, qrCode: b.qrCode, speciesCode: b.speciesCode, plantedAt: Number(b.plantedAt), gps: b.gps, gpsAccuracyM: b.gpsAccuracyM, locationMethod: b.locationMethod ?? (b.gps ? 'gps' : 'manual'), relativeCode: b.relativeCode, status: 'productive' as const, createdAt: Date.now() };
    treeStore.trees.set(t.id, t);
    return reply.code(201).send(t);
  });

  /** Scan resolution: QR > relative code > GPS-within-accuracy (F5 identity). */
  app.get('/v2/trees/resolve', { preHandler: requirePermission('device.view') }, async (request, reply) => {
    const q = request.query as any;
    const hit = resolveTree({ qrCode: q.qrCode, relativeCode: q.relativeCode, sector: q.sector, lat: q.lat !== undefined ? Number(q.lat) : undefined, lng: q.lng !== undefined ? Number(q.lng) : undefined });
    if (!hit) return { tree: null, confidence: null };
    // Tenancy: outsiders learn nothing about other farms' trees.
    if (!hasFarmAccess((request as any).actor, hit.tree.farmId)) {
      return reply.code(404).send({ error: 'tree not found' });
    }
    return hit;
  });

  /** Lifespan recommendation (expert confirms before status change). */
  app.get('/v2/trees/:id/lifecycle-recommendation', { preHandler: requirePermission('device.view') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const t = treeStore.trees.get(id);
    if (!t) return reply.code(404).send({ error: 'tree not found' });
    return { recommendedStatus: recommendTreeStatus(t), currentStatus: t.status };
  });

  app.post('/v2/trees/:id/events', { preHandler: requirePermission('issue.advance') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!treeStore.trees.has(id)) return reply.code(404).send({ error: 'tree not found' });
    const b = request.body as { eventKind?: string; note?: string; evidence?: Record<string, unknown> };
    return reply.code(201).send(addTreeEvent(id, b.eventKind ?? 'note', b.note, b.evidence));
  });

  // ============================================== P4 VIDEO + SCHEDULES
  /**
   * SEC-C2 / GAP-02 — this route previously used ONLY requireEntitlement(),
   * which resolves a plan for a caller-supplied farmId and never authenticates.
   * Anyone on the network could create video records against any farm on an
   * entitled plan, and `uploadedBy` fell back to a client value or 'unknown',
   * destroying attribution. Authentication and farm membership now run first
   * and the uploader is taken from the session only.
   */
  app.post(
    '/v2/videos',
    {
      preHandler: [
        requirePermission('device.view', (req) => ({
          farmId: (req.body as { farmId?: string } | null)?.farmId,
        })),
        requireEntitlement('video_platform'),
      ],
    },
    async (request, reply) => {
      const b = (request.body ?? {}) as Record<string, unknown>;
      const farmId = typeof b.farmId === 'string' ? b.farmId : undefined;
      if (!farmId) return reply.code(400).send({ error: 'farmId required' });

      const actor = (request as any).actor;
      if (!hasFarmAccess(actor, farmId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const session = (request as any).session;
      return reply.code(201).send(registerVideo({
        farmId,
        areaTag: typeof b.areaTag === 'string' ? b.areaTag : undefined,
        sourceDeviceId: typeof b.sourceDeviceId === 'string' ? b.sourceDeviceId : undefined,
        // Attribution comes from the verified session, never from the body.
        uploadedBy: session.userId,
      }));
    },
  );

  /** Completion contract (ffmpeg worker or robot client calls this). */
  app.post('/v2/videos/:id/complete', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { hlsUrl?: string };
    try {
      return completeVideo(id, b.hlsUrl ?? `/uploads/hls/${id}/index.m3u8`);
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  app.get('/v2/videos', { preHandler: requirePermission('device.view') }, async (request, reply) => {
    const q = request.query as { farmId?: string };
    const actor = (request as any).actor;
    if (!hasFarmAccess(actor, q.farmId)) return reply.code(403).send({ error: 'Forbidden' });
    return [...videoStore.videos.values()].filter((v) => v.farmId === q.farmId);
  });

  /** Timestamped annotation (+optional tree link shown in tree history). */
  app.post('/v2/videos/:id/annotations', { preHandler: requirePermission('issue.advance') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as any;
    if (typeof b?.tStartS !== 'number' || !b?.text) return reply.code(400).send({ error: 'tStartS and text required' });
    try {
      return reply.code(201).send(annotateVideo({
        videoId: id, authorId: (request as any).session.userId, authorName: (request as any).session.userId,
        tStartS: b.tStartS, tEndS: b.tEndS, text: b.text, overlaySvg: b.overlaySvg, treeId: b.treeId,
      }));
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  app.get('/v2/videos/:id/annotations', { preHandler: requirePermission('device.view') }, async (request) => {
    const { id } = request.params as { id: string };
    return listAnnotations(id);
  });

  app.post('/v2/schedules', { preHandler: requirePermission('issue.create') }, async (request, reply) => {
    const b = request.body as any;
    if (!b?.farmId || !b?.kind || !b?.title || !b?.cronOrAt) return reply.code(400).send({ error: 'farmId, kind, title, cronOrAt required' });
    log.info('schedule creation requested', { farmId: b.farmId, kind: b.kind, by: (request as any).session.userId });
    return reply.code(201).send(createSchedule({
      farmId: b.farmId, kind: b.kind, title: b.title, cronOrAt: String(b.cronOrAt),
      payload: b.payload, createdBy: (request as any).session.userId,
    }));
  });
  app.get('/v2/schedules', { preHandler: requirePermission('issue.view') }, async (request) => {
    return listSchedules((request.query as any)?.farmId ?? '');
  });

  // ==================================================== P6 MARKETPLACE
  app.post('/v2/experts/apply', { preHandler: requirePermission() }, async (request, reply) => {
    const b = request.body as any;
    try {
      return reply.code(201).send(applyAsExpert({
        userId: (request as any).session.userId,
        specializations: b.specializations, yearsExp: b.yearsExp,
        institution: b.institution, academicTitle: b.academicTitle,
        country: b.country, languages: b.languages,
      }));
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  app.post('/v2/experts/me/documents', { preHandler: requirePermission() }, async (request, reply) => {
    const b = request.body as { docType?: string; docUrl?: string; expiresAt?: number };
    const expert = [...marketStore.experts.values()].find((e) => e.userId === (request as any).session.userId);
    if (!expert) return reply.code(404).send({ error: 'apply first via /v2/experts/apply' });
    return reply.code(201).send({ id: require_addDoc(expert.id, b.docType!, b.docUrl!) });
  });

  /** Admin verification queue + verdicts (Uber-style KYC). */
  app.get('/v2/admin/verifications', { preHandler: requirePermission('persona.verify') }, async () =>
    [...marketStore.verifications.values()].filter((v) => v.reviewStatus === 'in_review'));

  app.patch('/v2/admin/verifications/:id', { preHandler: requirePermission('persona.verify') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { approve } = request.body as { approve: boolean };
    try {
      const expert = reviewVerification(id, approve, (request as any).session.userId);
      audit({
        actorId: (request as any).session.userId, persona: 'admin', action: 'expert.verify',
        targetType: 'verification', targetId: id, detail: { approve },
      });
      return expert;
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  app.post('/v2/consultations', { preHandler: requirePermission(), }, async (request, reply) => {
    const b = request.body as any;
    if (!b?.question || !b?.bountyEgp || !b?.language) return reply.code(400).send({ error: 'question, bountyEgp, language required' });
    return reply.code(201).send(postConsultation({
      requesterId: (request as any).session.userId, question: b.question, bountyEgp: Number(b.bountyEgp),
      scope: b.scope ?? 'public', language: b.language, mediaUrls: b.mediaUrls,
    }));
  });

  app.post('/v2/consultations/:id/responses', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { answer?: string };
    try {
      respondToConsultation(id, (request as any).session.userId, b.answer ?? '');
      return reply.code(201).send({ ok: true });
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  app.patch('/v2/consultations/:id/choose', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { responseId?: string };
    try {
      const result = chooseResponse(id, b.responseId!);
      audit({
        actorId: (request as any).session.userId, persona: (request as any).session.role,
        action: 'consultation.choose', targetType: 'consultation', targetId: id,
        detail: { net: result.netPayoutEgp },
      });
      return result;
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  app.post('/v2/consultations/:id/rate', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { stars?: number };
    if (!b.stars || b.stars < 1 || b.stars > 5) return reply.code(400).send({ error: 'stars 1..5 required' });
    try {
      return { avgStars: rateResponse(id, b.stars) };
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  // ======================================================== P7 ACADEMY
  /** Learner-safe listing: ONLY published cases, anonymized at read time. */
  app.get('/v2/cases', { preHandler: requirePermission() }, async () =>
    [...academyStore.cases.values()].filter((c) => c.status === 'published'));


  app.post('/v2/cases/publish', { preHandler: requirePermission('issue.close') }, async (request, reply) => {
    const b = request.body as any;
    if (!b?.issueId) return reply.code(400).send({ error: 'issueId required' });
    try {
      return reply.code(201).send(publishCaseFromIssue(
        b.issueId, (request as any).session.userId, b.anonymized !== false, b.cropTags ?? [], b.learningObjectives
      ));
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  app.post('/v2/quizzes', { preHandler: requirePermission() }, async (request, reply) => {
    const actor = (request as any).actor;
    // Authoring gate: verified academic OR crowd expert persona (F7b).
    const canAuthor =
      actor.personas.includes('admin') ||
      [...marketStore.experts.values()].some((e) => e.userId === actor.userId && e.status === 'verified');
    if (!canAuthor) return reply.code(403).send({ error: 'only VERIFIED experts may author quizzes' });
    const b = request.body as any;
    if (!b?.title || !b?.passThresholdPct) return reply.code(400).send({ error: 'title and passThresholdPct required' });
    return reply.code(201).send(createQuiz(actor.userId, b.title, Number(b.passThresholdPct), b.caseIds ?? []));
  });

  app.post('/v2/quizzes/:id/questions', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as any;
    try {
      return reply.code(201).send({
        id: addQuestion(id, {
          type: b.type, prompt: b.prompt, options: b.options,
          answerKey: b.answerKey, points: b.points, mediaUrl: b.mediaUrl,
        }),
      });
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  app.post('/v2/quizzes/:id/publish', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return publishQuiz(id);
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  /**
   * Submit an attempt. NOTE: answer keys NEVER appear in any GET payload —
   * grading happens here and returns score only (exam-integrity test case).
   */
  app.post('/v2/quizzes/:id/attempts', { preHandler: requirePermission() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { answers?: Array<{ questionId: string; answer: string | number | boolean }> };
    try {
      return reply.code(201).send(gradeAttempt(id, (request as any).session.userId, b.answers ?? []));
    } catch (e) {
      return mapCommunityError(e, reply);
    }
  });

  /** Published quizzes WITHOUT keys (learner view is key-free by construction). */
  app.get('/v2/quizzes', { preHandler: requirePermission() }, async () =>
    [...academyStore.quizzes.values()]
      .filter((q) => q.status === 'published')
      .map((q) => ({
        ...q,
        questions: [...academyStore.questions.values()]
          .filter((qq) => qq.quizId === q.id)
          .map(({ answerKey, ...safe }) => safe), // strip server-only field
      })));

  function require_addDoc(expertId: string, docType: string, docUrl: string): string {
    if (!marketStore.experts.has(expertId)) throw new CommunityError('not_found', 'expert not found');
    const vid = `ver-${randomUUID()}`;
    marketStore.verifications.set(vid, {
      id: vid, expertId, docType, docUrl, reviewStatus: 'in_review',
    });
    return vid;
  }

  void splitBounty; void classifyDust; void listTelemetry; void listDevices; void getTreeByQr; void listSchedules;
}

// --- helpers -----------------------------------------------------------------

/** Token verification for the WS query-param handshake. */
function fakeRequestAuth(token: string) {
  const fakeReq: any = { headers: { authorization: `Bearer ${token}` } };
  return authenticate(fakeReq);
}

function mapChatError(e: unknown, reply: any) {
  if (e instanceof ChatError) {
    const code = e.code === 'not_found' ? 404 : e.code === 'forbidden' ? 403 : 400;
    return reply.code(code).send({ error: e.message, code: e.code });
  }
  throw e;
}

/**
 * Read-path error mapping. "Not a member" and "does not exist" collapse to an
 * identical 404 so the endpoint cannot be used to enumerate conversation or
 * message ids (same convention as task reads).
 */
function mapChatReadError(e: unknown, reply: any, request?: any) {
  if (e instanceof ChatError) {
    if (e.code === 'forbidden' || e.code === 'not_found') {
      log.warn('chat read denied', {
        code: e.code,
        by: request?.session?.userId,
        correlationId: request?.correlationId,
      });
      return reply.code(404).send({ error: 'Not found', code: 'not_found' });
    }
    return reply.code(400).send({ error: e.message, code: e.code });
  }
  throw e;
}

/**
 * SEC-H02/VAL-007: both feature upload routes previously derived the stored
 * extension from the client-declared MIME type and never checked the bytes.
 * Validation now happens in one place and the extension is server-chosen.
 *
 * @returns the buffer and canonical extension, or null after replying with an
 *          error status.
 */
async function readValidatedUpload(
  file: any,
  reply: any,
  request: any,
): Promise<{ buffer: Buffer; extension: string; mimeType: string } | null> {
  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch {
    log.warn('upload rejected: over size limit', { correlationId: request?.correlationId });
    await reply.code(413).send({ error: 'file exceeds the upload size limit' });
    return null;
  }
  const check = validateUpload(file.mimetype, buffer);
  if (!check.ok) {
    log.warn('upload rejected: content validation', {
      declared: file.mimetype,
      reason: check.error,
      correlationId: request?.correlationId,
    });
    await reply.code(check.status).send({ error: check.error });
    return null;
  }
  return { buffer, extension: check.extension, mimeType: file.mimetype };
}
function mapAgriError(e: unknown, reply: any) {
  if (e instanceof AgriError) return reply.code(e.code === 'not_found' ? 404 : 400).send({ error: e.message });
  throw e;
}
function mapCommunityError(e: unknown, reply: any) {
  if (e instanceof CommunityError) {
    const code = e.code === 'not_found' ? 404 : e.code === 'forbidden' ? 403 : e.code === 'bad_request' ? 400 : 500;
    return reply.code(code).send({ error: e.message, code: e.code });
  }
  throw e;
}
