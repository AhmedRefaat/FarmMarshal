/**
 * routes/v2.ts — P0 API surface (versioned contract, EVOLUTION_PLAN §8)
 * ---------------------------------------------------------------------------
 *   POST /v2/issues                     create (human_report)      [farm member]
 *   GET  /v2/issues?farmId=&kind=&stage=  list                      [farm member]
 *   PATCH /v2/issues/:id/stage          advance workflow           [per-stage roles]
 *   GET  /v2/issues/:id/events          immutable timeline         [farm member]
 *   GET  /v2/farms                      my farms                   [auth]
 *   GET  /v2/farms/:id/entitlements     resolved plan switches     [farm member]
 *   GET  /v2/personas · POST /v2/personas/switch                    [auth]
 *   PATCH /v2/admin/personas/:userId/:persona                       [admin]
 *   GET  /v2/plans · POST /v2/admin/subscriptions                   [admin]
 *   GET  /v2/audit                                                      [admin]
 *   GET  /v2/meta/stages                canonical stage order
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - V2_REQUIREMENTS_ANALYSIS.md §G0.1b (personas), §G0.2 (issues engine)
 *   - ARCHITECTURE_EVOLUTION_PLAN.md §8 (v2 contract) · §9 ADR-009/012
 *   - SUBSCRIPTION_AND_PAYMENTS_DESIGN.md (plans/subscriptions admin)
 */

import type { FastifyInstance } from 'fastify';
import type { ActorContext } from '../authz.js';
import type { IssueStage, Persona } from '../types.js';
import { STAGES, StageError, advanceIssue, createIssue, timeline } from '../issues.js';
import { requirePermission } from '../authz.js';
import { authenticate } from '../auth.js';
import { makeLogger } from '../logger.js';

// Route-level diagnostics: subscription/persona administration events are
// revenue/security-relevant → warn; reads stay silent (module logs cover flow).
const log = makeLogger('v2');
import { entitlementFor } from '../entitlements.js';
import { audit } from '../audit.js';
import {
  getFarm,
  getIssueById,
  listAudit,
  listFarmMembers,
  listIssues,
  listPlans,
  listUserPersonas,
  assignSubscription,
  updatePersonaStatus,
} from '../store.js';

/** Resolve an issue's farm from the :id route param (used by authz scoping). */
function issueFarmFromParams(request: any): { farmId?: string } {
  return { farmId: getIssueById(request.params?.id)?.farmId };
}

export default async function v2Routes(app: FastifyInstance) {
  // ------------------------------------------------------------------ issues
  app.post(
    '/v2/issues',
    { preHandler: requirePermission('issue.create', (r) => ({ farmId: (r.body as any)?.farmId })) },
    async (request, reply) => {
      const b = request.body as any;
      if (!b?.farmId || !b?.kind || !b?.title) {
        return reply.code(400).send({ error: 'farmId, kind and title are required' });
      }
      const session = (request as any).session;
      const issue = createIssue({
        farmId: String(b.farmId),
        kind: b.kind as IssueKindAlias,
        title: String(b.title),
        source: (b.source ?? 'human_report') as any,
        severity: b.severity,
        createdBy: session.userId,
        actorRole: session.role,
        metadata: b.metadata,
      });
      return reply.code(201).send(issue);
    }
  );

  app.get(
    '/v2/issues',
    { preHandler: requirePermission('issue.view', (r) => ({ farmId: (r.query as any)?.farmId })) },
    async (request) => {
      const q = request.query as { farmId?: string; kind?: string; stage?: string };
      return listIssues(q);
    }
  );

  app.get(
    '/v2/issues/:id/events',
    { preHandler: requirePermission('issue.view', issueFarmFromParams) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        return timeline(id);
      } catch (e) {
        return reply.code(404).send({ error: (e as Error).message });
      }
    }
  );

  /**
   * Advance the workflow. Farm-role label resolution happens HERE (owner >
   * membership > primary role), then issues.ts enforces per-stage rules and
   * throws typed StageErrors mapped to HTTP codes below.
   */
  app.patch(
    '/v2/issues/:id/stage',
    // farmId resolved FROM THE ISSUE so outsiders can never touch it (IDOR guard).
    { preHandler: requirePermission('issue.advance', issueFarmFromParams) },
    async (request, reply) => {
    const { id } = request.params as { id: string };
    const { toStage, note, evidence, taskId } = request.body as {
      toStage?: IssueStage;
      note?: string;
      evidence?: Record<string, unknown>;
      taskId?: string;
    };
    if (!toStage) return reply.code(400).send({ error: 'toStage required' });

    const issue = getIssueById(id);
    if (!issue) return reply.code(404).send({ error: 'Issue not found' });

    const actor = (request as any).actor as ActorContext;
    let label = 'worker';
    if (actor.personas.includes('admin')) label = 'admin';
    else if (actor.ownedFarmIds.has(issue.farmId)) label = 'owner';
    else {
      const m = listFarmMembers(actor.userId).find((x) => x.farmId === issue.farmId);
      label = m?.roleInFarm ?? label;
    }

    try {
      const result = advanceIssue(id, toStage, actor, label, { note, evidence, taskId });
      audit({
        actorId: actor.userId,
        persona: label,
        action: 'issue.stage_advance',
        targetType: 'issue',
        targetId: id,
        detail: { toStage, note },
      });
      return result.issue;
    } catch (e) {
      if (e instanceof StageError) {
        const code =
          e.code === 'forbidden' ? 403 : e.code === 'bad_stage' ? 409 : e.code === 'closed' ? 409 : 400;
        return reply.code(code).send({ error: e.message, code: e.code });
      }
      throw e;
    }
  });

  // ------------------------------------------------------------------ farms
  app.get('/v2/farms', { preHandler: requirePermission() }, async (request) => {
    const actor = (request as any).actor as ActorContext;
    const ids = new Set([...actor.ownedFarmIds, ...actor.memberships.keys()]);
    return [...ids].map(getFarm).filter(Boolean);
  });

  const FEATURE_KEYS = [
    'water_iot',
    'solar_iot',
    'chat_translation',
    'video_platform',
    'robot_integration',
    'marketplace',
    'reports',
  ] as const;

  app.get(
    '/v2/farms/:id/entitlements',
    { preHandler: requirePermission('issue.view', (r) => ({ farmId: (r.params as any)?.id })) },
    async (request) => {
      const { id } = request.params as { id: string };
      return Object.fromEntries(FEATURE_KEYS.map((f) => [f, entitlementFor(id, f)]));
    }
  );

  // ---------------------------------------------------------------- personas
  app.get('/v2/personas', { preHandler: requirePermission() }, async (request) => {
    const session = (request as any).session as { userId: string };
    return listUserPersonas(session.userId);
  });

  app.post('/v2/personas/switch', { preHandler: requirePermission() }, async (request, reply) => {
    const b = request.body as { persona?: string };
    const session = (request as any).session;
    const target = (b.persona ?? session.role) as string;
    const held =
      target === session.role ||
      listUserPersonas(session.userId).some((p) => p.persona === target && p.status === 'active');
    if (!held) return reply.code(403).send({ error: `persona '${target}' not active for this user` });
    audit({ actorId: session.userId, persona: target, action: 'persona.switch' });
    return { ok: true, activePersona: target };
  });

  app.patch(
    '/v2/admin/personas/:userId/:persona',
    { preHandler: requirePermission('persona.verify') },
    async (request, reply) => {
      const { userId, persona } = request.params as { userId: string; persona: Persona };
      const { status } = request.body as { status: 'active' | 'suspended' | 'pending_verification' };
      const row = updatePersonaStatus(userId, persona, status);
      if (!row) return reply.code(404).send({ error: 'persona not found' });
      audit({
        actorId: (request as any).session.userId,
        persona: 'admin',
        action: 'persona.verify',
        targetType: 'user_persona',
        targetId: `${userId}:${persona}`,
        detail: { status },
      });
      return row;
    }
  );

  // ------------------------------------------------------- plans & billing
  app.get('/v2/plans', { preHandler: requirePermission() }, async () => listPlans());

  app.post('/v2/admin/subscriptions', { preHandler: requirePermission('subscription.assign') }, async (request, reply) => {
    const b = request.body as { farmId?: string; planId?: string; days?: number };
    if (!b?.farmId || !b?.planId) return reply.code(400).send({ error: 'farmId and planId required' });
    const days = b.days ?? 30;
    const sub = assignSubscription({
      farmId: b.farmId,
      planId: b.planId,
      status: 'active',
      periodStart: Date.now(),
      periodEnd: Date.now() + days * 86400_000,
      autoRenew: true,
    });
    log.warn('subscription assigned', { farmId: b.farmId, planId: b.planId, days });
    audit({
      actorId: (request as any).session.userId,
      persona: 'admin',
      action: 'subscription.assign',
      targetType: 'farm',
      targetId: b.farmId,
      detail: { planId: b.planId },
    });
    return reply.code(201).send(sub);
  });

  // ------------------------------------------------------------------ audit
  app.get('/v2/audit', { preHandler: requirePermission('audit.view') }, async () => listAudit());

  // Canonical stage order for client rendering (single source of truth).
  app.get('/v2/meta/stages', async () => ({ stages: STAGES }));

  void authenticate; // reserved for inline-verify endpoints (robot spec §4)
}

/** Local alias so the import list above stays tidy. */
type IssueKindAlias = Parameters<typeof createIssue>[0]['kind'];
